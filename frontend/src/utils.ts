/**
 * 公共工具函数：时间戳 / 数值 / 百分比格式化与图表配色。
 * 提取自各页面中重复的本地实现，统一约定以避免行为漂移。
 */

/** 时间戳格式化（兼容秒级 / 毫秒级，阈值 1e12 = 2001 年） */
export function formatTs(ts: number | string | undefined): string {
  if (!ts) return '-';
  if (typeof ts === 'number') {
    const ms = ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? String(ts) : d.toLocaleString('zh-CN', { hour12: false });
  }
  return ts;
}

/**
 * 数值格式化。
 * - 空值返回 '-'
 * - 非数字返回原始字符串
 * - 传入 digits 时按定长小数输出（toFixed）
 * - 否则按 zh-CN 千分位输出（toLocaleString）
 */
export function fmt(v: unknown, digits?: number): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  if (typeof digits === 'number') return n.toFixed(digits);
  return n.toLocaleString('zh-CN');
}

/**
 * 百分比格式化。
 * 约定：入参为 0-100 的数值（如 failure_rate=12.3 表示 12.3%），
 * 直接 toFixed(1) 后拼接 '%'，与原 ToolDetail / TokenDetail 行为一致。
 */
export function pct(n: number): string {
  return n.toFixed(1) + '%';
}

/** 饼图配色（按顺序循环取用） */
export const PIE_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
  '#F44336', '#00BCD4', '#795548', '#607D8B',
];
