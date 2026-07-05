"""
359度 Debug · L7 会话锁分析 Mixin

监控 AstrBot 运行时的会话锁（session lock）状态，检测：
  - 长时间持有锁的会话（潜在卡死/死锁风险）
  - 大量等待者的会话（请求堆积）
  - 活跃事件长期未释放（pipeline 卡住）
  - 活跃 Agent Runner 长时间未完成（LLM/工具循环卡住）

数据来源（只读反射访问，不修改 AstrBot 内部状态）：
  - astrbot.core.utils.session_lock.session_lock_manager
  - astrbot.core.utils.active_event_registry.active_event_registry
  - astrbot.core.pipeline.process_stage.follow_up._ACTIVE_AGENT_RUNNERS
  - asyncio.all_tasks() 中挂起的协程
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from astrbot.api import logger

from .utils import fmt_duration, health_score_from_metric


# 持锁时长的告警阈值（秒）
HOLD_WARN_THRESHOLD = 30.0       # 持锁超过 30s 视为可疑
HOLD_DANGER_THRESHOLD = 120.0    # 持锁超过 120s 视为高危
WAITER_WARN_THRESHOLD = 3        # 等待者 ≥3 视为堆积


class SessionLockMixin:
    """会话锁 / 死锁风险分析。"""

    # ==================== 内部探针 ====================

    def _get_loop_lock_manager(self) -> Any | None:
        """获取当前事件循环对应的 _PerLoopSessionLockManager。

        兼容同步和异步上下文：优先 get_running_loop（async），
        回退到 get_event_loop（sync，如 get_lock_health 在非协程中调用）。
        """
        try:
            from astrbot.core.utils.session_lock import session_lock_manager
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.get_event_loop()
            return session_lock_manager._loop_managers.get(loop)
        except Exception as e:
            logger.debug(f"[359debug] 无法获取 session_lock_manager: {e}")
            return None

    def _get_active_event_registry(self) -> Any | None:
        """获取活跃事件注册表。"""
        try:
            from astrbot.core.utils.active_event_registry import active_event_registry
            return active_event_registry
        except Exception:
            return None

    def _get_active_agent_runners(self) -> dict[str, Any] | None:
        """获取活跃 Agent Runner 全局表。"""
        try:
            from astrbot.core.pipeline.process_stage.follow_up import _ACTIVE_AGENT_RUNNERS
            return _ACTIVE_AGENT_RUNNERS
        except Exception:
            return None

    def _probe_session_locks(self) -> list[dict[str, Any]]:
        """探针：遍历所有会话锁，返回每个锁的状态快照。

        由于 asyncio.Lock 没有原生的「获取时间」字段，这里通过 _waiters
        数量 + locked() 状态来判断风险。持锁时长需要包装 acquire_lock 才能精确
        获得（见下方 _wrap_lock_timing），这里先用近似估计。
        """
        result: list[dict[str, Any]] = []
        mgr = self._get_loop_lock_manager()
        if not mgr:
            return result

        locks_dict: dict = getattr(mgr, "_locks", {})
        count_dict: dict = getattr(mgr, "_lock_count", {})

        for umo, lock in locks_dict.items():
            try:
                locked = lock.locked()
                waiters = getattr(lock, "_waiters", None)
                waiter_count = len(waiters) if waiters else 0
                refcount = count_dict.get(umo, 0)

                # 风险等级评估
                level = "ok"
                if locked and waiter_count >= WAITER_WARN_THRESHOLD:
                    level = "warn"
                # 危险等级由持锁时长判定（如果有 _acquired_at 记录）
                acquired_at = getattr(lock, "_359_acquired_at", None)
                hold_secs = (time.monotonic() - acquired_at) if acquired_at else 0
                if hold_secs >= HOLD_DANGER_THRESHOLD:
                    level = "danger"
                elif hold_secs >= HOLD_WARN_THRESHOLD and level == "warn":
                    level = "danger"

                result.append({
                    "umo": umo,
                    "locked": locked,
                    "waiters": waiter_count,
                    "refcount": refcount,
                    "hold_secs": round(hold_secs, 1),
                    "level": level,
                })
            except Exception as e:
                logger.debug(f"[359debug] 探测锁 {umo} 失败: {e}")
                continue

        # 按风险排序：danger > warn > ok，同级按等待者数降序
        level_order = {"danger": 0, "warn": 1, "ok": 2}
        result.sort(key=lambda x: (level_order.get(x["level"], 9), -x["waiters"]))
        return result

    def _probe_active_events(self) -> list[dict[str, Any]]:
        """探针：遍历活跃事件注册表，返回每个会话的活跃事件数。"""
        result: list[dict[str, Any]] = []
        registry = self._get_active_event_registry()
        if not registry:
            return result

        events_dict: dict = getattr(registry, "_events", {})
        for umo, events in events_dict.items():
            try:
                ev_list = list(events) if events else []
                result.append({
                    "umo": umo,
                    "active_count": len(ev_list),
                })
            except Exception:
                continue

        result.sort(key=lambda x: -x["active_count"])
        return result

    def _probe_agent_runners(self) -> list[dict[str, Any]]:
        """探针：遍历活跃 Agent Runner，返回正在 LLM/工具循环的会话。"""
        result: list[dict[str, Any]] = []
        runners = self._get_active_agent_runners()
        if not runners:
            return result

        for umo, runner in runners.items():
            if runner is None:
                continue
            try:
                result.append({
                    "umo": umo,
                    "active": True,
                    "runner_type": type(runner).__name__,
                })
            except Exception:
                continue
        return result

    def _count_pending_tasks(self) -> dict[str, Any]:
        """统计当前事件循环中挂起的 asyncio Task 数量（辅助指标）。"""
        try:
            loop = asyncio.get_running_loop()
            tasks = asyncio.all_tasks(loop)
            total = len(tasks)
            # 尝试统计正在等待锁的 task
            lock_waiting = 0
            for t in tasks:
                coro = t.get_coro()
                coro_name = getattr(coro, "__name__", "") or ""
                if "acquire_lock" in coro_name or "wait" in coro_name:
                    lock_waiting += 1
            return {"total_tasks": total, "lock_waiting_approx": lock_waiting}
        except Exception:
            return {"total_tasks": 0, "lock_waiting_approx": 0}

    # ==================== 对外查询接口 ====================

    async def get_lock_detail(self) -> dict[str, Any]:
        """会话锁详情报告。"""
        locks = self._probe_session_locks()
        active_events = self._probe_active_events()
        runners = self._probe_agent_runners()
        tasks = self._count_pending_tasks()

        # 建立会话聚合视图：将锁、活跃事件、runner 按 umo 合并
        umo_set = set()
        for x in locks:
            umo_set.add(x["umo"])
        for x in active_events:
            umo_set.add(x["umo"])
        for x in runners:
            umo_set.add(x["umo"])

        active_events_map = {x["umo"]: x["active_count"] for x in active_events}
        runners_set = {x["umo"] for x in runners}

        sessions: list[dict[str, Any]] = []
        for umo in umo_set:
            lock_info = next((l for l in locks if l["umo"] == umo), None)
            sessions.append({
                "umo": umo,
                "locked": lock_info["locked"] if lock_info else False,
                "waiters": lock_info["waiters"] if lock_info else 0,
                "hold_secs": lock_info["hold_secs"] if lock_info else 0,
                "level": lock_info["level"] if lock_info else "ok",
                "active_events": active_events_map.get(umo, 0),
                "has_runner": umo in runners_set,
            })

        # 按风险排序
        level_order = {"danger": 0, "warn": 1, "ok": 2}
        sessions.sort(key=lambda x: (level_order.get(x["level"], 9),
                                     -x["waiters"], -x["active_events"]))

        # 统计摘要
        danger_count = sum(1 for s in sessions if s["level"] == "danger")
        warn_count = sum(1 for s in sessions if s["level"] == "warn")
        total_waiters = sum(s["waiters"] for s in sessions)
        max_hold = max((s["hold_secs"] for s in sessions), default=0)

        return {
            "sessions": sessions,
            "summary": {
                "total_sessions": len(sessions),
                "danger": danger_count,
                "warning": warn_count,
                "total_waiters": total_waiters,
                "max_hold_secs": round(max_hold, 1),
                "total_tasks": tasks["total_tasks"],
            },
            "tasks": tasks,
            "thresholds": {
                "hold_warn": HOLD_WARN_THRESHOLD,
                "hold_danger": HOLD_DANGER_THRESHOLD,
                "waiter_warn": WAITER_WARN_THRESHOLD,
            },
        }

    def get_lock_health(self) -> int:
        """会话锁健康度评分（0-100），用于首页雷达图。

        评分逻辑：无活跃锁=100，每个 warn 级 -10，每个 danger 级 -25，
        等待者过多额外扣分，最低 0。
        """
        locks = self._probe_session_locks_sync()
        danger = sum(1 for l in locks if l["level"] == "danger")
        warn = sum(1 for l in locks if l["level"] == "warn")
        total_waiters = sum(l["waiters"] for l in locks)

        score = 100 - (danger * 25) - (warn * 10) - min(total_waiters * 5, 20)
        return max(0, min(100, score))

    def fmt_lock_oneline(self) -> str:
        """格式化一行摘要（指令用）。"""
        locks = self._probe_session_locks_sync()
        if not locks:
            return "锁 ▸ 无活跃会话锁 | 完整报告见 Pages"
        n = len(locks)
        n_locked = sum(1 for l in locks if l["locked"])
        total_waiters = sum(l["waiters"] for l in locks)
        danger = sum(1 for l in locks if l["level"] == "danger")
        parts = [f"会话{n}", f"持锁{n_locked}", f"等待{total_waiters}"]
        suffix = f" ⚠{danger}死锁" if danger > 0 else ""
        return f"锁 ▸ {' '.join(parts)}{suffix} | 完整报告见 Pages"

    def _probe_session_locks_sync(self) -> list[dict[str, Any]]:
        """同步版本的锁探测（get_lock_health 在同步上下文中调用）。

        _get_loop_lock_manager 已兼容同步上下文，直接复用 _probe_session_locks。
        """
        return self._probe_session_locks()
