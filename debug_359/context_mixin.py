"""
359度 Debug · L2 上下文注入分析 Mixin

采集 Hook: on_llm_request（head+tail 双优先级）/ on_decorating_result（F3 输出链装饰）
查询方法: get_last_context() / detect_cache_disruption() / get_context_health()
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from astrbot.api import logger
from astrbot.api.event import filter, AstrMessageEvent

from .utils import estimate_tokens, health_score_from_metric, truncate


class ContextMixin:
    """上下文注入分析。依赖 StoreMixin 的缓冲。"""

    @filter.on_llm_request(priority=100000)
    async def _ctx_on_req_head(self, event: AstrMessageEvent, req) -> None:
        """head：其他插件修改前，记录 system_prompt 原态。

        重要：head 钩子也调用 record_context()，确保即使 tail 钩子
        因 event.stop_event() 被跳过，上下文数据仍然有记录。
        """
        self._hb("_ctx_on_req_head")
        if not self.is_enabled("context_dump"):
            return
        try:
            sp = getattr(req, "system_prompt", "") or ""
            eid = id(event)
            self._ctx_head_snapshots[eid] = sp

            # head 阶段也立即记录快照（防止 tail 被 stop 跳过导致无数据）
            umo = event.unified_msg_origin
            snapshot = self._ctx_build_snapshot(umo, req, sp, head_sp=sp, tail_fired=False)
            self.record_context(umo, snapshot)
            logger.debug(
                f"[359debug] ctx head hook: sp_len={len(sp)}, umo={umo}"
            )
        except Exception as e:
            logger.warning(f"[359debug] 上下文 head hook 异常: {e}", exc_info=True)

    @filter.on_llm_request(priority=-100000)
    async def _ctx_on_req_tail(self, event: AstrMessageEvent, req) -> None:
        """tail：其他插件修改后，用最终状态更新快照。"""
        self._hb("_ctx_on_req_tail")
        if not self.is_enabled("context_dump"):
            return
        try:
            umo = event.unified_msg_origin
            eid = id(event)
            sp = getattr(req, "system_prompt", "") or ""
            head_sp = self._ctx_head_snapshots.pop(eid, "")
            # tail 钩子能跑到 → 说明整条钩子链未被 stop 掐断
            snapshot = self._ctx_build_snapshot(umo, req, sp, head_sp=head_sp, tail_fired=True)
            self.record_context(umo, snapshot)
            logger.info(
                f"[359debug] ctx tail hook: umo={umo}, sp_len={len(sp)}, "
                f"sp_changed={snapshot['system_prompt_changed']}, "
                f"ctx_count={snapshot['contexts_count']}, "
                f"tools={len(snapshot['tools'])}, extra={snapshot['extra_parts_count']}"
            )
            # F1 缓存破坏检测
            await self._ctx_check_cache_disruption(umo, sp)
        except Exception as e:
            logger.warning(f"[359debug] 上下文采集异常: {e}", exc_info=True)

    def _ctx_build_snapshot(
        self, umo: str, req, sp: str, head_sp: str = "", tail_fired: bool = False
    ) -> dict:
        """构建上下文快照（head/tail 共用）。"""
        # 工具列表
        tools = []
        ft = getattr(req, "func_tool", None)
        if ft:
            try:
                tools = list(ft.names())
            except Exception:
                try:
                    tools = [t.name for t in ft.func_list]
                except Exception:
                    pass
        # 动态注入
        extra_parts = getattr(req, "extra_user_content_parts", []) or []
        extra_texts = []
        for p in extra_parts:
            try:
                extra_texts.append(getattr(p, "text", str(p)))
            except Exception:
                pass
        # 临时内容标记审计（F8）
        temp_count = sum(1 for p in extra_parts if getattr(p, "_temp", False))
        # 估算 contexts 的 token 数
        contexts_raw = getattr(req, "contexts", []) or []
        contexts_json = ""
        try:
            import json as _json
            contexts_json = _json.dumps(contexts_raw, ensure_ascii=False)
        except Exception:
            contexts_json = str(contexts_raw)

        return {
            "ts": time.time(),
            "umo": umo,
            "model": getattr(req, "model", "") or "",
            "system_prompt": sp,
            "system_prompt_len": len(sp),
            "system_prompt_tokens": estimate_tokens(sp),
            "system_prompt_changed": sp != head_sp if head_sp else False,
            "head_sp": head_sp,
            "contexts_count": len(contexts_raw),
            "contexts_tokens": estimate_tokens(contexts_json),
            "tools": tools,
            "extra_parts_count": len(extra_parts),
            "extra_texts": extra_texts,
            "temp_parts_count": temp_count,
            "tail_fired": tail_fired,
        }

    async def _ctx_check_cache_disruption(self, umo: str, sp: str) -> None:
        """检测 system_prompt 是否连续多轮不稳定变化（F1 缓存破坏）。"""
        try:
            history = [h for h in self._context_history if h.get("umo") == umo]
            window = self.cfg("cache_disruption_rounds", 3)
            if len(history) < window:
                return
            recent = history[-(window):]
            # 检查最近 N 轮 system_prompt 是否各不相同（不稳定）
            sps = [h.get("system_prompt", "") for h in recent]
            if len(set(sps)) >= window and len(set(sps)) > 1:
                self.emit_alert(
                    "ERROR", "context",
                    f"检测到 system_prompt 连续{window}轮变化（缓存破坏风险，成本增7-20倍）",
                    "context",
                )
        except Exception:
            pass

    # ==================== 查询/聚合 ====================

    def get_last_context(self, umo: str | None = None) -> dict:
        """获取最近一次上下文快照。"""
        if umo:
            snap = self._context_last.get(umo, {})
        else:
            history = self.get_context_last()
            snap = history[-1] if history else {}
        if not snap:
            return {"available": False}
        return {
            "available": True,
            "model": snap.get("model", ""),
            "system_prompt": snap.get("system_prompt", ""),
            "system_prompt_len": snap.get("system_prompt_len", 0),
            "system_prompt_tokens": snap.get("system_prompt_tokens", 0),
            "system_prompt_changed": snap.get("system_prompt_changed", False),
            "contexts_count": snap.get("contexts_count", 0),
            "contexts_tokens": snap.get("contexts_tokens", 0),
            "tools": snap.get("tools", []),
            "extra_parts_count": snap.get("extra_parts_count", 0),
            "extra_texts": snap.get("extra_texts", []),
            "temp_parts_count": snap.get("temp_parts_count", 0),
            "tail_fired": snap.get("tail_fired", False),
            "output_chain": snap.get("output_chain", {"available": False}),
        }

    async def get_context_detail(self, umo: str | None = None, limit: int = 20) -> dict:
        """上下文详情（含多轮 diff + 缓存告警）。"""
        snap = self.get_last_context(umo)
        history = self.get_context_last()
        if umo:
            history = [h for h in history if h.get("umo") == umo]
        # 多轮 prompt diff
        prompt_diffs = []
        prev_sp = ""
        for h in history[-limit:]:
            curr = h.get("system_prompt", "")
            prompt_diffs.append({
                "ts": h.get("ts"),
                "changed": curr != prev_sp,
                "len": len(curr),
                "tokens": h.get("system_prompt_tokens", 0),
            })
            prev_sp = curr
        # token 占比
        token_breakdown = {}
        if snap.get("available"):
            sp_t = snap.get("system_prompt_tokens", 0)
            ctx_t = snap.get("contexts_tokens", 0)
            tool_t = estimate_tokens(",".join(snap.get("tools", [])))
            extra_t = sum(estimate_tokens(t) for t in snap.get("extra_texts", []))
            total = sp_t + ctx_t + tool_t + extra_t
            token_breakdown = {
                "system_prompt": sp_t,
                "contexts": ctx_t,
                "tools": tool_t,
                "extra_parts": extra_t,
                "total": total,
                "pct": {
                    "system_prompt": round(sp_t / total * 100, 1) if total else 0,
                    "contexts": round(ctx_t / total * 100, 1) if total else 0,
                    "tools": round(tool_t / total * 100, 1) if total else 0,
                    "extra_parts": round(extra_t / total * 100, 1) if total else 0,
                } if total else {},
            }
        # 缓存告警时间线
        cache_alerts = [a for a in self.recent_alerts(50) if a.get("module") == "context"]
        return {
            "last_snapshot": snap,
            "token_breakdown": token_breakdown,
            "prompt_diff": prompt_diffs,
            "cache_alerts": cache_alerts,
        }

    # ==================== F3 输出链装饰分析 ====================

    @filter.on_decorating_result()
    async def _ctx_on_decorating(self, event: AstrMessageEvent) -> None:
        """F3: 追踪 LLM 原始输出 → 最终发送之间的消息链变换。"""
        self._hb("_ctx_on_decorating")
        if not self.is_enabled("context_dump"):
            return
        try:
            result = event.get_result()
            chain = getattr(result, "chain", []) or []
            # 记录消息链段数和类型
            seg_types = []
            for seg in chain:
                seg_types.append(type(seg).__name__)
            # 存入上下文历史
            umo = event.unified_msg_origin
            if umo in self._context_last:
                self._context_last[umo]["output_chain"] = {
                    "seg_count": len(chain),
                    "seg_types": seg_types,
                    "ts": time.time(),
                }
        except Exception as e:
            logger.debug(f"[359debug] 输出链装饰记录异常: {e}")

    def get_output_chain(self, umo: str | None = None) -> dict:
        """获取最近一次输出链装饰信息。"""
        snap = self._context_last.get(umo, {}) if umo else \
               (list(self._context_last.values())[-1] if self._context_last else {})
        return snap.get("output_chain", {"available": False})

    def detect_cache_disruption(self, umo: str | None = None) -> bool:
        """是否检测到缓存破坏。"""
        alerts = self.recent_alerts(50)
        for a in alerts:
            if a.get("module") == "context" and "缓存破坏" in a.get("msg", ""):
                if umo is None or umo in a.get("source", ""):
                    return True
        return False

    def get_context_health(self) -> int:
        """上下文健康度评分。"""
        if self.detect_cache_disruption():
            return 20  # 检测到缓存破坏
        history = self.get_context_last()
        if len(history) < 3:
            return 100  # 数据不足视为健康
        # 检查最近几轮是否有变化
        recent = list(history)[-5:]
        changed = sum(1 for h in recent if h.get("system_prompt_changed"))
        if changed == 0:
            return 100
        elif changed <= 1:
            return 80
        elif changed <= 2:
            return 60
        return 40

    def fmt_context_oneline(self, snap: dict | None = None) -> str:
        """格式化一行摘要。"""
        snap = snap or self.get_last_context()
        if not snap.get("available"):
            return "上下文 ▸ 暂无数据 | 完整报告见 Pages"
        sp_t = snap.get("system_prompt_tokens", 0)
        ctx_n = snap.get("contexts_count", 0)
        tool_n = len(snap.get("tools", []))
        extra_n = snap.get("extra_parts_count", 0)
        alert = " ⚠缓存" if snap.get("system_prompt_changed") else ""
        return (f"上下文 ▸ sys={sp_t}tok 历史{ctx_n}轮 工具{tool_n}个 "
                f"动态注入{extra_n}段{alert} | 完整报告见 Pages")
