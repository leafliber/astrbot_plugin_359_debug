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
        self._hb("_lg_on_plugin_error", event=event, event_type="OnPluginErrorEvent")
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
        # limit = -1 表示读取全部；否则限制在 1-5000
        read_all = int(limit) == -1
        if not read_all:
            limit = max(1, min(int(limit), 5000))
        # 1. 文件日志 —— 读取行数按 limit 动态放大，至少读取配置的 log_tail_lines
        log_path = self.get_log_file_path()
        file_entries = []
        file_exists = os.path.isfile(log_path)
        if file_exists:
            cfg_lines = int(self.cfg("log_tail_lines", 500))
            n = cfg_lines * 20 if read_all else max(cfg_lines, limit * 4)
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
        if not read_all:
            all_entries = all_entries[-limit:]
        # 按级别统计
        by_level = Counter(e.get("level", "UNKNOWN") for e in all_entries)
        # 指纹聚类去重 —— 仅聚类 WARN/ERROR 及内容含错误关键词的 INFO/DEBUG
        _ERR_KEYWORDS = (
            "error", "exception", "traceback", "failed", "failure",
            "fatal", "critical", "warning", "warn ", "crash", "abort",
            "timeout", "refused", "denied", "unreachable", "broken",
        )

        def _is_clusterworthy(e: dict) -> bool:
            """判断该日志条是否值得进入错误聚类。"""
            lvl = (e.get("level", "") or "").upper()
            if lvl in ("ERROR", "CRITICAL", "FATAL", "WARN", "WARNING"):
                return True
            # INFO / DEBUG：消息内容含错误关键词才纳入
            msg = (e.get("msg", "") + " " + e.get("tb", "")).lower()
            return any(kw in msg for kw in _ERR_KEYWORDS)

        clusters: dict[str, dict] = {}
        for e in all_entries:
            if not _is_clusterworthy(e):
                continue
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

        # WARN/ERROR 智能诊断
        try:
            diag_limit = -1 if read_all else limit
            diagnosis = self.diagnose_log_errors(limit=abs(diag_limit) if diag_limit > 0 else 500)
        except Exception as e:
            logger.debug(f"[359debug] 日志诊断异常: {e}")
            diagnosis = {"total_issues": 0, "diagnoses": [], "summary": f"诊断失败: {e}"}

        return {
            "entries": all_entries,
            "clusters": cluster_list,
            "total_by_level": dict(by_level),
            "file_available": file_exists,
            "file_path": log_path,
            "hint": hint,
            "diagnosis": diagnosis,
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

    # ==================== WARN/ERROR 智能诊断 ====================
    # 纯规则引擎（不依赖 LLM）：基于正则/关键词模式匹配，对 WARN/ERROR 日志
    # 做分类、根因分析、修复建议。零侵入、可离线、稳定可靠。

    # 诊断规则表：(category, label, severity, patterns, root_cause, suggestion)
    # severity 仅作为该分类的"默认基线"，实际命中后会根据出现次数微调
    _DIAG_RULES: list[tuple] = [
        # —— 网络/连接 ——
        ("network", "网络连接", "high",
         [r"ConnectionError", r"ConnectionRefusedError", r"connection refused",
          r"Network is unreachable", r"getaddrinfo failed", r"NameResolutionError",
          r"NewConnectionError", r"Max retries exceeded", r"Failed to establish"],
         "目标服务不可达 / DNS 解析失败 / 网络不通",
         "检查网络连接、DNS、代理配置；确认目标服务（LLM API、平台适配器）在线"),

        ("timeout", "请求超时", "medium",
         [r"TimeoutError", r"timed?\s?out", r"ReadTimeout", r"ConnectTimeout",
          r"ReadTimeoutError", r"asyncio\.exceptions\.TimeoutError"],
         "请求耗时过长被中断",
         "增大超时配置；检查网络延迟；考虑加重试/降级策略"),

        # —— 鉴权/密钥 ——
        ("auth", "鉴权失败", "high",
         [r"\b401\b", r"\b403\b", r"Unauthorized", r"Forbidden",
          r"invalid[_ ]api[_ ]?key", r"API\s*key", r"authentication failed",
          r"access denied", r"invalid token", r"token.*invalid", r"expired"],
         "API 密钥无效 / 过期 / 权限不足",
         "在面板检查 LLM Provider 的 API Key；确认账户余额、配额、权限范围"),

        ("rate_limit", "限流/配额", "medium",
         [r"\b429\b", r"rate.?limit", r"Too Many Requests", r"quota",
          r"quota exceeded", r"rate limit exceeded", r"Please try again later"],
         "API 调用频率超限或套餐额度耗尽",
         "降低调用频率；升级 API 套餐；加退避重试；启用 Token 缓存"),

        # —— Provider/模型 ——
        ("provider", "模型/Provider", "medium",
         [r"model not found", r"invalid model", r"does not exist",
          r"context.?length", r"context window", r"maximum context",
          r"max_tokens", r"tokens.*exceed", r"context_length_exceeded"],
         "模型不存在 / 上下文超限 / 参数错误",
         "检查 Provider 配置的模型名是否正确；缩短对话上下文；降低 max_tokens"),

        # —— 依赖缺失 ——
        ("dependency", "依赖缺失", "high",
         [r"ModuleNotFoundError", r"ImportError", r"No module named",
          r"DLL load failed", r"cannot find module"],
         "缺少 Python 依赖包",
         "在插件环境安装依赖：根据报错 pip install <包名>；重启 AstrBot"),

        # —— JSON 解析 ——
        ("json_parse", "JSON 解析", "medium",
         [r"JSONDecodeError", r"json\.decoder", r"Expecting value",
          r"invalid json", r"Unterminated string", r"unmarshal"],
         "LLM 返回非合法 JSON / 响应被截断",
         "检查 LLM 响应稳定性；强化 prompt 约束 JSON 格式；加解析容错"),

        # —— 文件/IO ——
        ("file_io", "文件/权限", "medium",
         [r"FileNotFoundError", r"PermissionError", r"\[Errno 13\]",
          r"\[Errno 2\]", r"No such file", r"Read-only file system"],
         "文件不存在或权限不足",
         "检查文件路径配置；确认读写权限；检查磁盘空间"),

        # —— 数据库 ——
        ("database", "数据库", "medium",
         [r"sqlite3?", r"database.*error", r"OperationalError", r"IntegrityError",
          r"database is locked", r"no such table", r"unique constraint"],
         "数据库损坏 / 锁竞争 / 表结构不一致",
         "检查 DB 文件是否被占用；备份数据后重建；检查并发写入"),

        # —— SSL/证书 ——
        ("ssl", "SSL/证书", "medium",
         [r"SSLError", r"certificate", r"SSL:", r"CERTIFICATE_VERIFY_FAILED",
          r"unsafe legacy renegotiation"],
         "SSL 证书过期/不受信/校验失败",
         "更新根证书；检查系统时间是否准确；检查 Python/openssl 版本"),

        # —— 内存/资源 ——
        ("resource", "内存/资源", "high",
         [r"MemoryError", r"Out of memory", r"\bOOM\b", r"Killed",
          r"Cannot allocate memory"],
         "内存耗尽 / 被系统 OOM Killer 终止",
         "减少并发会话；排查内存泄漏；增加内存上限"),

        # —— 插件代码 ——
        ("plugin_code", "插件代码异常", "medium",
         [r"Traceback", r"AttributeError", r"TypeError", r"NameError",
          r"ValueError", r"IndexError", r"KeyError", r"NotImplementedError",
          r"ZeroDivisionError", r"RecursionError"],
         "插件代码抛出未处理异常",
         "查看完整 Traceback 定位代码行；联系插件作者或检查自身代码"),
    ]

    def diagnose_log_errors(self, limit: int = 500) -> dict:
        """对 WARN/ERROR 日志做智能诊断（纯规则引擎）。

        流程：
          1. 收集 WARN/ERROR 日志条目（文件 + 运行时捕获）
          2. 逐条匹配规则表，命中即累加到对应分类
          3. 输出每类的根因分析 + 修复建议 + 证据样例
          4. 未命中的条目作为 unmatched_samples 返回（供 LLM 进一步分析）

        Returns:
            {
                total_issues: 命中的诊断分类数,
                total_affected: 涉及的日志条数,
                max_severity: 最高严重级别,
                diagnoses: [...],  # 按 severity 排序
                unmatched_samples: [...],  # 未匹配的 ERROR/WARN 样例（最多5条）
                summary: 一行人类可读总结,
            }
        """
        # 1. 收集 WARN/ERROR 条目
        log_path = self.get_log_file_path()
        file_entries = []
        if os.path.isfile(log_path):
            n = max(int(self.cfg("log_tail_lines", 500)), limit * 2)
            for line in self._lg_tail_file(log_path, n):
                parsed = self._lg_parse_line(line)
                if parsed and parsed.get("level", "").upper() in (
                    "ERROR", "CRITICAL", "FATAL", "WARN", "WARNING"
                ):
                    file_entries.append(parsed)
        runtime_entries = []
        for e in self.get_log_entries():
            lvl = (e.get("level") or "").upper()
            if lvl in ("ERROR", "CRITICAL", "FATAL", "WARN", "WARNING"):
                runtime_entries.append({
                    "time": str(e.get("ts", "")),
                    "level": e.get("level", "ERROR"),
                    "module": e.get("source", ""),
                    "msg": e.get("msg", ""),
                    "tb": e.get("tb", ""),
                })
        candidates = (runtime_entries + file_entries)[-limit:]
        if not candidates:
            return {
                "total_issues": 0, "total_affected": 0,
                "max_severity": "none", "diagnoses": [],
                "unmatched_samples": [], "summary": "无 WARN/ERROR 日志，状态良好",
            }

        # 2. 逐条匹配
        # 每个分类的累计结构
        buckets: dict[str, dict] = {}
        matched_entry_ids = set()
        for idx, e in enumerate(candidates):
            text = f"{e.get('msg', '')}\n{e.get('tb', '')}"
            for cat, label, base_sev, patterns, root_cause, suggestion in self._DIAG_RULES:
                hit = None
                for pat in patterns:
                    m = re.search(pat, text, re.IGNORECASE)
                    if m:
                        hit = m.group(0)
                        break
                if hit:
                    matched_entry_ids.add(idx)
                    b = buckets.setdefault(cat, {
                        "category": cat,
                        "category_label": label,
                        "base_severity": base_sev,
                        "root_cause": root_cause,
                        "suggestion": suggestion,
                        "count": 0,
                        "evidence": [],
                        "sources": set(),
                        "first_seen": None,
                        "last_seen": None,
                        "levels": set(),
                    })
                    b["count"] += 1
                    b["levels"].add(e.get("level", "ERROR"))
                    if len(b["evidence"]) < 3:
                        # 证据 = 命中片段 + 上下文（最多 120 字）
                        snippet = self._extract_evidence(text, hit)
                        b["evidence"].append(snippet)
                    src = e.get("module", "") or ""
                    if src:
                        b["sources"].add(src)
                    t = e.get("time", "")
                    if t:
                        if b["first_seen"] is None or t < b["first_seen"]:
                            b["first_seen"] = t
                        if b["last_seen"] is None or t > b["last_seen"]:
                            b["last_seen"] = t
                    # 一个条目命中一个分类即可（避免重复计数）
                    break

        # 3. 计算每类最终 severity（根据次数微调）
        sev_rank = {"high": 3, "medium": 2, "low": 1}
        diagnoses = []
        for cat, b in buckets.items():
            base = b["base_severity"]
            cnt = b["count"]
            # 高频（>=5）且基线 medium → 升级 high；基线 high 永远 high；基线 medium 单次仍 medium
            if base == "high":
                final = "high"
            elif base == "medium":
                final = "high" if cnt >= 5 else "medium"
            else:
                final = "medium" if cnt >= 5 else "low"
            diagnoses.append({
                "category": cat,
                "category_label": b["category_label"],
                "severity": final,
                "count": cnt,
                "levels": sorted(b["levels"]),
                "root_cause": b["root_cause"],
                "suggestion": b["suggestion"],
                "evidence": b["evidence"],
                "sources": sorted(s for s in b["sources"] if s)[:5],
                "first_seen": b["first_seen"],
                "last_seen": b["last_seen"],
            })
        diagnoses.sort(key=lambda d: -sev_rank.get(d["severity"], 0))

        # 4. 未匹配样例
        unmatched = []
        for idx, e in enumerate(candidates):
            if idx not in matched_entry_ids:
                msg = (e.get("msg", "") or "")[:200]
                if msg:
                    unmatched.append({
                        "level": e.get("level"),
                        "module": e.get("module", ""),
                        "msg": msg,
                        "time": e.get("time", ""),
                    })
        # 去重 + 限量
        seen_msgs = set()
        unique_unmatched = []
        for u in unmatched:
            key = u["msg"][:60]
            if key in seen_msgs:
                continue
            seen_msgs.add(key)
            unique_unmatched.append(u)
        unique_unmatched = unique_unmatched[-5:]

        # 5. 顶层汇总
        max_sev_rank = max(
            (sev_rank.get(d["severity"], 0) for d in diagnoses),
            default=0,
        )
        max_severity = next(
            (k for k, v in sev_rank.items() if v == max_sev_rank),
            "none",
        )
        # 一行总结
        if diagnoses:
            top = diagnoses[0]
            summary = (
                f"诊断出 {len(diagnoses)} 类问题，最严重："
                f"{top['category_label']}（{top['count']} 次，{top['severity']}）"
            )
        else:
            summary = "未识别出典型问题模式（可能需要人工查看 unmatched 样例）"

        return {
            "total_issues": len(diagnoses),
            "total_affected": len(matched_entry_ids),
            "total_candidates": len(candidates),
            "max_severity": max_severity,
            "diagnoses": diagnoses,
            "unmatched_samples": unique_unmatched,
            "summary": summary,
        }

    @staticmethod
    def _extract_evidence(text: str, hit: str, width: int = 120) -> str:
        """提取命中关键字周围的上下文片段。"""
        try:
            idx = text.lower().find(hit.lower())
            if idx < 0:
                return hit[:width]
            start = max(0, idx - width // 3)
            end = min(len(text), idx + len(hit) + width * 2 // 3)
            snippet = text[start:end].replace("\n", " ").strip()
            return snippet[:width]
        except Exception:
            return hit[:width]


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
