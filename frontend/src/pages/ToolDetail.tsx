import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useApi } from '../api/bridge';
import { chartColors } from '../theme-utils';
import { fmt, pct } from '../utils';
import { StateBox } from '../components/StateBox';

interface ToolRank {
  name?: string;
  calls?: number;
  avg_dur?: number;
  avg_duration?: number;
  p50_dur?: number;
  p95_dur?: number;
  p50?: number;
  p95?: number;
  failure_rate?: number;
}

interface Trajectory {
  ts?: number | string;
  umo?: string;
  steps?: number;
  tool_seq?: string[];
  messages?: number;
}

interface ToolData {
  total_calls?: number;
  total?: number;
  failure_rate?: number;
  ranking?: ToolRank[];
  by_tool?: ToolRank[];
  agent_trajectories?: Trajectory[];
}

export default function ToolDetail() {
  const { data, loading, error } = useApi<ToolData>('/tool');
  const tc = chartColors();

  const ranking = data?.ranking ?? data?.by_tool ?? [];
  const trajectories = data?.agent_trajectories ?? [];
  const totalCalls = data?.total_calls ?? data?.total ?? 0;
  const failureRate = data?.failure_rate ?? 0;

  const chartData = ranking
    .slice()
    .sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0))
    .slice(0, 12)
    .map((t) => ({
      name: (t.name ?? '?').length > 10 ? (t.name ?? '').slice(0, 10) + '…' : t.name,
      calls: t.calls ?? 0,
    }));

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">🔧 工具调用分析</h1>
      <p className="page-subtitle">工具使用频率、耗时分布与 Agent 轨迹</p>

      <StateBox loading={loading} error={error} />

      {data && !loading && (
        <>
          {/* 概要 */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-block">
              <div className="stat-block__label">总调用次数</div>
              <div className="stat-block__value">{fmt(totalCalls)}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">工具种类</div>
              <div className="stat-block__value">{ranking.length}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">整体失败率</div>
              <div className={'stat-block__value ' + (failureRate > 5 ? 'text-error' : failureRate > 0 ? 'text-warning' : 'text-primary')}>
                {pct(failureRate)}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">轨迹数</div>
              <div className="stat-block__value">{trajectories.length}</div>
            </div>
          </div>

          {/* 调用频率柱状图 */}
          <h2 className="section-title">工具调用频率（Top 12）</h2>
          <div className="card">
            <div className="chart-box">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tc.grid} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: tc.tickSecondary, fontSize: 11 }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fill: tc.tickMuted, fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: 'var(--accent-bg)' }}
                      contentStyle={{
                        background: tc.cardBg,
                        border: `1px solid ${tc.borderColor}`,
                        borderRadius: '8px',
                        color: tc.textPrimary,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="calls" name="调用次数" radius={[4, 4, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={tc.primary} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="timeline-empty">暂无调用数据</div>
              )}
            </div>
          </div>

          {/* 工具排名表 */}
          <h2 className="section-title">工具排名</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>工具名称</th>
                  <th className="numeric">调用数</th>
                  <th className="numeric">平均耗时 (ms)</th>
                  <th className="numeric">P50 (ms)</th>
                  <th className="numeric">P95 (ms)</th>
                  <th className="numeric">失败率</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((t, i) => {
                  const fr = t.failure_rate ?? 0;
                  return (
                    <tr key={i}>
                      <td>{t.name ?? '-'}</td>
                      <td className="numeric">{fmt(t.calls)}</td>
                      <td className="numeric">{fmt(t.avg_dur ?? t.avg_duration)}</td>
                      <td className="numeric">{fmt(t.p50_dur ?? t.p50)}</td>
                      <td className="numeric cell-warn">{fmt(t.p95_dur ?? t.p95)}</td>
                      <td className={'numeric ' + (fr > 5 ? 'cell-error' : fr > 0 ? 'cell-warn' : 'cell-good')}>
                        {pct(fr)}
                      </td>
                    </tr>
                  );
                })}
                {ranking.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无工具数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Agent 调用轨迹 */}
          <h2 className="section-title">Agent 调用轨迹</h2>
          {trajectories.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {trajectories.map((tr, i) => {
                const seq = tr.tool_seq ?? [];
                return (
                  <div key={i} className="card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                      <strong>#{i + 1}</strong>
                      <span className="text-muted">
                        {typeof tr.ts === 'number' ? new Date(tr.ts * 1000).toLocaleString('zh-CN', { hour12: false }) : (tr.ts ?? '-')}
                      </span>
                      {tr.umo && <span className="tag">{tr.umo}</span>}
                      <span className="tag">步骤 {tr.steps ?? seq.length}</span>
                      {tr.messages !== undefined && (
                        <span className="tag">消息 {tr.messages}</span>
                      )}
                    </div>
                    {seq.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {seq.map((s, j) => (
                          <span key={j} className="tag">{j + 1}. {s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card">
              <div className="timeline-empty">暂无 Agent 轨迹记录</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
