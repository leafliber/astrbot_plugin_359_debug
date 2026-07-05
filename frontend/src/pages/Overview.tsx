import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi, subscribeSSE, apiGet, apiPost } from '../api/bridge';
import HealthScore from '../components/HealthScore';
import RadarChart, { RadarData } from '../components/RadarChart';
import CheckupCard, { CheckupStatus } from '../components/CheckupCard';
import Timeline, { TimelineItem } from '../components/Timeline';
import AiCheckupCard, { CheckupResult } from '../components/AiCheckupCard';
import CheckupProgress, { CheckupPhase } from '../components/CheckupProgress';

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
  lock: '🔒',
};

const COLLECT_INTERVAL = 320; // 每个模块采集间隔(ms)
const MODULE_TOTAL = 7;
const MIN_ANALYZE_TIME = 650; // 分析阶段最短展示(ms)

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  // ===== AI 智能体检状态 =====
  const [providerName, setProviderName] = useState<string>('');
  const [providerAvailable, setProviderAvailable] = useState<boolean>(true);
  const [checkupPhase, setCheckupPhase] = useState<CheckupPhase | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [checkupResult, setCheckupResult] = useState<CheckupResult | null>(null);
  const runIdRef = useRef(0); // 防止并发/过期请求覆盖

  // 查询默认 Provider（按钮下方小字）
  useEffect(() => {
    apiGet('/ai_provider')
      .then((res: any) => {
        setProviderName(res?.provider_name || '');
        setProviderAvailable(res?.available !== false);
      })
      .catch(() => {
        setProviderName('');
        setProviderAvailable(false);
      });
  }, []);

  // 执行 AI 体检（编排：采集动画 → 分析阶段 → 结果）
  const runCheckup = useCallback(async () => {
    if (checkupPhase !== null) return; // 防止重复点击
    const myRunId = ++runIdRef.current;
    setCheckupResult(null);
    setDoneCount(0);
    setCheckupPhase('collecting');

    // 采集进度动画（依次点亮 6 个模块）
    const collectAnim = (async () => {
      for (let i = 1; i <= MODULE_TOTAL; i++) {
        await delay(COLLECT_INTERVAL);
        if (runIdRef.current !== myRunId) return; // 已被新一轮取消
        setDoneCount(i);
      }
    })();

    try {
      // 并行发起真实请求
      const requestPromise = apiPost('/ai_checkup', {});

      // 等采集动画播完
      await collectAnim;
      if (runIdRef.current !== myRunId) return;

      // 进入 AI 诊断阶段
      setCheckupPhase('analyzing');

      // 等待 LLM 结果
      const res = (await requestPromise) as CheckupResult;

      // 分析阶段至少展示 MIN_ANALYZE_TIME，让动画完整
      await delay(MIN_ANALYZE_TIME);
      if (runIdRef.current !== myRunId) return;

      setCheckupResult(res);
    } catch (err: any) {
      if (runIdRef.current !== myRunId) return;
      setCheckupResult({
        timestamp: Math.floor(Date.now() / 1000),
        provider_id: null,
        provider_name: providerName,
        modules: {},
        conclusion: null,
        raw_text: null,
        error: err?.message || String(err),
      });
    } finally {
      if (runIdRef.current === myRunId) {
        setCheckupPhase(null);
        setDoneCount(0);
      }
    }
  }, [checkupPhase, providerName]);

  // 初始化告警列表
  useEffect(() => {
    if (data?.alerts) {
      setAlerts(data.alerts);
    }
  }, [data]);

  // 订阅实时告警
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
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
            /* 静默 */
          },
        },
        { topic: 'alert' }
      );
      if (typeof fn === 'function') unsubscribe = fn;
    } catch {
      /* 忽略 */
    }
    return () => {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          /* 卸载期间静默 */
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

  const defaultModules: ModuleInfo[] = [
    { key: 'runtime', title: '运行时分析', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/runtime' },
    { key: 'token', title: 'Token 用量', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/token' },
    { key: 'context', title: '上下文注入', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/context' },
    { key: 'tool', title: '工具调用', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/tool' },
    { key: 'log', title: '错误日志', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/log' },
    { key: 'plugin', title: '插件安全', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/plugin' },
    { key: 'lock', title: '会话锁', score: 0, summary: '暂无数据', status: 'ok', detailRoute: '/lock' },
  ];

  const renderModules: ModuleInfo[] =
    modules.length > 0
      ? modules.map((m) => ({ ...m, icon: m.icon ?? MODULE_ICONS[m.key] ?? '' }))
      : defaultModules.map((m) => ({ ...m, icon: MODULE_ICONS[m.key] }));

  const isChecking = checkupPhase !== null;

  return (
    <div>
      {/* ===================== HERO 主视觉区 ===================== */}
      <section className="hero anim-fade-up">
        {/* 健康分大圆环 */}
        <div className="hero__score anim-scale">
          <HealthScore score={score} level={level} />
        </div>

        {/* 体检按钮 / 进度 / 结论 */}
        <div className="hero__action">
          {!isChecking && !checkupResult && (
            <>
              <button
                className="btn btn-primary hero__cta"
                onClick={runCheckup}
                disabled={!providerAvailable}
              >
                <span className="hero__cta-icon">🩺</span>
                一键 AI 智能体检
              </button>
              <div className="hero__provider-hint">
                {providerAvailable ? (
                  <>使用 AstrBot 默认 Provider：{providerName || '加载中…'}</>
                ) : (
                  <>未检测到可用 LLM Provider，请在 AstrBot 配置中添加聊天模型</>
                )}
              </div>
            </>
          )}

          {/* 体检进度动画 */}
          {isChecking && checkupPhase && (
            <CheckupProgress phase={checkupPhase} doneCount={doneCount} />
          )}

          {/* 体检结论 */}
          {!isChecking && checkupResult && (
            <AiCheckupCard
              result={checkupResult}
              onClose={() => setCheckupResult(null)}
            />
          )}
        </div>
      </section>

      {/* 重新体检入口（结论展示后） */}
      {!isChecking && checkupResult && (
        <div className="hero__recheck anim-fade">
          <button
            className="btn btn-secondary hero__cta hero__cta--small"
            onClick={runCheckup}
            disabled={!providerAvailable}
          >
            🔄 重新体检
          </button>
        </div>
      )}

      {error && (
        <div className="alert-banner warning anim-fade">
          部分数据加载失败（{error}），展示的可能不是最新结果。
        </div>
      )}

      {/* ===================== 六维雷达 ===================== */}
      <h2 className="section-title anim-fade-up">健康雷达</h2>
      <div className="card anim-fade-up delay-1">
        <RadarChart data={radar} />
      </div>

      {/* ===================== 模块卡片 ===================== */}
      <h2 className="section-title">模块体检</h2>
      <div className="checkup-grid">
        {renderModules.map((m, i) => (
          <div key={m.key} className={'anim-fade-up delay-' + Math.min(i + 1, 8)}>
            <CheckupCard
              title={m.title}
              score={m.score}
              summary={m.summary}
              status={m.status}
              detailRoute={m.detailRoute}
              icon={m.icon}
            />
          </div>
        ))}
      </div>

      {/* ===================== 告警时间线 ===================== */}
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
      <div className="card anim-fade-up">
        <Timeline items={alerts} />
      </div>
    </div>
  );
}
