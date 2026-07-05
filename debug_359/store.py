"""
359度 Debug · L1 基础设施层

StoreMixin —— 配置合并 / DB 查询封装 / KV 持久化 / 内存缓冲 / SSE 事件总线。
唯一数据出入口，其他 Mixin 不直接碰 context.get_db() / self.config / put_kv_data。
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from collections import deque
from pathlib import Path
from typing import Any, AsyncGenerator

from astrbot.api import logger

from .utils import now_ts


class StoreMixin:
    """基础设施 Mixin。在 MRO 中最先初始化，提供数据访问基座。"""

    # 与 _conf_schema.json 对应的默认值
    CONFIG_DEFAULTS: dict[str, Any] = {
        "command_prefix": "debug",
        "enable_runtime_analysis": True,
        "enable_token_analysis": True,
        "enable_context_dump": True,
        "enable_tool_analysis": True,
        "enable_log_analysis": True,
        "enable_plugin_analysis": True,
        "token_persist_to": "kv",
        "log_tail_lines": 500,
        "admin_only": True,
        "slow_response_threshold": 10.0,
        "token_alert_threshold": 10000,
        "cache_disruption_rounds": 3,
    }

    def __init__(self, *args, **kwargs) -> None:
        # 先调用父类（Star），确保 self.context / self.config 可用
        super().__init__(*args, **kwargs)
        # 三层配置合并：默认 ⊕ config.json ⊕ 运行时
        raw_cfg = getattr(self, "config", None) or {}
        self._cfg: dict[str, Any] = {**self.CONFIG_DEFAULTS, **raw_cfg}
        # 数据库句柄
        self._db = None
        # 内存缓冲（deque 限长，防爆）
        self._runtime_buf: deque = deque(maxlen=500)
        self._token_buf: deque = deque(maxlen=2000)
        self._tool_buf: deque = deque(maxlen=500)
        self._context_last: dict[str, dict] = {}      # {umo: last_req_snapshot}
        self._context_history: deque = deque(maxlen=50)  # 多轮 prompt 用于缓存破坏检测
        self._ctx_head_snapshots: dict[int, str] = {}    # {event_id: head_system_prompt}
        self._log_entries: deque = deque(maxlen=500)  # on_plugin_error 捕获
        self._agent_trajectories: deque = deque(maxlen=50)
        # SSE 事件总线
        self._alert_subscribers: list[asyncio.Queue] = []
        self._alert_history: deque = deque(maxlen=200)
        # 运行时阶段计时（id(event) -> {stage: ts}）
        self._timings: dict[int, dict] = {}
        # 工具调用计时（id(event) -> {tool_name: start_ts}）
        self._tool_timings: dict[int, dict[str, float]] = {}
        # Agent 轨迹临时存储（id(event) -> {begin, tool_seq, ...}）
        self._agent_temp: dict[int, dict] = {}
        # 生命周期审计日志
        self._lifecycle_log: deque = deque(maxlen=100)
        # 钩子运行时观测（hook_key -> {calls, stopped, last_order}）
        self._hook_runtime_log: dict = {}
        # 本插件名缓存（延迟解析，_get_self_plugin_name 填充）
        self._self_plugin_name_cache: str | None = None
        # 钩子心跳：{method_name: {calls: N, last_ts: float, last_err: str|None}}
        self._hook_heartbeat: dict[str, dict] = {}
        logger.debug("[359debug] StoreMixin 已初始化")

    def _hb(
        self,
        method_name: str,
        err: str | None = None,
        *,
        event=None,
        event_type: str | None = None,
    ) -> None:
        """记录钩子心跳。在钩子方法入口调用。

        当传入 event + event_type 时，同时记录运行时实证数据
        （供插件冲突检测使用），等效于 _record_hook_runtime()。
        """
        entry = self._hook_heartbeat.setdefault(
            method_name, {"calls": 0, "last_ts": 0.0, "last_err": None}
        )
        entry["calls"] += 1
        entry["last_ts"] = time.time()
        if err:
            entry["last_err"] = err
        # 自动记录运行时实证（插件冲突检测依赖此数据）
        if event is not None and event_type:
            try:
                stopped = bool(event.is_stopped())
                self._record_hook_runtime(event_type, stopped, [])
            except Exception:
                pass

    def diagnose_hooks(self) -> dict:
        """
        全面诊断钩子链路：注册表 → 绑定 → 配置 → 心跳 → 缓冲。

        返回结构化的诊断报告，用于排查「某模块一直不更新」问题。
        """
        import traceback
        report: dict = {
            "timestamp": time.time(),
            "self_plugin_name": None,
            "module_path_patch": {"main_module": None, "patched_count": 0},
            "registry": {"total": 0, "ours": 0, "by_event": {}},
            "binding": {"bound": 0, "unbound": 0, "details": []},
            "config": {},
            "heartbeat": {},
            "buffers": {},
        }

        # 1. 本插件名
        try:
            report["self_plugin_name"] = getattr(self, "_get_self_plugin_name", lambda: None)()
        except Exception:
            pass

        # 2. 模块路径补丁状态
        try:
            report["module_path_patch"]["main_module"] = type(self).__module__
        except Exception:
            pass

        # 3. 遍历 star_handlers_registry，检查我们的 handler
        try:
            from astrbot.core.star.star_handler import star_handlers_registry
            from astrbot.core.star.star import star_map

            main_mod = type(self).__module__
            pkg_prefix = main_mod.rsplit(".", 1)[0] + "." if "." in main_mod else main_mod + "."

            all_handlers = list(star_handlers_registry)
            report["registry"]["total"] = len(all_handlers)

            for h in all_handlers:
                # 判断是否属于本插件（通过 patched 后的 module_path 或原始前缀）
                is_ours = (
                    h.handler_module_path == main_mod
                    or h.handler_module_path.startswith(pkg_prefix)
                )
                if not is_ours:
                    continue

                report["registry"]["ours"] += 1

                # 按事件类型统计
                evt_name = h.event_type.name if hasattr(h, "event_type") and h.event_type else "?"
                report["registry"]["by_event"].setdefault(evt_name, 0)
                report["registry"]["by_event"][evt_name] += 1

                # 检查绑定状态（是否已绑定 self）
                import functools
                is_bound = isinstance(h.handler, functools.partial)
                if is_bound:
                    report["binding"]["bound"] += 1
                else:
                    report["binding"]["unbound"] += 1

                # 检查 star_map 中能否找到
                in_star_map = h.handler_module_path in star_map
                star_map_activated = False
                if in_star_map:
                    star_map_activated = getattr(star_map[h.handler_module_path], "activated", False)

                report["binding"]["details"].append({
                    "name": getattr(h, "handler_name", "?"),
                    "event": evt_name,
                    "module_path": h.handler_module_path,
                    "bound": is_bound,
                    "enabled": getattr(h, "enabled", True),
                    "in_star_map": in_star_map,
                    "star_map_activated": star_map_activated,
                    "priority": getattr(h, "priority", 0),
                })

            report["module_path_patch"]["patched_count"] = report["registry"]["ours"]
        except Exception as e:
            report["registry"]["error"] = f"{type(e).__name__}: {e}"

        # 4. 配置检查
        for key in sorted(self._cfg.keys()):
            report["config"][key] = self._cfg[key]

        # 5. 心跳（哪些钩子真正被调用过）
        report["heartbeat"] = dict(sorted(self._hook_heartbeat.items()))

        # 6. 缓冲区大小
        report["buffers"] = {
            "runtime_buf": len(self._runtime_buf),
            "token_buf": len(self._token_buf),
            "tool_buf": len(self._tool_buf),
            "context_last_keys": len(self._context_last),
            "context_history": len(self._context_history),
            "alert_history": len(self._alert_history),
        }

        # 7. 运行时链路完整性（哪个环节断了）
        rt_hb = self._hook_heartbeat
        report["runtime_chain"] = {
            "wait_calls": rt_hb.get("_rt_on_wait", {}).get("calls", 0),
            "req_calls": rt_hb.get("_rt_on_req", {}).get("calls", 0),
            "resp_calls": rt_hb.get("_rt_on_resp", {}).get("calls", 0),
            "sent_calls": rt_hb.get("_rt_on_sent", {}).get("calls", 0),
            "timings_active": len(self._timings),
            "runtime_buf_len": len(self._runtime_buf),
        }

        return report

    # ==================== 配置 ====================

    def cfg(self, key: str, default: Any = None) -> Any:
        """统一读取配置项。"""
        return self._cfg.get(key, self.CONFIG_DEFAULTS.get(key, default))

    def is_enabled(self, module: str) -> bool:
        """模块开关：enable_runtime_analysis / enable_token_analysis / ..."""
        return bool(self._cfg.get(f"enable_{module}", True))

    async def update_config(self, new_config: dict) -> dict:
        """Pages 设置页保存配置。合并后写回 self.config（框架会持久化）。"""
        self._cfg.update(new_config)
        if hasattr(self, "config") and isinstance(self.config, dict):
            self.config.update(new_config)
        # 尝试持久化到 KV
        try:
            await self.put_kv_data("config_override", new_config)
        except Exception as e:
            logger.warning(f"[359debug] 配置持久化失败: {e}")
        return self._cfg

    async def load_config(self) -> None:
        """从 KV 恢复配置覆盖。"""
        try:
            saved = await self.get_kv_data("config_override", None)
            if isinstance(saved, dict):
                self._cfg.update(saved)
        except Exception:
            pass

    # ==================== 主题持久化 ====================

    async def get_theme(self) -> str:
        """读取持久化的主题设置，默认 light。"""
        try:
            saved = await self.get_kv_data("ui_theme", None)
            if saved in ("light", "dark"):
                return saved
        except Exception:
            pass
        return "light"

    async def save_theme(self, theme: str) -> str:
        """持久化主题设置并返回最终值。"""
        theme = theme if theme in ("light", "dark") else "light"
        try:
            await self.put_kv_data("ui_theme", theme)
        except Exception as e:
            logger.warning(f"[359debug] 主题持久化失败: {e}")
        return theme

    # ==================== DB 查询封装 ====================

    def _get_db(self):
        """惰性获取数据库句柄。"""
        if self._db is None:
            self._db = self.context.get_db()
        return self._db

    async def query_provider_stats(
        self,
        umo: str | None = None,
        since: float | None = None,
        limit: int = 500,
    ) -> list:
        """查询 ProviderStat 表（4.26.4 新表）。

        BaseDatabase 仅暴露 insert，查询走 db.get_db() + SQLAlchemy select。
        """
        try:
            from astrbot.core.db.po import ProviderStat
            from sqlalchemy import select, desc
        except ImportError:
            logger.warning("[359debug] 无法导入 ProviderStat 模型")
            return []

        db = self._get_db()
        try:
            async with db.get_db() as session:
                stmt = select(ProviderStat).order_by(desc(ProviderStat.id)).limit(limit)
                if umo:
                    stmt = stmt.where(ProviderStat.umo == umo)
                if since:
                    stmt = stmt.where(ProviderStat.start_time >= since)
                result = await session.execute(stmt)
                return list(result.scalars().all())
        except Exception as e:
            logger.warning(f"[359debug] 查询 ProviderStat 失败: {e}")
            return []

    async def query_command_conflicts(self) -> list:
        """查询指令冲突记录。"""
        db = self._get_db()
        try:
            return await db.list_command_conflicts()
        except Exception as e:
            logger.warning(f"[359debug] 查询指令冲突失败: {e}")
            return []

    # ==================== 内存缓冲 ====================

    def record_runtime(self, event_id: int, stage: str, ts: float, umo: str = "") -> None:
        """记录运行时阶段时间戳。"""
        t = self._timings.setdefault(event_id, {"umo": umo})
        t[stage] = ts

    def record_token(self, provider: str, model: str, usage: dict, umo: str = "") -> None:
        """记录单次 token 用量到缓冲。"""
        self._token_buf.append({
            "ts": now_ts(), "umo": umo, "provider": provider, "model": model,
            "prompt": usage.get("prompt_tokens", 0),
            "completion": usage.get("completion_tokens", 0),
            "total": usage.get("total_tokens", 0),
            "cached": usage.get("cached_tokens", 0),
        })

    def record_tool(self, name: str, args: Any, dur: float, ok: bool, umo: str = "") -> None:
        """记录工具调用到缓冲。"""
        self._tool_buf.append({
            "ts": now_ts(), "umo": umo, "name": name,
            "args": str(args)[:200], "dur": dur, "ok": ok,
        })

    def record_context(self, umo: str, snapshot: dict) -> None:
        """记录上下文快照（供注入分析 + 缓存破坏检测）。"""
        self._context_last[umo] = snapshot
        self._context_history.append({"ts": now_ts(), "umo": umo, **snapshot})

    def record_log_error(self, level: str, source: str, msg: str, tb: str = "") -> None:
        """记录 on_plugin_error 捕获的运行时错误。"""
        self._log_entries.append({
            "ts": now_ts(), "level": level, "source": source,
            "msg": msg[:500], "tb": tb[:2000],
        })

    def record_agent_trajectory(self, umo: str, steps: int, tool_seq: list, messages: int) -> None:
        """记录 Agent 多步轨迹。"""
        self._agent_trajectories.append({
            "ts": now_ts(), "umo": umo, "steps": steps,
            "tool_seq": tool_seq, "messages": messages,
        })

    def cleanup_event(self, event_id: int) -> None:
        """清理已完成事件的计时数据（防泄漏）。"""
        self._timings.pop(event_id, None)
        self._tool_timings.pop(event_id, None)
        self._ctx_head_snapshots.pop(event_id, None)
        self._agent_temp.pop(event_id, None)

    # ==================== 缓冲读取 ====================

    def get_runtime_buf(self) -> list:
        return list(self._runtime_buf)

    def get_token_buf(self) -> list:
        return list(self._token_buf)

    def get_tool_buf(self) -> list:
        return list(self._tool_buf)

    def get_context_last(self, umo: str | None = None) -> dict | list:
        if umo:
            return self._context_last.get(umo, {})
        return list(self._context_history)

    def get_log_entries(self) -> list:
        return list(self._log_entries)

    def get_agent_trajectories(self) -> list:
        return list(self._agent_trajectories)

    # ==================== KV 持久化 ====================

    # 全部插件持久化的 KV key 集中定义（决定持久化行为）
    PERSIST_KEYS: tuple[str, ...] = (
        "token_buf",            # Token 使用记录
        "runtime_buf",          # 运行时阶段样本
        "tool_buf",             # 工具调用记录
        "context_history",      # 多轮 prompt 快照（用于缓存破坏检测）
        "context_last",         # {umo: last_snapshot}
        "alert_history",        # 告警事件历史
        "log_entries",          # plugin_error 捕获
        "agent_trajectories",   # Agent 轨迹
        "hook_runtime_log",     # 钩子运行时实证
    )

    async def save_buf_to_kv(self) -> None:
        """将 token 缓冲持久化到 KV（向后兼容）。"""
        try:
            data = list(self._token_buf)
            await self.put_kv_data("token_buf", data)
        except Exception as e:
            logger.warning(f"[359debug] KV 持久化失败: {e}")

    async def save_all_bufs_to_kv(self) -> None:
        """将所有可持久化的缓冲批量写入 KV。异常隔离：单个 key 失败不影响其他。"""
        snapshot = {
            "token_buf":          list(self._token_buf),
            "runtime_buf":        list(self._runtime_buf),
            "tool_buf":           list(self._tool_buf),
            "context_history":    list(self._context_history),
            "context_last":       dict(self._context_last),
            "alert_history":      list(self._alert_history),
            "log_entries":        list(self._log_entries),
            "agent_trajectories": list(self._agent_trajectories),
            "hook_runtime_log":   {k: dict(v) for k, v in self._hook_runtime_log.items()},
        }
        ok, failed = 0, []
        for k, v in snapshot.items():
            try:
                await self.put_kv_data(k, v)
                ok += 1
            except Exception as e:
                failed.append(f"{k}: {e}")
        logger.info(f"[359debug] KV 持久化: {ok} 成功, {len(failed)} 失败 {failed}")

    async def load_buf_from_kv(self) -> None:
        """从 KV 恢复 token 统计（向后兼容）。"""
        try:
            saved = await self.get_kv_data("token_buf", None)
            if isinstance(saved, list):
                self._token_buf.extend(saved[-2000:])
                logger.info(f"[359debug] 恢复 {len(saved)} 条 token 记录")
        except Exception as e:
            logger.warning(f"[359debug] KV 恢复失败: {e}")

    async def load_all_bufs_from_kv(self) -> None:
        """从 KV 恢复所有可持久化的缓冲。"""
        restored = 0
        # token_buf
        try:
            v = await self.get_kv_data("token_buf", None)
            if isinstance(v, list):
                self._token_buf.extend(v[-2000:]); restored += 1
        except Exception as e:
            logger.warning(f"[359debug] KV 恢复 token_buf 失败: {e}")
        # runtime_buf
        try:
            v = await self.get_kv_data("runtime_buf", None)
            if isinstance(v, list):
                self._runtime_buf.extend(v[-500:]); restored += 1
        except Exception as e:
            logger.warning(f"[359debug] KV 恢复 runtime_buf 失败: {e}")
        # tool_buf
        try:
            v = await self.get_kv_data("tool_buf", None)
            if isinstance(v, list):
                self._tool_buf.extend(v[-500:]); restored += 1
        except Exception as e:
            logger.warning(f"[359debug] KV 恢复 tool_buf 失败: {e}")
        # context_history / context_last / alert_history / log_entries / agent_trajectories
        targets = {
            "context_history":    (self._context_history, 50),
            "context_last":       ("dict", None),
            "alert_history":      (self._alert_history, 200),
            "log_entries":        (self._log_entries, 500),
            "agent_trajectories": (self._agent_trajectories, 50),
        }
        for key, (target, limit) in targets.items():
            try:
                v = await self.get_kv_data(key, None)
                if v is None:
                    continue
                if target == "dict" and isinstance(v, dict):
                    self._context_last.update(v); restored += 1
                elif hasattr(target, "extend") and isinstance(v, list):
                    target.extend(v[-limit:]); restored += 1
            except Exception as e:
                logger.warning(f"[359debug] KV 恢复 {key} 失败: {e}")
        # hook_runtime_log
        try:
            v = await self.get_kv_data("hook_runtime_log", None)
            if isinstance(v, dict):
                for et, slot in v.items():
                    if isinstance(slot, dict):
                        cur = self._hook_runtime_log.setdefault(et, {
                            "calls": 0, "stopped": 0, "last_order": [], "last_ts": 0.0,
                        })
                        cur["calls"]   = max(cur["calls"],   int(slot.get("calls", 0)))
                        cur["stopped"] = max(cur["stopped"], int(slot.get("stopped", 0)))
                        cur["last_ts"] = max(cur["last_ts"], float(slot.get("last_ts", 0.0)))
                restored += 1
        except Exception as e:
            logger.warning(f"[359debug] KV 恢复 hook_runtime_log 失败: {e}")
        logger.info(f"[359debug] KV 批量恢复: {restored} 个缓冲区")

    async def clear_persisted_cache(self, keys: list[str] | None = None) -> dict[str, bool]:
        """一键清理持久化数据。

        Args:
            keys: 指定要清理的 key 列表；None 表示清空本插件所有 KV。
        Returns:
            {key: True/False} 清理结果
        """
        result: dict[str, bool] = {}

        if keys is None:
            # 一键全清：通过 sp 取消整个 plugin 命名空间
            try:
                from astrbot.core import sp
                await sp.clear_async("plugin", self.plugin_id)
                logger.info(f"[359debug] 已清空插件 {self.plugin_id} 的全部 KV 命名空间")
                # 同时清空内存中的所有缓冲区
                self._token_buf.clear()
                self._runtime_buf.clear()
                self._tool_buf.clear()
                self._context_history.clear()
                self._context_last.clear()
                self._alert_history.clear()
                self._log_entries.clear()
                self._agent_trajectories.clear()
                self._hook_runtime_log.clear()
                return {"_all": True}
            except Exception as e:
                logger.error(f"[359debug] clear_persisted_cache 全清失败: {e}")
                return {"_all": False}

        # 指定 key 清理
        buf_map = {
            "token_buf":          self._token_buf,
            "runtime_buf":        self._runtime_buf,
            "tool_buf":           self._tool_buf,
            "context_history":    self._context_history,
            "context_last":       self._context_last,
            "alert_history":      self._alert_history,
            "log_entries":        self._log_entries,
            "agent_trajectories": self._agent_trajectories,
            "hook_runtime_log":   self._hook_runtime_log,
        }
        for k in keys:
            try:
                await self.delete_kv_data(k)
                # 同时清空内存中的对应缓冲区
                buf = buf_map.get(k)
                if buf is not None:
                    buf.clear()
                result[k] = True
            except Exception as e:
                logger.warning(f"[359debug] 删除 KV {k} 失败: {e}")
                result[k] = False
        return result

    def get_persisted_keys_status(self) -> list[dict[str, Any]]:
        """返回每个持久化 key 的状态（用于设置页面展示）。"""
        sizes = {
            "token_buf":          len(self._token_buf),
            "runtime_buf":        len(self._runtime_buf),
            "tool_buf":           len(self._tool_buf),
            "context_history":    len(self._context_history),
            "context_last":       len(self._context_last),
            "alert_history":      len(self._alert_history),
            "log_entries":        len(self._log_entries),
            "agent_trajectories": len(self._agent_trajectories),
            "hook_runtime_log":   len(self._hook_runtime_log),
        }
        labels = {
            "token_buf":          "Token 使用记录",
            "runtime_buf":        "运行时阶段样本",
            "tool_buf":           "工具调用记录",
            "context_history":    "上下文历史快照",
            "context_last":       "最新上下文 (per-umo)",
            "alert_history":      "告警事件历史",
            "log_entries":        "错误日志捕获",
            "agent_trajectories": "Agent 轨迹",
            "hook_runtime_log":   "钩子运行时实证",
        }
        modules = {
            "token_buf":          "token",
            "runtime_buf":        "runtime",
            "tool_buf":           "tool",
            "context_history":    "context",
            "context_last":       "context",
            "alert_history":      "alert",
            "log_entries":        "log",
            "agent_trajectories": "tool",
            "hook_runtime_log":   "plugin",
        }
        return [
            {"key": k, "label": labels.get(k, k), "count": sizes.get(k, 0), "module": modules.get(k, "")}
            for k in self.PERSIST_KEYS
        ]

    # ==================== SSE 事件总线 ====================

    def emit_alert(self, level: str, source: str, msg: str, module: str = "") -> None:
        """发射告警事件到所有 SSE 订阅者。"""
        event = {
            "ts": now_ts(), "level": level, "source": source,
            "msg": msg[:500], "module": module,
        }
        self._alert_history.append(event)
        for q in self._alert_subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # 慢消费者丢弃

    async def subscribe_alerts(self) -> AsyncGenerator[dict, None]:
        """订阅告警事件流（SSE 端点用）。"""
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._alert_subscribers.append(q)
        try:
            # 先推送历史告警
            for e in self._alert_history:
                yield e
            # 再持续推送新告警
            while True:
                event = await q.get()
                yield event
        finally:
            if q in self._alert_subscribers:
                self._alert_subscribers.remove(q)

    def recent_alerts(self, n: int = 20) -> list:
        """获取最近 N 条告警（主页时间线用）。"""
        return list(self._alert_history)[-n:]

    # ==================== 日志文件路径 ====================

    def get_log_file_path(self) -> str:
        """解析 astrbot.log 文件路径。

        按可靠性依次尝试三种方案：
        1. 从 logging 的 FileHandler 获取实际写入路径（最准确）
        2. 使用 StarTools.get_data_dir() 推导 AstrBot 数据根目录
        3. 最终回退到 cwd/data/logs/astrbot.log

        AstrBot 的日志路径解析逻辑：
          data_root = <ASTRBOT_ROOT 或 cwd>/data
          完整路径 = data_root / log_file_path
          (如配置 "logs/astrbot.log" → <cwd>/data/logs/astrbot.log)
        """
        import logging

        # 方案1：从 astrbot logger 的文件 handler 获取真实路径
        # LogManager 会把带 _astrbot_file_handler 标记的 RotatingFileHandler
        # 挂载到 logger 上，handler.baseFilename 就是日志实际写入路径。
        try:
            ab_logger = logging.getLogger("astrbot")
            for h in ab_logger.handlers:
                # 优先匹配主日志 handler（排除 trace handler）
                if getattr(h, "_astrbot_file_handler", False):
                    base = getattr(h, "baseFilename", None)
                    if base:
                        return base
            # 次选：任何带 baseFilename 的非 trace handler
            for h in ab_logger.handlers:
                base = getattr(h, "baseFilename", None)
                if base and ".trace." not in base:
                    return base
        except Exception:
            pass

        # 方案2：通过 StarTools.get_data_dir() 推导数据根目录
        # get_data_dir() 返回 data/plugin_data/{plugin_name}/
        # 向上两级即为 AstrBot 数据根目录 data/
        try:
            from astrbot.api.star import StarTools
            plugin_data_dir = StarTools.get_data_dir()
            # data/plugin_data/{name} → data/
            data_root = Path(plugin_data_dir).parent.parent
            try:
                rel = self.context.get_config().get("log_file_path", "logs/astrbot.log")
            except Exception:
                rel = "logs/astrbot.log"
            if os.path.isabs(rel):
                return rel
            return str(data_root / rel)
        except Exception:
            pass

        # 方案3：最终回退（cwd/data/logs/astrbot.log）
        return os.path.join(os.getcwd(), "data", "logs", "astrbot.log")

    def is_log_file_enabled(self) -> bool:
        """检查 AstrBot 是否启用了日志文件记录。"""
        try:
            cfg = self.context.get_config()
            # 兼容新版平铺配置和旧版嵌套配置
            if "log_file" in cfg:
                return bool((cfg.get("log_file") or {}).get("enable", False))
            return bool(cfg.get("log_file_enable", False))
        except Exception:
            return False

    # ==================== 生命周期 ====================

    async def _store_initialize(self) -> None:
        """由子类 initialize() 调用。"""
        await self.load_config()
        await self.load_all_bufs_from_kv()
        logger.info("[359debug] StoreMixin 就绪（配置/KV/缓冲 已加载）")
