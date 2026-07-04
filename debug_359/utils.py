"""
359度 Debug · L0 纯函数工具层

无 self、无状态、无 IO —— 最高复用，任何 Mixin 可直接调用。
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any, Iterable

from astrbot.api import logger


def now_ts() -> float:
    """当前 Unix 时间戳（秒）。"""
    return time.time()


def safe_call(coro_or_fn: Any, *args, **kwargs) -> Any:
    """安全执行：包装协程/函数，永不抛出异常（保护主流程）。

    - 传入协程：await 后捕获异常
    - 传入普通函数：直接调用捕获异常
    """
    try:
        if asyncio.iscoroutine(coro_or_fn):
            return _SafeAwaitable(coro_or_fn)
        if callable(coro_or_fn):
            return coro_or_fn(*args, **kwargs)
        return coro_or_fn
    except Exception as e:
        logger.debug(f"[359debug] safe_call 拦截异常: {e}")
        return None


class _SafeAwaitable:
    """包装协程使其 await 时捕获异常。"""

    def __init__(self, coro):
        self._coro = coro

    def __await__(self):
        return self._await().__await__()

    async def _await(self):
        try:
            return await self._coro
        except Exception as e:
            logger.debug(f"[359debug] safe_call await 拦截异常: {e}")
            return None


def percentile(values: Iterable[float], p: float) -> float:
    """计算百分位数（p 取 0-100）。

    >>> percentile(list(range(1, 101)), 95)
    95.0
    """
    vals = sorted(v for v in values if v is not None and v >= 0)
    if not vals:
        return 0.0
    n = len(vals)
    if n == 1:
        return vals[0]
    k = (n - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, n - 1)
    frac = k - lo
    return vals[lo] * (1 - frac) + vals[hi] * frac


def avg(values: Iterable[float]) -> float:
    """平均值，空集返回 0。"""
    vals = [v for v in values if v is not None]
    if not vals:
        return 0.0
    return sum(vals) / len(vals)


def fmt_duration(seconds: float) -> str:
    """格式化耗时：1.23s / 2m30s / 1h05m。"""
    if seconds is None or seconds < 0:
        return "-"
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    if seconds < 60:
        return f"{seconds:.2f}s"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{int(m)}m{int(s):02d}s"
    h, m = divmod(int(m), 60)
    return f"{h}h{m:02d}m"


def fmt_tokens(n: int) -> str:
    """格式化 token 数：1.2k / 12.5k / 1.2M。"""
    if n is None:
        return "-"
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return f"{n / 1000:.1f}k"
    return f"{n / 1_000_000:.1f}M"


def truncate(text: str, n: int = 200) -> str:
    """截断文本，超长追加省略号。"""
    if not text:
        return ""
    return text[:n] + "…" if len(text) > n else text


def fingerprint(text: str) -> str:
    """生成错误指纹（用于 traceback 去重聚类）。

    去除行号、内存地址、时间戳等变化部分，取稳定哈希。
    """
    if not text:
        return "empty"
    # 去除行号: file.py:123 → file.py:?
    cleaned = re.sub(r":\d+", ":?", text)
    # 去除内存地址 0x7f...
    cleaned = re.sub(r"0x[0-9a-fA-F]+", "0x?", cleaned)
    # 去除时间戳
    cleaned = re.sub(r"\d{4}-\d{2}-\d{2}[\dT:.]?\d{2}:\d{2}:\d{2}", "<ts>", cleaned)
    return hashlib.md5(cleaned.encode("utf-8")).hexdigest()[:12]


def health_score_from_metric(value: float, thresholds: list[tuple[float, int]]) -> int:
    """按阈值表打健康度评分（0-100）。

    thresholds 为 [(上限, 分数), ...]，按顺序匹配第一个 value <= 上限 的分数。

    >>> health_score_from_metric(2.0, [(3, 100), (5, 80), (10, 60)])
    100
    >>> health_score_from_metric(7.0, [(3, 100), (5, 80), (10, 60)])
    60
    """
    for upper, score in thresholds:
        if value <= upper:
            return score
    return thresholds[-1][1] if thresholds else 0


def clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """限制值范围。"""
    return max(lo, min(hi, v))


def safe_get(obj: Any, *attrs, default: Any = None) -> Any:
    """安全链式取属性：safe_get(obj, 'a', 'b', 'c', default=0)。"""
    for attr in attrs:
        try:
            obj = getattr(obj, attr)
        except Exception:
            return default
        if obj is None:
            return default
    return obj if obj is not None else default


def estimate_tokens(text: str) -> int:
    """粗略估算 token 数（中文≈1.5字/token，英文≈4字符/token，取折中）。"""
    if not text:
        return 0
    cn = len(re.findall(r"[\u4e00-\u9fff]", text))
    other = len(text) - cn
    return int(cn * 1.5 + other / 4)


def format_oneline(prefix: str, items: list[str], alert: int = 0,
                   hint: str = "完整报告见 Pages") -> str:
    """格式化一行摘要输出（指令用）。

    >>> format_oneline("运行", ["n=42", "avg=2.3s", "p95=5.1s"], alert=2)
    '运行 ▸ n=42 avg=2.3s p95=5.1s ⚠2慢 | 完整报告见 Pages'
    """
    parts = [f"{prefix} ▸"] + items
    if alert > 0:
        parts.append(f"⚠{alert}慢")
    line = " ".join(parts)
    if hint:
        line += f" | {hint}"
    return line
