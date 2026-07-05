"""
359度 Debug · L2 插件分析 Mixin（安全/冲突）

采集: on_plugin_loaded / on_plugin_unloaded / on_plugin_error（审计）
查询方法: get_plugin_detail() / scan_security() / get_plugin_health() / fmt_plugin_oneline()
"""
from __future__ import annotations

import inspect
import os
import re
from collections import deque
from typing import Any

from astrbot.api import logger
from astrbot.api.event import filter, AstrMessageEvent

from .utils import health_score_from_metric


class PluginMixin:
    """插件分析（安全/冲突）。依赖 StoreMixin 的 DB 查询。"""

    # 生命周期审计日志
    _lifecycle_log: deque = deque(maxlen=100)

    # 安全扫描正则模式
    SECURITY_PATTERNS = {
        "eval/exec": r"\b(eval|exec)\s*\(",
        "os.system/popen": r"os\.(system|popen)\s*\(",
        "subprocess": r"subprocess\.(run|call|Popen|check_output)\s*\(",
        "__import__": r"__import__\s*\(",
        "网络外发": r"requests\.(post|put|delete)\s*\(|urllib.*\.urlopen",
        "shell=True": r"shell\s*=\s*True",
        "缓存破坏风险": r"req\.system_prompt\s*(\+=|=)",
    }

    @filter.on_plugin_loaded()
    async def _pl_on_loaded(self, metadata) -> None:
        """插件加载审计。"""
        if not self.is_enabled("plugin_analysis"):
            return
        try:
            name = getattr(metadata, "name", str(metadata))
            self._lifecycle_log.append({
                "ts": __import__("time").time(),
                "event": "loaded", "plugin": name,
            })
        except Exception:
            pass

    @filter.on_plugin_unloaded()
    async def _pl_on_unloaded(self, metadata) -> None:
        """插件卸载审计。"""
        if not self.is_enabled("plugin_analysis"):
            return
        try:
            name = getattr(metadata, "name", str(metadata))
            self._lifecycle_log.append({
                "ts": __import__("time").time(),
                "event": "unloaded", "plugin": name,
            })
        except Exception:
            pass

    # ==================== 查询/聚合 ====================

    def scan_plugins(self) -> list:
        """扫描全部插件列表。"""
        try:
            stars = self.context.get_all_stars()
        except Exception as e:
            logger.warning(f"[359debug] 获取插件列表失败: {e}")
            return []
        result = []
        for s in stars:
            result.append({
                "name": getattr(s, "name", "?"),
                "version": getattr(s, "version", "?"),
                "author": getattr(s, "author", "?"),
                "activated": getattr(s, "activated", False),
                "reserved": getattr(s, "reserved", False),
                "repo": getattr(s, "repo", ""),
                "module_path": getattr(s, "module_path", ""),
                "root_dir_name": getattr(s, "root_dir_name", ""),
            })
        return result

    def scan_security(self) -> list:
        """安全启发式扫描。"""
        try:
            stars = self.context.get_all_stars()
        except Exception:
            return []
        findings = []
        for s in stars:
            if getattr(s, "reserved", False):
                continue  # 内置插件跳过
            name = getattr(s, "name", "?")
            src_path = self._pl_source_path(s)
            if not src_path or not os.path.isfile(src_path):
                continue
            try:
                with open(src_path, "r", encoding="utf-8", errors="ignore") as f:
                    code = f.read()
            except Exception:
                continue
            for label, pat in self.SECURITY_PATTERNS.items():
                matches = re.findall(pat, code)
                if matches:
                    # 尝试定位行号
                    line_no = 0
                    try:
                        for i, line in enumerate(code.split("\n"), 1):
                            if re.search(pat, line):
                                line_no = i
                                break
                    except Exception:
                        pass
                    findings.append({
                        "plugin": name,
                        "pattern": label,
                        "count": len(matches),
                        "file": src_path,
                        "line": line_no,
                        "severity": "high" if label in ("eval/exec", "os.system/popen",
                                                         "subprocess", "__import__",
                                                         "缓存破坏风险") else "medium",
                    })
        return findings

    async def get_conflicts(self) -> list:
        """指令冲突列表。"""
        rows = await self.query_command_conflicts()
        result = []
        for r in rows or []:
            try:
                result.append({
                    "conflict_key": getattr(r, "conflict_key", str(r)),
                    "plugin_name": getattr(r, "plugin_name", "?"),
                    "handler": getattr(r, "handler_full_name", "?"),
                    "status": getattr(r, "status", "?"),
                    "resolution": getattr(r, "resolution", ""),
                })
            except Exception:
                result.append({"raw": str(r)})
        return result

    # ==================== 钩子(Hook)冲突分析 ====================
    # AstrBot 的钩子机制：star_handlers_registry 是全局单例，
    # 每个 @filter.on_xxx() 装饰器注册一条 StarHandlerMetadata，
    # call_event_hook() 按优先级降序串行 await。
    # 真实"冲突"是语义层面的：
    #   A. event.stop_event() → 静默掐断后续同钩子处理器
    #   B. 覆盖式赋值共享可变对象（req.system_prompt = / event.set_result）
    #   C. 多 handler 同优先级 → 顺序由加载顺序决定，不稳定

    # 钩子事件类型 → 友好名称
    _HOOK_NAMES: dict[str, str] = {
        "OnLLMRequestEvent": "LLM 请求前",
        "OnLLMResponseEvent": "LLM 响应后",
        "OnDecoratingResultEvent": "消息发送前",
        "OnUsingLLMToolEvent": "工具调用前",
        "OnLLMToolRespondEvent": "工具调用后",
        "OnAgentBeginEvent": "Agent 开始",
        "OnAgentDoneEvent": "Agent 完成",
        "OnCallingFuncToolEvent": "函数工具调用",
        "OnPluginErrorEvent": "插件异常",
        "OnPluginLoadedEvent": "插件加载",
        "OnPluginUnloadedEvent": "插件卸载",
        "OnAfterMessageSentEvent": "消息发送后",
        "OnWaitingLLMRequestEvent": "等待 LLM",
        "AdapterMessageEvent": "适配器消息",
        "OnAstrBotLoadedEvent": "AstrBot 加载完成",
        "OnPlatformLoadedEvent": "平台加载完成",
    }

    # 高风险钩子：共享可变对象，多插件修改可能互相覆盖/竞改
    _HIGH_RISK_HOOKS = {
        "OnLLMRequestEvent",         # req: ProviderRequest
        "OnDecoratingResultEvent",   # result: MessageEventResult
        "OnLLMResponseEvent",        # response: LLMResponse
    }

    def _get_star_registry(self):
        """安全获取全局 star_handlers_registry 单例。"""
        try:
            from astrbot.core.star.star_handler import star_handlers_registry
            return star_handlers_registry
        except Exception as e:
            logger.warning(f"[359debug] 获取 star_handlers_registry 失败: {e}")
            return None

    def _get_star_map(self):
        """安全获取全局 star_map（模块路径 → 插件元数据）。"""
        try:
            from astrbot.core.star.star import star_map
            return star_map
        except Exception:
            return {}

    def _resolve_plugin_name(self, handler, star_map) -> str:
        """从 handler 的模块路径解析所属插件名。"""
        try:
            module_path = getattr(handler, "handler_module_path", "")
            meta = star_map.get(module_path)
            if meta:
                return getattr(meta, "name", "?") or "?"
        except Exception:
            pass
        return "?"

    def _resolve_plugin_reserved(self, handler, star_map) -> bool:
        """判断 handler 所属插件是否为保留插件。"""
        try:
            module_path = getattr(handler, "handler_module_path", "")
            meta = star_map.get(module_path)
            if meta:
                return bool(getattr(meta, "reserved", False))
        except Exception:
            pass
        return False

    def _read_handler_source(self, handler) -> str:
        """读取 handler 函数的源码内容。"""
        try:
            fn = getattr(handler, "handler", None)
            if fn is None:
                return ""
            # 优先用源码文件全量读取（更稳健，能拿到行号）
            fn_file = getattr(getattr(fn, "__code__", None), "co_filename", "")
            if fn_file and os.path.isfile(fn_file):
                with open(fn_file, "r", encoding="utf-8", errors="ignore") as f:
                    return f.read()
        except Exception:
            pass
        return ""

    def _scan_handler_risks(self, code: str) -> list:
        """扫描 handler 源码中的风险点，返回风险标签列表。"""
        risks = []
        if not code:
            return risks
        # A 类：事件终止（掐断后续 handler）
        if re.search(r"\.stop_event\s*\(", code):
            risks.append("event_stop")
        # B 类：覆盖式赋值共享对象（非 += 形式）
        if re.search(r"req\.system_prompt\s*=(?!\=)", code) and \
           not re.search(r"req\.system_prompt\s*\+=", code):
            risks.append("overwrite_system_prompt")
        if re.search(r"event\.set_result\s*\(", code):
            risks.append("overwrite_result")
        return risks

    def _find_risk_lines(self, code: str, pattern: str) -> int:
        """定位风险模式的首次出现行号。"""
        try:
            for i, line in enumerate(code.split("\n"), 1):
                if re.search(pattern, line):
                    return i
        except Exception:
            pass
        return 0

    def scan_hooks(self) -> dict:
        """钩子全景图 + 冲突检测。

        返回结构：
            total_handlers: 全部已注册 handler 数
            groups: [{event_type, label, risk_level, handlers: [...], conflict_flags}]
            conflicts: [{
                type: "multi_handler" | "event_stop" | "overwrite" | "same_priority",
                severity: "high"|"medium"|"low",
                event_type, desc, involved: [plugin names]
            }]
        """
        registry = self._get_star_registry()
        if registry is None:
            return {"total_handlers": 0, "groups": [], "conflicts": [],
                    "error": "无法访问 star_handlers_registry"}

        star_map = self._get_star_map()
        # 1. 按 event_type 分组
        by_event: dict[str, list] = {}
        try:
            handlers_iter = list(iter(registry))
        except Exception:
            handlers_iter = getattr(registry, "_handlers", []) or []

        total = 0
        for h in handlers_iter:
            try:
                et_name = getattr(getattr(h, "event_type", None), "name", "Unknown")
            except Exception:
                et_name = "Unknown"
            by_event.setdefault(et_name, []).append(h)
            total += 1

        groups = []
        conflicts = []

        for et_name, handlers in by_event.items():
            label = self._HOOK_NAMES.get(et_name, et_name)
            is_high_risk = et_name in self._HIGH_RISK_HOOKS
            handler_infos = []
            plugins_involved = set()

            for h in handlers:
                try:
                    plugin_name = self._resolve_plugin_name(h, star_map)
                    reserved = self._resolve_plugin_reserved(h, star_map)
                    plugins_involved.add(plugin_name)
                    priority = getattr(h, "extras_configs", {}).get("priority", 0)
                    enabled = bool(getattr(h, "enabled", True))
                    handler_name = getattr(h, "handler_name", "?")
                    full_name = getattr(h, "handler_full_name", "?")
                    src = self._read_handler_source(h)
                    risks = self._scan_handler_risks(src)

                    info = {
                        "plugin": plugin_name,
                        "reserved": reserved,
                        "handler": handler_name,
                        "full_name": full_name,
                        "priority": priority,
                        "enabled": enabled,
                        "risks": risks,
                        "desc": (getattr(h, "desc", "") or "").strip()[:120],
                    }
                    handler_infos.append(info)

                    # 单 handler 级别冲突检测
                    if "event_stop" in risks:
                        conflicts.append({
                            "type": "event_stop",
                            "severity": "high",
                            "event_type": et_name,
                            "event_label": label,
                            "plugin": plugin_name,
                            "handler": handler_name,
                            "desc": f"在「{label}」钩子中调用了 stop_event()，"
                                    f"可能静默掐断其后所有同钩子处理器",
                        })
                    if "overwrite_system_prompt" in risks:
                        line_no = self._find_risk_lines(src, r"req\.system_prompt\s*=(?!\=)")
                        conflicts.append({
                            "type": "overwrite",
                            "severity": "medium",
                            "event_type": et_name,
                            "event_label": label,
                            "plugin": plugin_name,
                            "handler": handler_name,
                            "line": line_no,
                            "desc": f"在「{label}」钩子中覆盖式赋值 req.system_prompt，"
                                    f"会抹掉其它插件对该字段的修改",
                        })
                    if "overwrite_result" in risks:
                        conflicts.append({
                            "type": "overwrite",
                            "severity": "low",
                            "event_type": et_name,
                            "event_label": label,
                            "plugin": plugin_name,
                            "handler": handler_name,
                            "desc": f"在「{label}」钩子中调用 event.set_result()，"
                                    f"可能覆盖其它插件的装饰结果",
                        })
                except Exception as e:
                    logger.debug(f"[359debug] 解析 handler 异常: {e}")
                    continue

            # 按 priority 降序排（与框架执行顺序一致）
            handler_infos.sort(key=lambda x: -x.get("priority", 0))

            # 组级别冲突：多插件监听同一钩子
            external_plugins = {p for p in plugins_involved if p != "?"}
            multi_handler = len(external_plugins) > 1

            # 组级别冲突：多 handler 但全部默认优先级（顺序不稳定）
            priorities = [h.get("priority", 0) for h in handler_infos]
            same_priority = multi_handler and len(set(priorities)) == 1

            if multi_handler:
                conflicts.append({
                    "type": "multi_handler",
                    "severity": "high" if is_high_risk else "medium",
                    "event_type": et_name,
                    "event_label": label,
                    "count": len(handler_infos),
                    "plugins": sorted(external_plugins),
                    "desc": f"「{label}」钩子被 {len(external_plugins)} 个插件同时监听"
                            + ("，该钩子会修改共享对象，存在覆盖风险" if is_high_risk else
                               "，执行顺序由优先级/加载顺序决定"),
                })
            if same_priority:
                conflicts.append({
                    "type": "same_priority",
                    "severity": "low",
                    "event_type": et_name,
                    "event_label": label,
                    "priority": priorities[0] if priorities else 0,
                    "plugins": sorted(external_plugins),
                    "desc": f"「{label}」钩子的 {len(handler_infos)} 个 handler 优先级"
                            f"全为 {priorities[0] if priorities else 0}，执行顺序由"
                            f"插件加载顺序决定（不稳定）",
                })

            groups.append({
                "event_type": et_name,
                "label": label,
                "risk_level": "high" if is_high_risk else ("medium" if multi_handler else "low"),
                "count": len(handler_infos),
                "multi_plugin": multi_handler,
                "same_priority": same_priority,
                "handlers": handler_infos,
            })

        # 组排序：高风险 + 多 handler 的优先展示
        groups.sort(key=lambda g: (
            0 if g["risk_level"] == "high" else 1 if g["risk_level"] == "medium" else 2,
            -g["count"],
        ))
        # 冲突排序：severity high→low
        sev_order = {"high": 0, "medium": 1, "low": 2}
        conflicts.sort(key=lambda c: sev_order.get(c.get("severity", "low"), 3))

        return {
            "total_handlers": total,
            "total_event_types": len(groups),
            "groups": groups,
            "conflicts": conflicts,
            "conflict_count": len(conflicts),
            "high_risk_count": sum(1 for c in conflicts if c.get("severity") == "high"),
        }

    async def get_plugin_detail(self) -> dict:
        """插件分析详情。"""
        plugins = self.scan_plugins()
        active = sum(1 for p in plugins if p["activated"])
        security_alerts = self.scan_security()
        conflicts = await self.get_conflicts()
        hook_report = self.scan_hooks()
        high_alerts = sum(1 for a in security_alerts if a.get("severity") == "high")
        return {
            "plugins": plugins,
            "total": len(plugins),
            "active": active,
            "inactive": len(plugins) - active,
            "security_alerts": security_alerts,
            "high_alert_count": high_alerts,
            "conflicts": conflicts,
            "hooks": hook_report,
            "lifecycle_log": list(self._lifecycle_log),
        }

    def get_plugin_health(self) -> int:
        """插件健康度评分。综合安全告警 / 指令冲突 / 钩子冲突。"""
        security_alerts = self.scan_security()
        high = sum(1 for a in security_alerts if a.get("severity") == "high")
        # 指令冲突检查用同步方式查缓冲（避免在同步方法中跑 async）
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 在事件循环内，无法同步等待，用安全告警近似
                conflicts_count = 0
            else:
                conflicts_count = len(loop.run_until_complete(self.get_conflicts()))
        except Exception:
            conflicts_count = 0
        # 钩子冲突（同步扫描，零副作用）
        try:
            hook_report = self.scan_hooks()
            hook_high = hook_report.get("high_risk_count", 0)
            hook_total = hook_report.get("conflict_count", 0)
        except Exception:
            hook_high, hook_total = 0, 0
        if high > 0 or hook_high > 0:
            return 30
        if conflicts_count > 0 or hook_total > 2:
            return 70
        if hook_total > 0:
            return 85
        return 100

    async def fmt_plugin_oneline(self) -> str:
        """格式化一行摘要。"""
        plugins = self.scan_plugins()
        total = len(plugins)
        if total == 0:
            return "插件 ▸ 无数据 | 完整报告见 Pages"
        active = sum(1 for p in plugins if p["activated"])
        alerts = self.scan_security()
        high = sum(1 for a in alerts if a.get("severity") == "high")
        conflicts = await self.get_conflicts()
        parts = [f"已载{total}", f"激活{active}"]
        if high > 0:
            parts.append(f"⚠{high}高危")
        if conflicts:
            parts.append(f"{len(conflicts)}冲突")
        alert = " ⚠" if high > 0 or conflicts else ""
        return f"插件 ▸ {' '.join(parts)}{alert} | 完整报告见 Pages"

    def _pl_source_path(self, s) -> str | None:
        """定位插件源码文件。"""
        try:
            cls = getattr(s, "star_cls", None)
            if cls:
                return inspect.getsourcefile(cls) or inspect.getfile(cls)
        except Exception:
            pass
        root = getattr(s, "root_dir_name", None)
        if root:
            base = os.environ.get("ASTRBOT_DATA_PATH") or os.getcwd()
            return os.path.join(base, "data", "plugins", root, "main.py")
        return None
