/**
 * AstrBot Plugin Page 桥接 API 封装
 *
 * 通过 window.AstrBotPluginPage 与后端通信：
 *  - ready()              等待页面环境就绪
 *  - apiGet(endpoint)     GET 请求
 *  - apiPost(endpoint)    POST 请求
 *  - subscribeSSE(...)    订阅服务器推送事件
 */
import { useCallback, useEffect, useState } from 'react';

/** SSE 事件回调集合 */
export interface SSEHandlers {
  /** 收到一条消息时触发，参数为已解析的数据 */
  onMessage?: (data: any) => void;
  /** 连接发生错误时触发 */
  onError?: (err: any) => void;
  /** 连接成功建立时触发 */
  onOpen?: () => void;
}

/** AstrBot 插件页面桥接对象 */
export interface AstrBotPluginPageBridge {
  /** 等待页面 / 后端环境就绪 */
  ready: () => Promise<void>;
  /** 发起 GET 请求，返回后端响应数据 */
  apiGet: (endpoint: string, params?: Record<string, any>) => Promise<any>;
  /** 发起 POST 请求，返回后端响应数据 */
  apiPost: (endpoint: string, body?: any) => Promise<any>;
  /** 订阅 SSE 事件流，返回取消订阅函数 */
  subscribeSSE: (
    endpoint: string,
    handlers: SSEHandlers,
    params?: Record<string, any>
  ) => () => void;
}

declare global {
  interface Window {
    AstrBotPluginPage: AstrBotPluginPageBridge;
  }
}

/** 判断桥接对象是否可用 */
function assertBridge(): AstrBotPluginPageBridge {
  const bridge = (typeof window !== 'undefined' && window.AstrBotPluginPage) || null;
  if (!bridge) {
    throw new Error(
      'window.AstrBotPluginPage 桥接对象不可用，请确认当前页面运行在 AstrBot 插件页面环境中。'
    );
  }
  return bridge;
}

/** 等待页面环境就绪 */
export function ready(): Promise<void> {
  const bridge = assertBridge();
  return Promise.resolve(bridge.ready());
}

/** GET 请求封装 */
export async function apiGet(
  endpoint: string,
  params?: Record<string, any>
): Promise<any> {
  const bridge = assertBridge();
  return bridge.apiGet(endpoint, params);
}

/** POST 请求封装 */
export async function apiPost(
  endpoint: string,
  body?: any
): Promise<any> {
  const bridge = assertBridge();
  return bridge.apiPost(endpoint, body);
}

/** 订阅 SSE 事件流，返回取消订阅函数 */
export function subscribeSSE(
  endpoint: string,
  handlers: SSEHandlers,
  params?: Record<string, any>
): () => void {
  const bridge = assertBridge();
  return bridge.subscribeSSE(endpoint, handlers, params);
}

// ---------------------------------------------------------------------------
// React Hooks
// ---------------------------------------------------------------------------

/** useApi 返回的数据状态 */
export interface ApiState<T> {
  /** 响应数据 */
  data: T | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 重新拉取数据 */
  refresh: () => void;
}

/**
 * 数据拉取 Hook
 *
 * @param endpoint 接口路径，传 null 表示不拉取
 * @param params   查询参数
 */
export function useApi<T = any>(
  endpoint: string | null,
  params?: Record<string, any>
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!endpoint);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // 将 params 序列化以便作为依赖项
  const paramsKey = params ? JSON.stringify(params) : '';

  useEffect(() => {
    if (!endpoint) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiGet(endpoint, params)
      .then((res) => {
        if (!cancelled) {
          setData(res as T);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message || String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, paramsKey, tick]);

  return { data, loading, error, refresh };
}

/**
 * fetchData —— 与 useApi 等价的具名导出，供需要在组件外使用的场景调用。
 * 在组件内推荐直接使用 useApi Hook。
 */
export const fetchData = useApi;
