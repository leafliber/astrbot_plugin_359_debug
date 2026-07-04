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

    async def get_plugin_detail(self) -> dict:
        """插件分析详情。"""
        plugins = self.scan_plugins()
        active = sum(1 for p in plugins if p["activated"])
        security_alerts = self.scan_security()
        conflicts = await self.get_conflicts()
        high_alerts = sum(1 for a in security_alerts if a.get("severity") == "high")
        return {
            "plugins": plugins,
            "total": len(plugins),
            "active": active,
            "inactive": len(plugins) - active,
            "security_alerts": security_alerts,
            "high_alert_count": high_alerts,
            "conflicts": conflicts,
            "lifecycle_log": list(self._lifecycle_log),
        }

    def get_plugin_health(self) -> int:
        """插件健康度评分。"""
        security_alerts = self.scan_security()
        high = sum(1 for a in security_alerts if a.get("severity") == "high")
        # 冲突检查用同步方式查缓冲（避免在同步方法中跑 async）
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
        if high > 0:
            return 30
        if conflicts_count > 0:
            return 70
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
