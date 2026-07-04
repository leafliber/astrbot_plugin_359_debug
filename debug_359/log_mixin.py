"""
359度 Debug · L2 错误日志分析 Mixin

采集: on_plugin_error（实时）+ 按需读 astrbot.log 文件
查询方法: get_log_detail() / get_log_health() / fmt_log_oneline()
"""
from __future__ import annotations

import os
import re
from collections import Counter, deque
from typing import Any

from astrbot.api import logger
from astrbot.api.event import filter, AstrMessageEvent

from .utils import fingerprint, health_score_from_metric, truncate


class LogMixin:
    """错误日志分析。依赖 StoreMixin 的缓冲与日志路径。"""

    @filter.on_plugin_error()
    async def _lg_on_plugin_error(self, event: AstrMessageEvent, plugin_name: str,
                                  handler_name: str, error: str, traceback_text: str) -> None:
        """插件运行时异常 → 实时捕获（无需读文件）。"""
        if not self.is_enabled("log_analysis"):
            return
        try:
            self.record_log_error(
                level="ERROR",
                source=f"{plugin_name}/{handler_name}",
                msg=str(error)[:500],
                tb=traceback_text[:2000],
            )
            # 触发 SSE 告警
            self.emit_alert(
                "ERROR", plugin_name,
                f"{handler_name}: {str(error)[:200]}",
                "log",
            )
        except Exception as e:
            logger.debug(f"[359debug] 日志采集异常: {e}")

    # ==================== 日志文件读取 ====================

    def _lg_tail_file(self, path: str, n: int) -> list[str]:
        """读取文件尾部 n 行。"""
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return list(deque(f, maxlen=n))
        except Exception as e:
            logger.debug(f"[359debug] 读取日志失败: {e}")
            return []

    def _lg_parse_line(self, line: str) -> dict | None:
        """解析 AstrBot 标准 logging 格式日志行，提取级别/时间/内容。

        AstrBot 日志格式（log.py LogManager._add_file_handler）：
          [时间] [plugin_tag] [LEVEL][version_tag] [filename:lineno]: message
        示例：
          [2024-01-01 12:00:00] [INFO] [core.py:123]: 消息内容
          [2024-01-01 12:00:00] [my_plugin] [INFO][v4.26] [handler.py:45]: 消息
        同时兼容 loguru 等其他常见格式作为回退。
        """
        line = line.strip()
        if not line:
            return None

        # 方案1：AstrBot 标准格式
        # [时间] (可选 [tag]...） [LEVEL](可选 [version]) [file:line]: message
        m = re.match(
            r"\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]"    # [时间]
            r"(?:\s*\[[^\]]*\])*?"                                # 可选的 [tag]
            r"\s*\[(\w+)\]"                                       # [LEVEL]
            r"(?:\[[^\]]*\])?"                                    # 可选 [version]
            r"\s*\[([^\]:]+):(\d+)\]:"                            # [file:line]:
            r"\s*(.+)",                                           # message
            line,
        )
        if m:
            return {
                "time": m.group(1),
                "level": m.group(2).upper(),
                "module": f"{m.group(3)}:{m.group(4)}",
                "msg": m.group(5)[:500],
            }

        # 方案2：AstrBot 无文件位置的简化格式
        # [时间] ... [LEVEL]: message
        m = re.match(
            r"\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]"
            r"(?:\s*\[[^\]]*\])*?"
            r"\s*\[(\w+)\]"
            r"(?:[^\]]*\])?"
            r"[:\s]*(.+)",
            line,
        )
        if m:
            return {
                "time": m.group(1),
                "level": m.group(2).upper(),
                "module": "",
                "msg": m.group(3)[:500],
            }

        # 方案3：loguru 风格回退（旧格式兼容）
        m = re.match(
            r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*\[(\w+)\]\s*(.+?)\s*-\s*(.+)",
            line,
        )
        if m:
            return {
                "time": m.group(1), "level": m.group(2).upper(),
                "module": m.group(3), "msg": m.group(4)[:500],
            }

        # 方案4：简单级别匹配（无时间戳的行）
        for level in ("ERROR", "CRITICAL", "WARNING", "WARN", "INFO", "DEBUG"):
            if f"[{level}]" in line:
                return {"time": "", "level": level, "module": "", "msg": line[:500]}
        return None

    # ==================== 查询/聚合 ====================

    async def get_log_detail(self, level: str | None = None,
                             plugin: str | None = None, limit: int = 500) -> dict:
        """日志详情。

        Args:
            limit: 返回的日志条目上限（最终结果条数）。
                   文件读取行数会按 limit 动态放大（×4），确保解析后条目足够。
        """
        # 安全上限，避免一次性读取过多导致性能问题
        limit = max(1, min(int(limit), 5000))
        # 1. 文件日志 —— 读取行数按 limit 动态放大，至少读取配置的 log_tail_lines
        log_path = self.get_log_file_path()
        file_entries = []
        file_exists = os.path.isfile(log_path)
        if file_exists:
            cfg_lines = int(self.cfg("log_tail_lines", 500))
            n = max(cfg_lines, limit * 4)
            lines = self._lg_tail_file(log_path, n)
            for line in lines:
                parsed = self._lg_parse_line(line)
                if parsed:
                    file_entries.append(parsed)
        # 2. on_plugin_error 捕获的运行时错误
        runtime_entries = []
        for e in self.get_log_entries():
            runtime_entries.append({
                "time": str(e.get("ts", "")), "level": e.get("level", "ERROR"),
                "module": e.get("source", ""), "msg": e.get("msg", ""),
                "tb": e.get("tb", ""),
            })
        all_entries = runtime_entries + file_entries
        # 过滤
        if level:
            all_entries = [e for e in all_entries if e.get("level", "").upper() == level.upper()]
        if plugin:
            all_entries = [e for e in all_entries if plugin.lower() in e.get("module", "").lower()]
        all_entries = all_entries[-limit:]
        # 按级别统计
        by_level = Counter(e.get("level", "UNKNOWN") for e in all_entries)
        # 指纹聚类去重
        clusters: dict[str, dict] = {}
        for e in all_entries:
            fp = fingerprint(e.get("msg", "") + e.get("tb", ""))
            if fp not in clusters:
                clusters[fp] = {"fingerprint": fp, "count": 0, "sample": e, "level": e.get("level")}
            clusters[fp]["count"] += 1
        cluster_list = sorted(clusters.values(), key=lambda x: -x["count"])[:20]

        # 生成提示信息
        if file_exists:
            hint = ""
        elif self.is_log_file_enabled():
            hint = f"日志文件已启用但未找到：{log_path}（请检查路径配置）"
        else:
            hint = "日志文件未开启，请在面板开启 log_file_enable"

        return {
            "entries": all_entries,
            "clusters": cluster_list,
            "total_by_level": dict(by_level),
            "file_available": file_exists,
            "file_path": log_path,
            "hint": hint,
        }

    def get_log_health(self) -> int:
        """日志健康度评分（基于近 24h ERROR 数）。"""
        entries = self.get_log_entries()
        # 也检查文件日志
        log_path = self.get_log_file_path()
        if os.path.isfile(log_path):
            lines = self._lg_tail_file(log_path, 500)
            file_errors = sum(1 for l in lines if "[ERROR]" in l or "[CRITICAL]" in l)
            total_errors = len(entries) + file_errors
        else:
            total_errors = len(entries)
        return health_score_from_metric(total_errors, [(0, 100), (5, 80), (20, 60), (9999, 40)])

    def fmt_log_oneline(self) -> str:
        """格式化一行摘要。"""
        entries = self.get_log_entries()
        err_count = sum(1 for e in entries if e.get("level") == "ERROR")
        warn_count = sum(1 for e in entries if e.get("level") in ("WARN", "WARNING"))
        # 也统计文件日志
        log_path = self.get_log_file_path()
        if os.path.isfile(log_path):
            lines = self._lg_tail_file(log_path, 500)
            for l in lines:
                if "[ERROR]" in l or "[CRITICAL]" in l:
                    err_count += 1
                elif "[WARNING]" in l or "[WARN]" in l:
                    warn_count += 1
        if err_count == 0 and warn_count == 0:
            return "日志 ▸ 无异常 | 完整报告见 Pages"
        last = entries[-1] if entries else {}
        last_msg = truncate(last.get("msg", ""), 60) if last else ""
        alert = " ⚠" if err_count > 0 else ""
        return (f"日志 ▸ ERROR:{err_count} WARN:{warn_count}"
                f"{' 最近:' + last_msg if last_msg else ''}{alert} | 完整报告见 Pages")
