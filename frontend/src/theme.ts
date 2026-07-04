/**
 * 主题管理
 *
 * - 浅色 (light) 为默认主题
 * - 通过 document.documentElement.dataset.theme 切换 CSS 变量
 * - 启动时从后端 /theme 读取持久化设置
 * - 切换时 POST /theme 保存
 */
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from './api/bridge';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'debug359_theme';

/** 将主题应用到 <html data-theme="..."> */
function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/** 从 localStorage 读取缓存的主题（用于首屏防闪烁） */
function getCachedTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

/**
 * 主题 Hook
 *
 * 返回当前主题 + 切换函数。
 * 组件挂载时：先用本地缓存设置 data-theme（防闪），再从后端同步。
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getCachedTheme());

  // 首次：应用缓存主题 + 从后端同步
  useEffect(() => {
    applyTheme(theme);
    apiGet('/theme')
      .then((res) => {
        const t = res?.theme === 'dark' ? 'dark' : 'light';
        setTheme(t);
      })
      .catch(() => {
        /* 后端不可用时保持本地缓存 */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题变化时应用 + 缓存 + 持久化到后端
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      // 异步保存到后端，不阻塞 UI
      apiPost('/theme', { theme: next }).catch(() => {
        /* 静默失败，本地缓存仍生效 */
      });
      return next;
    });
  }, []);

  return { theme, toggle };
}
