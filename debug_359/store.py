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
        logger.debug("[359debug] StoreMixin 已初始化")

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

    async def query_platform_stats(self, offset_sec: int = 86400) -> list:
        """查询平台调用统计。"""
        db = self._get_db()
        try:
            return await db.get_platform_stats(offset_sec)
        except Exception as e:
            logger.warning(f"[359debug] 查询平台统计失败: {e}")
            return []

    async def query_conversations(self, umo: str | None = None) -> list:
        """查询会话列表。"""
        db = self._get_db()
        try:
            if umo:
                return await db.get_conversations()
            return await db.get_all_conversations(page=1, page_size=50)
        except Exception as e:
            logger.warning(f"[359debug] 查询会话失败: {e}")
            return []

    # ==================== 内存缓冲 ====================

    def record_runtime(self, event_id: int, stage: str, ts: float, umo: str = "") -> None:
        """记录运行时阶段时间戳。"""
        t = self._timings.setdefault(event_id, {"umo": umo})
        t[stage] = ts

    def finish_runtime(self, event_id: int, stage: str, ts: float) -> None:
        """完成一个阶段，计算耗时并写入缓冲。"""
        t = self._timings.get(event_id, {})
        start = t.get(stage + "_start") or t.get("enter")
        if start:
            dur = ts - start
            self._runtime_buf.append({
                "ts": ts, "umo": t.get("umo", ""), "stage": stage, "dur": dur,
            })

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

    async def save_buf_to_kv(self) -> None:
        """将 token 统计缓冲持久化到 KV（重启不丢）。"""
        try:
            data = list(self._token_buf)
            await self.put_kv_data("token_buf", data)
        except Exception as e:
            logger.warning(f"[359debug] KV 持久化失败: {e}")

    async def load_buf_from_kv(self) -> None:
        """从 KV 恢复 token 统计。"""
        try:
            saved = await self.get_kv_data("token_buf", None)
            if isinstance(saved, list):
                self._token_buf.extend(saved[-2000:])
                logger.info(f"[359debug] 恢复 {len(saved)} 条 token 记录")
        except Exception as e:
            logger.warning(f"[359debug] KV 恢复失败: {e}")

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
        2. 使用 AstrBot 官方 get_astrbot_data_path() 解析
        3. 最终回退到 cwd/data/logs/astrbot.log

        AstrBot 的日志路径解析逻辑：
          get_astrbot_data_path() = <ASTRBOT_ROOT 或 cwd>/data
          完整路径 = get_astrbot_data_path() / log_file_path
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

        # 方案2：使用 AstrBot 官方路径解析
        try:
            from astrbot.core.utils.astrbot_path import get_astrbot_data_path
            try:
                rel = self.context.get_config().get("log_file_path", "logs/astrbot.log")
            except Exception:
                rel = "logs/astrbot.log"
            if os.path.isabs(rel):
                return rel
            return os.path.join(get_astrbot_data_path(), rel)
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

    def get_trace_log_path(self) -> str:
        """解析 trace 日志路径。"""
        base = os.environ.get("ASTRBOT_DATA_PATH") or os.getcwd()
        return os.path.join(base, "logs", "astrbot.trace.log")

    # ==================== 生命周期 ====================

    async def _store_initialize(self) -> None:
        """由子类 initialize() 调用。"""
        await self.load_config()
        await self.load_buf_from_kv()
        logger.info("[359debug] StoreMixin 就绪（配置/KV/缓冲 已加载）")
