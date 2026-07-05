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
        self._hb("_pl_on_loaded")
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
        self._hb("_pl_on_unloaded")
        # on_plugin_unloaded 钩子无 event 参数，无法记录 stop 状态
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
    # AstrBot 钩子机制：star_handlers_registry 全局单例，按优先级降序串行 await。
    # 评估原则：
    #   - 静态扫描只能识别"潜在风险" → 默认评 info / low
    #   - 只有"运行时实证"（真的被 stop / 真的覆盖）才升级为 high
    #   - 用户可基于实证告警精准定位问题，而非淹没在潜在风险里

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

    # 共享可变对象钩子：多插件同时改同一对象，覆盖/竞改风险更高
    _SHARED_OBJ_HOOKS = {
        "OnLLMRequestEvent",         # req: ProviderRequest
        "OnDecoratingResultEvent",   # result: MessageEventResult
        "OnLLMResponseEvent",        # response: LLMResponse
    }

    # 运行时观测缓冲：记录自身钩子真实见到的事件
    # 结构: { event_type_name: { "calls": N, "stopped": M, "last_order": [...] } }
    # （实例变量，在 StoreMixin.__init__ 中初始化）

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

    def _get_star_registry_list(self):
        """安全获取全局 star_registry（list[StarMetadata]）。"""
        try:
            from astrbot.core.star.star import star_registry
            return star_registry or []
        except Exception:
            return []

    def _get_self_plugin_name(self) -> str | None:
        """识别本插件（诊断工具自身）的插件名。

        通过 star_registry 中 star_cls is self 的元数据定位，
        用于在钩子全景图中过滤掉本插件自身的诊断钩子（避免噪声）。
        """
        if self._self_plugin_name_cache is not None:
            return self._self_plugin_name_cache
        try:
            for meta in self._get_star_registry_list():
                if getattr(meta, "star_cls", None) is self:
                    name = getattr(meta, "name", None) or getattr(meta, "display_name", None)
                    if name:
                        self._self_plugin_name_cache = name
                        return name
        except Exception:
            pass
        return None

    def _resolve_plugin_name(self, handler, star_map) -> str:
        """从 handler 的模块路径解析所属插件名。

        匹配优先级：
          1. star_map 精确匹配 handler_module_path
          2. 前缀匹配：handler_module_path 在 star_map 某个键的"包"下
             （处理 mixin 模块路径与 Main 类模块路径不一致的情况：
              handler.__module__ 形如 ...debug_359.context_mixin，
              而 star_map 键是 ...main，共同前缀是插件根包）
          3. 从路径段中提取 astrbot_plugin_* 形态的段名
          4. 兜底 "?"
        """
        module_path = getattr(handler, "handler_module_path", "") or ""
        # 1. 精确匹配
        meta = star_map.get(module_path)
        if meta and getattr(meta, "name", None):
            return meta.name
        # 2. 包前缀匹配：找 star_map 中"包前缀"最长的命中
        best_meta = None
        best_len = 0
        for key, m in star_map.items():
            if not key:
                continue
            pkg = key.rsplit(".", 1)[0] if "." in key else key
            if module_path.startswith(pkg + ".") and len(pkg) > best_len:
                best_meta = m
                best_len = len(pkg)
        if best_meta and getattr(best_meta, "name", None):
            return best_meta.name
        # 3. 路径段提取 astrbot_plugin_*
        for seg in module_path.split("."):
            if seg.startswith("astrbot_plugin"):
                return seg
        # 4. AstrBot 保留插件判断
        if module_path.startswith("astrbot."):
            return "astrbot"
        return "?"

    def _resolve_plugin_reserved(self, handler, star_map) -> bool:
        """判断 handler 所属插件是否为保留插件。"""
        try:
            module_path = getattr(handler, "handler_module_path", "")
            meta = star_map.get(module_path)
            if meta:
                return bool(getattr(meta, "reserved", False))
            # 包前缀匹配
            for key, m in star_map.items():
                if not key:
                    continue
                pkg = key.rsplit(".", 1)[0] if "." in key else key
                if module_path.startswith(pkg + "."):
                    return bool(getattr(m, "reserved", False))
        except Exception:
            pass
        return False

    def _read_handler_body(self, handler) -> str:
        """只读取 handler 函数自身的源码（不含文件其它部分）。

        关键：必须用 inspect.getsource(handler_fn) 而非读取整个 .py 文件，
        否则会把同文件中其它代码（注释、正则字符串、scan_security 等）误判为
        handler 的行为，产生大量误报。
        """
        try:
            fn = getattr(handler, "handler", None)
            if fn is None:
                return ""
            return inspect.getsource(fn) or ""
        except (OSError, TypeError):
            # 取不到函数源码（动态包装/C 扩展），降级到空字符串
            return ""
        except Exception:
            return ""

    def _scan_handler_risks(self, code: str) -> list:
        """扫描 handler 函数体的静态风险点。"""
        risks = []
        if not code:
            return risks
        # 移除注释和字符串字面量，避免把正则字符串/文档当代码匹配
        cleaned = self._strip_python_noise(code)
        # A 类：事件终止（掐断后续 handler）
        if re.search(r"\.stop_event\s*\(", cleaned):
            risks.append("event_stop")
        # B 类：覆盖式赋值共享对象（仅 '=' 非 '+=' '=='）
        if re.search(r"\breq\.system_prompt\s*=(?!\=)", cleaned) and \
           not re.search(r"\breq\.system_prompt\s*\+=", cleaned):
            risks.append("overwrite_system_prompt")
        if re.search(r"\bevent\.set_result\s*\(", cleaned):
            risks.append("overwrite_result")
        return risks

    @staticmethod
    def _strip_python_noise(code: str) -> str:
        """粗略剔除 Python 源码中的注释、字符串字面量。

        用于静态风险扫描，避免把正则模式字符串/文档字符串误判为代码。
        采用正则方案，足够稳健且简洁。
        """
        try:
            # 1) 去多行字符串（docstring）— 优先处理避免被单行规则破坏
            text = re.sub(r'"""[\s\S]*?"""', ' ', code)
            text = re.sub(r"'''[\s\S]*?'''", " ", text)
            # 2) 去单行字符串字面量
            text = re.sub(r'"(\\.|[^"\\])*"', ' "" ', text)
            text = re.sub(r"'(\\.|[^'\\])*'", " '' ", text)
            # 3) 去行注释（字符串已移除，# 必为注释）
            text = re.sub(r'#[^\n]*', '', text)
            return text
        except Exception:
            return code

    def _record_hook_runtime(self, event_type_name: str, stopped: bool, order: list) -> None:
        """由自身注册的钩子调用，记录运行时实证数据。

        Args:
            event_type_name: 如 'OnLLMRequestEvent'
            stopped: 本次事件是否被 stop
            order: 本次实际执行顺序 [plugin_name, ...]
        """
        try:
            slot = self._hook_runtime_log.setdefault(event_type_name, {
                "calls": 0, "stopped": 0, "last_order": [], "last_ts": 0.0,
            })
            slot["calls"] += 1
            if stopped:
                slot["stopped"] += 1
            slot["last_order"] = order[-20:]
            slot["last_ts"] = __import__("time").time()
        except Exception:
            pass

    def _build_hook_conflicts(self, et_name: str, label: str, handler_infos: list,
                              plugins_involved: set, runtime: dict | None) -> list:
        """为一个钩子构建冲突条目列表（按类型聚合，便于前端折叠展示）。"""
        conflicts = []
        is_shared_obj = et_name in self._SHARED_OBJ_HOOKS
        external = {p for p in plugins_involved if p and p != "?"}
        multi = len(external) > 1
        priorities = [h.get("priority", 0) for h in handler_infos]
        same_pri = multi and len(set(priorities)) <= 1

        # 运行时实证数据
        rt_calls = (runtime or {}).get("calls", 0)
        rt_stopped = (runtime or {}).get("stopped", 0)
        rt_stop_rate = (rt_stopped / rt_calls) if rt_calls else 0.0
        has_rt = rt_calls > 0

        # ① 多插件监听（静态潜在）
        if multi:
            base = f"「{label}」钩子被 {len(external)} 个插件同时监听"
            if is_shared_obj:
                desc = base + "，共享可变对象，存在潜在覆盖风险"
            else:
                desc = base + "，执行顺序由优先级/加载顺序决定"
            # 共用钩子是 AstrBot 插件生态的普遍现象，纯静态时归为 info（潜在）
            # 仅当有运行时 stop 实证时才升级：
            #   共享对象 + 实际 stop → high；非共享 + 实际 stop → medium
            if has_rt and rt_stopped > 0:
                sev = "high" if is_shared_obj else "medium"
            else:
                sev = "info"
            conflicts.append({
                "type": "multi_handler",
                "severity": sev,
                "static": True,
                "event_type": et_name,
                "event_label": label,
                "count": len(handler_infos),
                "plugins": sorted(external),
                "shared_obj": is_shared_obj,
                "runtime_evidence": has_rt and rt_stopped > 0,
                "desc": desc,
            })

        # ② 同优先级（静态潜在，仅 multi 时才有意义）
        if same_pri:
            conflicts.append({
                "type": "same_priority",
                "severity": "info",
                "static": True,
                "event_type": et_name,
                "event_label": label,
                "priority": priorities[0] if priorities else 0,
                "plugins": sorted(external),
                "desc": f"「{label}」钩子的 {len(handler_infos)} 个 handler 优先级全为 "
                        f"{priorities[0] if priorities else 0}，执行顺序由插件加载顺序决定",
            })

        # ③ handler 级别：stop_event / 覆盖赋值（静态）
        for h in handler_infos:
            for risk in h.get("risks", []):
                if risk == "event_stop":
                    # 有运行时实证 stop → high；仅静态 → medium
                    sev = "high" if (has_rt and rt_stopped > 0) else "medium"
                    conflicts.append({
                        "type": "event_stop",
                        "severity": sev,
                        "static": True,
                        "runtime_evidence": has_rt and rt_stopped > 0,
                        "event_type": et_name,
                        "event_label": label,
                        "plugin": h.get("plugin"),
                        "handler": h.get("handler"),
                        "desc": f"{h.get('plugin')}.{h.get('handler')} 可能调用 stop_event()",
                    })
                elif risk == "overwrite_system_prompt":
                    conflicts.append({
                        "type": "overwrite",
                        "severity": "medium",
                        "static": True,
                        "event_type": et_name,
                        "event_label": label,
                        "plugin": h.get("plugin"),
                        "handler": h.get("handler"),
                        "desc": f"{h.get('plugin')}.{h.get('handler')} 覆盖式赋值 req.system_prompt",
                    })
                elif risk == "overwrite_result":
                    conflicts.append({
                        "type": "overwrite",
                        "severity": "low",
                        "static": True,
                        "event_type": et_name,
                        "event_label": label,
                        "plugin": h.get("plugin"),
                        "handler": h.get("handler"),
                        "desc": f"{h.get('plugin')}.{h.get('handler')} 调用 event.set_result()",
                    })

        # ④ 运行时实证：真的发生过 stop
        if has_rt and rt_stopped > 0:
            conflicts.append({
                "type": "runtime_stop",
                "severity": "high",
                "static": False,
                "runtime_evidence": True,
                "event_type": et_name,
                "event_label": label,
                "calls": rt_calls,
                "stopped": rt_stopped,
                "stop_rate": round(rt_stop_rate * 100, 1),
                "last_order": (runtime or {}).get("last_order", []),
                "desc": f"「{label}」运行时观测 {rt_calls} 次调用中有 {rt_stopped} 次 "
                        f"({rt_stop_rate*100:.1f}%) 被 stop_event() 终止",
            })

        return conflicts

    def scan_hooks(self, include_self: bool = False) -> dict:
        """钩子全景图 + 冲突检测。

        评级原则（4 级）：
          - high（高危）：运行时实证 — 真的发生过 stop_event 终止
          - medium（中危）：静态扫描发现 stop_event/覆盖赋值等具体风险代码
          - low（低危）：较轻的静态风险（如 set_result 覆盖）
          - info（潜在/蓝色）：共用钩子等普遍现象，仅作提示，不算危险
        运行时数据由本插件自身注册的全套钩子上报，零侵入其它插件。

        Args:
            include_self: 是否包含本插件（诊断工具自身）注册的钩子。
                          默认 False —— 自身的诊断钩子是观测工具而非被分析对象，
                          会作为噪声污染全景图，故默认隐藏。
        """
        registry = self._get_star_registry()
        if registry is None:
            return {"total_handlers": 0, "groups": [], "conflicts": [],
                    "total_event_types": 0, "conflict_count": 0, "high_risk_count": 0,
                    "error": "无法访问 star_handlers_registry"}

        star_map = self._get_star_map()
        self_name = self._get_self_plugin_name()

        # 1. 按 event_type 分组
        by_event: dict[str, list] = {}
        try:
            handlers_iter = list(iter(registry))
        except Exception:
            handlers_iter = getattr(registry, "_handlers", []) or []

        total = 0
        self_handler_count = 0
        for h in handlers_iter:
            try:
                # 提前判定归属，用于过滤自身
                resolved_name = self._resolve_plugin_name(h, star_map)
                if not include_self and self_name and resolved_name == self_name:
                    self_handler_count += 1
                    continue
                et_name = getattr(getattr(h, "event_type", None), "name", "Unknown")
            except Exception:
                et_name = "Unknown"
                resolved_name = "?"
            by_event.setdefault(et_name, []).append((h, resolved_name))
            total += 1

        groups = []
        all_conflicts = []

        for et_name, items in by_event.items():
            label = self._HOOK_NAMES.get(et_name, et_name)
            is_shared_obj = et_name in self._SHARED_OBJ_HOOKS
            handler_infos = []
            plugins_involved = set()

            for h, plugin_name in items:
                try:
                    reserved = self._resolve_plugin_reserved(h, star_map)
                    plugins_involved.add(plugin_name)
                    body = self._read_handler_body(h)  # 只读函数体，修误报
                    risks = self._scan_handler_risks(body)
                    handler_infos.append({
                        "plugin": plugin_name,
                        "reserved": reserved,
                        "handler": getattr(h, "handler_name", "?"),
                        "full_name": getattr(h, "handler_full_name", "?"),
                        "priority": getattr(h, "extras_configs", {}).get("priority", 0),
                        "enabled": bool(getattr(h, "enabled", True)),
                        "risks": risks,
                        "desc": (getattr(h, "desc", "") or "").strip()[:120],
                    })
                except Exception as e:
                    logger.debug(f"[359debug] 解析 handler 异常: {e}")
                    continue

            # 按 priority 降序（与框架执行顺序一致）
            handler_infos.sort(key=lambda x: -x.get("priority", 0))

            runtime = self._hook_runtime_log.get(et_name)
            conflicts = self._build_hook_conflicts(
                et_name, label, handler_infos, plugins_involved, runtime
            )

            # 组 risk_level：取本组 conflicts 最高 severity
            sev_rank = {"high": 3, "medium": 2, "low": 1, "info": 0}
            group_risk = max(
                (sev_rank.get(c.get("severity", "info"), 0) for c in conflicts),
                default=0,
            )
            risk_level = next(
                (k for k, v in sev_rank.items() if v == group_risk),
                "info",
            )

            groups.append({
                "event_type": et_name,
                "label": label,
                "risk_level": risk_level,
                "shared_obj": is_shared_obj,
                "count": len(handler_infos),
                "multi_plugin": len({p for p in plugins_involved if p and p != "?"}) > 1,
                "runtime": {
                    "calls": (runtime or {}).get("calls", 0),
                    "stopped": (runtime or {}).get("stopped", 0),
                    "has_evidence": bool(runtime and runtime.get("stopped", 0) > 0),
                } if runtime else None,
                "handlers": handler_infos,
                "conflicts": conflicts,  # 嵌入到组内，便于前端折叠展示
            })
            all_conflicts.extend(conflicts)

        # 组排序：风险高的在前
        groups.sort(key=lambda g: -sev_rank.get(g["risk_level"], 0))
        # 冲突排序：severity high→info
        all_conflicts.sort(key=lambda c: -sev_rank.get(c.get("severity", "info"), 0))

        return {
            "total_handlers": total,
            "total_event_types": len(groups),
            "groups": groups,
            "conflicts": all_conflicts,
            "conflict_count": sum(1 for c in all_conflicts if c.get("severity") != "info"),
            "high_risk_count": sum(1 for c in all_conflicts if c.get("severity") == "high"),
            "medium_count": sum(1 for c in all_conflicts if c.get("severity") == "medium"),
            "low_count": sum(1 for c in all_conflicts if c.get("severity") == "low"),
            "info_count": sum(1 for c in all_conflicts if c.get("severity") == "info"),
            "normal_group_count": sum(1 for g in groups if not g.get("conflicts")),
            "runtime_tracked": list(self._hook_runtime_log.keys()),
            "self_plugin": self_name,
            "self_handler_count": self_handler_count,
            "include_self": include_self,
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

    async def get_plugin_health(self) -> int:
        """插件健康度评分。综合安全告警 / 指令冲突 / 钩子冲突。"""
        security_alerts = self.scan_security()
        high = sum(1 for a in security_alerts if a.get("severity") == "high")
        # 指令冲突检查（async 查询 DB）
        try:
            conflicts = await self.get_conflicts()
            conflicts_count = len(conflicts)
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
