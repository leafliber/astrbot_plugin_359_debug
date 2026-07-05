"""
359度 Debug · L2 工具调用分析 Mixin

采集 Hook: on_using_llm_tool / on_llm_tool_respond / on_agent_begin / on_agent_done
查询方法: get_tool_report() / get_agent_trajectory() / get_tool_health()
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from astrbot.api import logger
from astrbot.api.event import filter, AstrMessageEvent

from .utils import fmt_duration, health_score_from_metric, percentile, avg


class ToolMixin:
    """工具调用分析。依赖 StoreMixin 的缓冲。"""

    @filter.on_using_llm_tool()
    async def _tl_on_tool_start(self, event: AstrMessageEvent, tool, tool_args) -> None:
        """工具调用开始 → 记录起点。"""
        self._hb("_tl_on_tool_start")
        if not self.is_enabled("tool_analysis"):
            return
        try:
            eid = id(event)
            name = getattr(tool, "name", str(tool))
            self._tool_timings.setdefault(eid, {})[name] = time.time()
        except Exception as e:
            logger.debug(f"[359debug] 工具开始记录异常: {e}")

    @filter.on_llm_tool_respond()
    async def _tl_on_tool_end(self, event: AstrMessageEvent, tool, tool_args, tool_result) -> None:
        """工具调用结束 → 记录 名/参/返回/耗时/成功失败。"""
        self._hb("_tl_on_tool_end")
        if not self.is_enabled("tool_analysis"):
            return
        try:
            eid = id(event)
            name = getattr(tool, "name", str(tool))
            start = self._tool_timings.get(eid, {}).pop(name, time.time())
            dur = time.time() - start
            # 判断成功/失败
            ok = True
            result_text = ""
            try:
                content = getattr(tool_result, "content", None)
                if content:
                    first = content[0]
                    result_text = getattr(first, "text", str(first))[:500]
                    # is_error 标记
                    if getattr(first, "is_error", False) or getattr(tool_result, "is_error", False):
                        ok = False
                else:
                    result_text = str(tool_result)[:500]
            except Exception:
                result_text = str(tool_result)[:500]
            umo = event.unified_msg_origin
            self.record_tool(name, tool_args, dur, ok, umo)
            # 记录到 Agent 轨迹序列
            agent = self._agent_temp.get(eid)
            if agent:
                agent["tool_seq"].append({"name": name, "dur": round(dur, 3), "ok": ok})
                agent["steps"] += 1
        except Exception as e:
            logger.debug(f"[359debug] 工具结束记录异常: {e}")

    @filter.on_agent_begin()
    async def _tl_on_agent_begin(self, event: AstrMessageEvent, run_context) -> None:
        """Agent 开始 → 初始化轨迹追踪。"""
        self._hb("_tl_on_agent_begin")
        if not self.is_enabled("tool_analysis"):
            return
        try:
            eid = id(event)
            self._agent_temp[eid] = {
                "begin": time.time(),
                "umo": event.unified_msg_origin,
                "steps": 0,
                "tool_seq": [],
                "messages": len(getattr(run_context, "messages", []) or []),
            }
        except Exception as e:
            logger.debug(f"[359debug] Agent begin 记录异常: {e}")

    @filter.on_agent_done()
    async def _tl_on_agent_done(self, event: AstrMessageEvent, run_context, resp) -> None:
        """Agent 完成 → 记录轨迹。"""
        self._hb("_tl_on_agent_done")
        if not self.is_enabled("tool_analysis"):
            return
        try:
            eid = id(event)
            agent = self._agent_temp.pop(eid, None)
            if not agent:
                return
            agent["end"] = time.time()
            agent["total_dur"] = agent["end"] - agent["begin"]
            agent["messages"] = len(getattr(run_context, "messages", []) or [])
            agent["failed"] = resp is None
            self.record_agent_trajectory(
                agent["umo"], agent["steps"], agent["tool_seq"], agent["messages"]
            )
        except Exception as e:
            logger.debug(f"[359debug] Agent done 记录异常: {e}")

    # ==================== 查询/聚合 ====================

    def get_tool_report(self, name: str | None = None, since: float | None = None) -> dict:
        """工具调用报告。"""
        records = self.get_tool_buf()
        if name:
            records = [r for r in records if r.get("name") == name]
        if since:
            records = [r for r in records if r.get("ts", 0) >= since]
        if not records:
            return {"ranking": [], "total_calls": 0, "failure_rate": 0}
        # 按工具名聚合
        by_name: dict[str, dict] = defaultdict(lambda: {
            "calls": 0, "durs": [], "ok": 0, "fail": 0,
        })
        for r in records:
            n = r["name"]
            by_name[n]["calls"] += 1
            by_name[n]["durs"].append(r["dur"])
            if r["ok"]:
                by_name[n]["ok"] += 1
            else:
                by_name[n]["fail"] += 1
        ranking = []
        total_fail = 0
        for n, g in sorted(by_name.items(), key=lambda x: -x[1]["calls"]):
            durs = g["durs"]
            ranking.append({
                "name": n,
                "calls": g["calls"],
                "avg_dur": round(avg(durs), 3),
                "p50_dur": round(percentile(durs, 50), 3),
                "p95_dur": round(percentile(durs, 95), 3),
                "failure_rate": round(g["fail"] / g["calls"] * 100, 1),
            })
            total_fail += g["fail"]
        total = len(records)
        return {
            "ranking": ranking,
            "total_calls": total,
            "failure_rate": round(total_fail / total * 100, 1) if total else 0,
            "duration_dist": [r["dur"] for r in records],
            "recent": records[-10:],
        }

    def get_agent_trajectory(self) -> list:
        """获取 Agent 多步轨迹列表。"""
        return self.get_agent_trajectories()

    def get_tool_health(self) -> int:
        """工具健康度评分（基于失败率）。"""
        records = self.get_tool_buf()
        if not records:
            return 100
        failed = sum(1 for r in records if not r.get("ok", True))
        rate = failed / len(records) * 100
        return health_score_from_metric(rate, [(5, 100), (10, 80), (20, 60), (999, 40)])

    def fmt_tool_oneline(self, report: dict | None = None) -> str:
        """格式化一行摘要。"""
        report = report or self.get_tool_report()
        calls = report.get("total_calls", 0)
        if calls == 0:
            return "工具 ▸ 暂无数据 | 完整报告见 Pages"
        fail_rate = report.get("failure_rate", 0)
        ranking = report.get("ranking", [])
        top = ", ".join(r["name"] for r in ranking[:3]) or "-"
        avg_dur = avg([r.get("avg_dur", 0) for r in ranking])
        alert = " ⚠" if fail_rate > 10 else ""
        return (f"工具 ▸ 调用{calls}次 均耗{fmt_duration(avg_dur)} "
                f"失败率{fail_rate}% Top:{top}{alert} | 完整报告见 Pages")
