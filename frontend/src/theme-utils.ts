/**
 * 主题工具函数
 *
 * 在 JS/TSX 中读取当前主题的 CSS 变量值，
 * 主要用于 recharts 等需要内联颜色的场景。
 */

/** 从 <html> 读取 CSS 变量值，失败时返回 fallback */
export function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** recharts 图表通用颜色集合（按当前主题动态读取） */
export function chartColors() {
  return {
    grid: cssVar('--border-color', '#2a2f4e'),
    tickSecondary: cssVar('--text-secondary', '#a0a8c0'),
    tickMuted: cssVar('--text-muted', '#6b7390'),
    cardBg: cssVar('--bg-card', '#16213e'),
    textPrimary: cssVar('--text-primary', '#e0e0e0'),
    borderColor: cssVar('--border-color', '#2a2f4e'),
    primary: cssVar('--color-primary', '#4CAF50'),
  };
}

/** 根据分数返回主色 CSS 变量值 */
export function scoreColorVar(score: number): string {
  if (score >= 80) return cssVar('--color-primary', '#4CAF50');
  if (score >= 60) return cssVar('--color-warning', '#FF9800');
  return cssVar('--color-error', '#f44336');
}
