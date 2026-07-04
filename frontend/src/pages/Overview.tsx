import { useEffect, useState } from 'react';
import { useApi, subscribeSSE } from '../api/bridge';
import HealthScore from '../components/HealthScore';
import RadarChart, { RadarData } from '../components/RadarChart';
import CheckupCard, { CheckupStatus } from '../components/CheckupCard';
import Timeline, { TimelineItem } from '../components/Timeline';

interface ModuleInfo {
  key: string;
  title: string;
  score: number;
  summary: string;
  status: CheckupStatus;
  detailRoute: string;
  icon?: string;
}

interface OverviewData {
  score: number;
  level: string;
  radar: Partial<RadarData>;
  modules: ModuleInfo[];
  alerts: TimelineItem[];
}

const MODULE_ICONS: Record<string, string> = {
  runtime: '⏱',
  token: '🪙',
  context: '📝',
  tool: '🔧',
  log: '📋',
  plugin: '🧩',
};

function Loading() {
  return (
    <div className="state-box">
      <div className="state-box__spinner" />
      <div>正在生成体检报告...</div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="state-box state-box--error">
      <div className="state-box__spinner" />
      <div>加载失败：{message}</div>
    </div>
  );
}

export default function Overview() {
  const { data, loading, error, refresh } = useApi<OverviewData>('/overview');
  const [alerts, setAlerts] = useState<TimelineItem[]>([]);

  // 初始化告警列表
  useEffect(() => {
    if (data?.alerts) {
      setAlerts(data.alerts);
    }
  }, [data]);

  // 订阅实时告警
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    try {
      const fn = subscribeSSE(
        '/live',
        {
          onMessage: (msg: any) => {
            const item: TimelineItem = {
              ts: msg.ts ?? msg.time ?? Date.now(),
              level: msg.level ?? 'INFO',
              source: msg.source ?? 'system',
              msg: msg.msg ?? msg.message ?? '',
              module: msg.module,
            };
            setAlerts((prev) => [item, ...prev].slice(0, 100));
          },
          onError: () => {
            /* 静默处理，避免控制台噪音 */
          },
        },
        { topic: 'alert' }
      );
      if (typeof fn === 'function') {
        unsubscribe = fn;
      }
    } catch {
      /* subscribeSSE 可能因 bridge 未就绪而抛出，忽略 */
    }
    return () => {
      cancelled = true;
      // 防御性调用：确保 unsubscribe 是函数才执行
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          /* 卸载期间 bridge 可能已失效，静默吞掉 */
        }
      }
    };
  }, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} />;

  const overview = data as OverviewData | null;
  const score = overview?.score ?? 0;
  const level = overview?.level ?? '未知';
  const radar = overview?.radar ?? {};
  const modules = overview?.modules ?? [];

  // 补全默认模块（后端未返回时给出占位）
  const defaultModules: ModuleInfo[] = [
    { key: 'runtime', title: '运行时分析', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/runtime' },
    { key: 'token', title: 'Token 用量', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/token' },
    { key: 'context', title: '上下文注入', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/context' },
    { key: 'tool', title: '工具调用', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/tool' },
    { key: 'log', title: '错误日志', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/log' },
    { key: 'plugin', title: '插件安全', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/plugin' },
  ];

  const renderModules: ModuleInfo[] =
    modules.length > 0
      ? modules.map((m) => ({
          ...m,
          icon: m.icon ?? MODULE_ICONS[m.key] ?? '',
        }))
      : defaultModules.map((m) => ({ ...m, icon: MODULE_ICONS[m.key] }));

  return (
    <div>
      <h1 className="page-title">359° 体检总览</h1>
      <p className="page-subtitle">
        全方位监测 AstrBot 运行健康度 · 实时告警推送中
      </p>

      {error && (
        <div className="alert-banner warning">
          部分数据加载失败（{error}），展示的可能不是最新结果。
        </div>
      )}

      {/* 顶部：健康分 + 雷达图 */}
      <div className="overview-top">
        <div className="card">
          <HealthScore score={score} level={level} />
        </div>
        <div className="card">
          <div className="card__title">六维健康雷达</div>
          <RadarChart data={radar} />
        </div>
      </div>

      {/* 中部：模块卡片网格 */}
      <h2 className="section-title">模块体检</h2>
      <div className="checkup-grid">
        {renderModules.map((m) => (
          <CheckupCard
            key={m.key}
            title={m.title}
            score={m.score}
            summary={m.summary}
            status={m.status}
            detailRoute={m.detailRoute}
            icon={m.icon}
          />
        ))}
      </div>

      {/* 底部：告警时间线 */}
      <h2 className="section-title">
        最近告警
        <button
          className="btn btn-secondary"
          style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12 }}
          onClick={refresh}
        >
          刷新
        </button>
      </h2>
      <div className="card">
        <Timeline items={alerts} />
      </div>
    </div>
  );
}
