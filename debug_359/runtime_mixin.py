"""
359度 Debug · L2 运行时间分析 Mixin

采集 Hook: on_waiting_llm_request / on_llm_request / on_llm_response / after_message_sent
查询方法: get_runtime_report() / get_runtime_health()
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from astrbot.api import logger
from astrbot.api.event import filter, AstrMessageEvent

from .utils import avg, fmt_duration, percentile, safe_call, now_ts, health_score_from_metric


class RuntimeMixin:
    """运行时间分析。依赖 StoreMixin 的缓冲。"""

    @filter.on_waiting_llm_request()
    async def _rt_on_wait(self, event: AstrMessageEvent) -> None:
        """LLM 链路起点（等锁前）。"""
        self._hb("_rt_on_wait")
        if not self.is_enabled("runtime_analysis"):
            return
        eid = id(event)
        self.record_runtime(eid, "enter", time.time(), event.unified_msg_origin)
        # F4: 记录平台维度
        try:
            self._timings[eid]["platform"] = event.get_platform_name()
        except Exception:
            pass

    @filter.on_llm_request()
    async def _rt_on_req(self, event: AstrMessageEvent, req) -> None:
        """LLM 请求发出。"""
        self._hb("_rt_on_req")
        if not self.is_enabled("runtime_analysis"):
            return
        eid = id(event)
        t = self._timings.get(eid, {})
        self.record_runtime(eid, "llm_req", time.time(), t.get("umo", ""))

    @filter.on_llm_response()
    async def _rt_on_resp(self, event: AstrMessageEvent, resp) -> None:
        """LLM 响应到达。"""
        self._hb("_rt_on_resp")
        if not self.is_enabled("runtime_analysis"):
            return
        eid = id(event)
        t = self._timings.get(eid, {})
        ts = time.time()
        self.record_runtime(eid, "llm_resp", ts, t.get("umo", ""))
        # 计算 LLM 阶段耗时
        llm_req = t.get("llm_req")
        if llm_req:
            self._runtime_buf.append({
                "ts": ts, "umo": t.get("umo", ""), "stage": "llm",
                "dur": ts - llm_req, "platform": t.get("platform", ""),
            })

    @filter.after_message_sent()
    async def _rt_on_sent(self, event: AstrMessageEvent) -> None:
        """消息发送完成 → 算总耗时并清理。"""
        self._hb("_rt_on_sent")
        if not self.is_enabled("runtime_analysis"):
            return
        eid = id(event)
        t = self._timings.get(eid, {})
        ts = time.time()
        enter = t.get("enter")
        if enter:
            total_dur = ts - enter
            self._runtime_buf.append({
                "ts": ts, "umo": t.get("umo", ""), "stage": "total", "dur": total_dur,
                "platform": t.get("platform", ""),
            })
            # F6 慢响应告警
            threshold = self.cfg("slow_response_threshold", 10.0)
            if total_dur > threshold:
                self.emit_alert(
                    "WARN", "runtime",
                    f"慢响应: {fmt_duration(total_dur)} (阈值 {fmt_duration(threshold)})",
                    "runtime",
                )
        self.cleanup_event(eid)

    # ==================== 查询/聚合 ====================

    def get_runtime_report(self, umo: str | None = None, by_platform: bool = False) -> dict:
        """运行时间报告（供指令 + Pages API 共用）。

        Args:
            umo: 按会话过滤
            by_platform: F4 是否按平台维度聚合
        """
        records = self.get_runtime_buf()
        if umo:
            records = [r for r in records if r.get("umo") == umo]
        by_stage: dict[str, list[float]] = defaultdict(list)
        for r in records:
            by_stage[r["stage"]].append(r["dur"])
        result = {}
        for stage, durs in by_stage.items():
            result[stage] = {
                "n": len(durs),
                "avg": round(avg(durs), 3),
                "p50": round(percentile(durs, 50), 3),
                "p95": round(percentile(durs, 95), 3),
            }
        out = {"stages": result, "total_records": len(records)}
        # F4: 平台维度聚合
        if by_platform:
            plat_groups: dict[str, list[float]] = defaultdict(list)
            for r in records:
                if r["stage"] == "total":
                    plat_groups[r.get("platform", "") or "unknown"].append(r["dur"])
            out["by_platform"] = {
                p: {
                    "n": len(v),
                    "avg": round(avg(v), 3),
                    "p95": round(percentile(v, 95), 3),
                }
                for p, v in plat_groups.items()
            }
        return out

    async def get_runtime_detail(self, umo: str | None = None, since: float | None = None) -> dict:
        """运行时间详情（含 ProviderStat 交叉校验 + F4 平台维度）。"""
        report = self.get_runtime_report(umo, by_platform=True)
        # 从 ProviderStat 拿 TTFT 和精确计时
        stats = await self.query_provider_stats(umo=umo, since=since, limit=500)
        ttft_vals = [s.time_to_first_token for s in stats if s.time_to_first_token > 0]
        by_provider: dict[str, list[float]] = defaultdict(list)
        by_umo: dict[str, list[float]] = defaultdict(list)
        for s in stats:
            dur = (s.end_time - s.start_time) if s.end_time and s.start_time else 0
            if dur > 0:
                by_provider[s.provider_id].append(dur)
                by_umo[s.umo].append(dur)
        report["ttft"] = {
            "avg": round(avg(ttft_vals), 3) if ttft_vals else 0,
            "p50": round(percentile(ttft_vals, 50), 3) if ttft_vals else 0,
            "p95": round(percentile(ttft_vals, 95), 3) if ttft_vals else 0,
        }
        report["by_provider"] = {
            p: {"n": len(v), "avg": round(avg(v), 3), "p95": round(percentile(v, 95), 3)}
            for p, v in by_provider.items()
        }
        report["by_umo"] = {
            u: {"n": len(v), "avg": round(avg(v), 3)}
            for u, v in list(by_umo.items())[:20]  # 限制返回数量
        }
        return report

    def get_runtime_health(self) -> int:
        """运行时健康度评分（0-100）。"""
        records = self.get_runtime_buf()
        total_durs = [r["dur"] for r in records if r["stage"] == "total"]
        if not total_durs:
            return 100  # 无数据视为健康
        p95 = percentile(total_durs, 95)
        return health_score_from_metric(p95, [(3, 100), (5, 80), (10, 60), (30, 40), (9999, 20)])

    def fmt_runtime_oneline(self, report: dict | None = None) -> str:
        """格式化一行摘要（指令用）。"""
        report = report or self.get_runtime_report()
        stages = report.get("stages", {})
        total = stages.get("total", {})
        llm = stages.get("llm", {})
        n = total.get("n", 0)
        if n == 0:
            return "运行 ▸ 暂无数据 | 完整报告见 Pages"
        p95 = total.get("p95", 0)
        alert = 1 if p95 > self.cfg("slow_response_threshold", 10.0) else 0
        items = [f"n={n}", f"p95={fmt_duration(p95)}"]
        if llm:
            items.append(f"LLM={fmt_duration(llm.get('p95', 0))}")
        return f"运行 ▸ {' '.join(items)}{' ⚠慢' if alert else ''} | 完整报告见 Pages"
