"""
359度 Debug · L2 Token 使用分析 Mixin

采集 Hook: on_llm_response（读 usage，作 fallback/实时校验）
数据源: ProviderStat 表聚合（优先）+ 内存缓冲（fallback）
查询方法: get_token_report() / get_cache_hit_ratio() / get_token_health()
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from astrbot.api import logger
from astrbot.api.event import filter, AstrMessageEvent

from .utils import fmt_tokens, health_score_from_metric


class TokenMixin:
    """Token 使用分析。依赖 StoreMixin 的 DB 查询与缓冲。"""

    @filter.on_llm_response()
    async def _tk_on_resp(self, event: AstrMessageEvent, resp) -> None:
        """LLM 响应 → 读 usage 自采（作 ProviderStat 的 fallback/实时校验）。"""
        self._hb("_tk_on_resp", event=event, event_type="OnLLMResponseEvent")
        if not self.is_enabled("token_analysis"):
            return
        if getattr(resp, "is_chunk", False):
            return  # 流式分片不计
        usage = getattr(resp, "usage", None)
        if not usage:
            return
        try:
            umo = event.unified_msg_origin
            prov = self._tk_provider_name(event)
            model = getattr(resp, "model", "") or "?"
            usage_dict = {
                "prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0,
                "completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
                "total_tokens": getattr(usage, "total_tokens", 0) or 0,
                "cached_tokens": getattr(usage, "prompt_tokens_details", None) and
                                 getattr(usage.prompt_tokens_details, "cached_tokens", 0) or 0,
            }
            self.record_token(prov, model, usage_dict, umo)
            # F6 token 告警
            threshold = self.cfg("token_alert_threshold", 10000)
            if usage_dict["total_tokens"] > threshold:
                self.emit_alert(
                    "WARN", "token",
                    f"单次 token 超阈值: {fmt_tokens(usage_dict['total_tokens'])} "
                    f"(阈值 {fmt_tokens(threshold)})",
                    "token",
                )
        except Exception as e:
            logger.debug(f"[359debug] token 采集异常: {e}")

    def _tk_provider_name(self, event: AstrMessageEvent) -> str:
        """获取当前 provider 名称。"""
        try:
            p = self.context.get_using_provider(event.unified_msg_origin)
            return getattr(p, "id", None) or type(p).__name__
        except Exception:
            return "?"

    # ==================== 查询/聚合 ====================

    async def get_token_report(self, provider: str | None = None,
                               since: float | None = None,
                               group_by: str = "model") -> dict:
        """Token 报告。优先聚合 ProviderStat 表，回退到内存缓冲。"""
        # 尝试从 ProviderStat 聚合
        stats = await self.query_provider_stats(since=since, limit=2000)
        if provider:
            stats = [s for s in stats if s.provider_id == provider]
        if stats:
            return self._tk_aggregate_from_db(stats, group_by)
        # 回退到内存缓冲
        return self._tk_aggregate_from_buf(provider, group_by)

    def _tk_aggregate_from_db(self, stats: list, group_by: str) -> dict:
        """从 ProviderStat 表聚合。"""
        groups: dict[str, dict] = defaultdict(lambda: {
            "calls": 0, "input_other": 0, "input_cached": 0,
            "output": 0, "total": 0, "failed": 0,
        })
        for s in stats:
            if group_by == "model":
                key = f"{s.provider_id} / {s.provider_model or '?'}"
            elif group_by == "umo":
                key = s.umo
            else:
                key = s.provider_id
            g = groups[key]
            g["calls"] += 1
            g["input_other"] += s.token_input_other
            g["input_cached"] += s.token_input_cached
            g["output"] += s.token_output
            g["total"] += s.token_input_other + s.token_input_cached + s.token_output
            if s.status == "failed":
                g["failed"] += 1
        by_model = []
        grand = {"calls": 0, "input_other": 0, "input_cached": 0, "output": 0, "total": 0}
        for key, g in sorted(groups.items()):
            g["key"] = key
            g["failure_rate"] = round(g["failed"] / g["calls"] * 100, 1) if g["calls"] else 0
            by_model.append(g)
            for k in grand:
                grand[k] += g.get(k, 0)
        grand_input = grand["input_other"] + grand["input_cached"]
        cache_ratio = round(grand["input_cached"] / grand_input * 100, 1) if grand_input else 0
        return {
            "by_model": by_model,
            "total": grand,
            "cache_hit_ratio": cache_ratio,
            "source": "provider_stat",
        }

    def _tk_aggregate_from_buf(self, provider: str | None, group_by: str) -> dict:
        """从内存缓冲聚合（fallback）。"""
        records = self.get_token_buf()
        if provider:
            records = [r for r in records if r.get("provider") == provider]
        groups: dict[str, dict] = defaultdict(lambda: {
            "calls": 0, "input_other": 0, "input_cached": 0,
            "output": 0, "total": 0,
        })
        for r in records:
            key = f"{r['provider']} / {r['model']}" if group_by == "model" else r.get("provider", "?")
            g = groups[key]
            g["calls"] += 1
            g["input_other"] += r.get("prompt", 0)
            g["input_cached"] += r.get("cached", 0)
            g["output"] += r.get("completion", 0)
            g["total"] += r.get("total", 0)
        by_model = [{"key": k, **v} for k, v in sorted(groups.items())]
        grand_total = sum(g["total"] for g in by_model)
        grand_cached = sum(g["input_cached"] for g in by_model)
        grand_input = sum(g["input_other"] + g["input_cached"] for g in by_model)
        return {
            "by_model": by_model,
            "total": {"calls": len(records), "total": grand_total, "input_cached": grand_cached},
            "cache_hit_ratio": round(grand_cached / grand_input * 100, 1) if grand_input else 0,
            "source": "buffer",
        }

    def get_cache_hit_ratio(self) -> float:
        """缓存命中率（基于内存缓冲快速估算）。"""
        records = self.get_token_buf()
        total_input = sum(r.get("prompt", 0) for r in records)
        cached = sum(r.get("cached", 0) for r in records)
        return round(cached / total_input * 100, 1) if total_input else 0

    def get_token_health(self) -> int:
        """Token 健康度评分（基于缓存命中率）。"""
        ratio = self.get_cache_hit_ratio()
        # 命中率越高越好：>80=100, >60=80, >40=60, ≤40=40
        if ratio == 0:
            return 100  # 无数据视为健康
        return health_score_from_metric(100 - ratio, [(20, 100), (40, 80), (60, 60), (100, 40)])

    def fmt_token_oneline(self, report: dict | None = None) -> str:
        """格式化一行摘要。"""
        if report is None:
            # 同步方法，用缓冲快速输出
            records = self.get_token_buf()
            if not records:
                return "Token ▸ 暂无数据 | 完整报告见 Pages"
            calls = len(records)
            total = sum(r.get("total", 0) for r in records)
            ratio = self.get_cache_hit_ratio()
            return f"Token ▸ 调用{calls} {fmt_tokens(total)} 缓存命中{ratio}% | 完整报告见 Pages"
        total = report.get("total", {})
        ratio = report.get("cache_hit_ratio", 0)
        return (f"Token ▸ 调用{total.get('calls', 0)} "
                f"{fmt_tokens(total.get('total', 0))} 缓存命中{ratio}% | 完整报告见 Pages")
