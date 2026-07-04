import { Link } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApi } from '../api/bridge';
import { chartColors } from '../theme-utils';

interface ModelRow {
  key?: string;
  model?: string;
  calls?: number;
  input_other?: number;
  input_cached?: number;
  output?: number;
  total?: number;
  failure_rate?: number;
}

interface TotalData {
  calls?: number;
  input_other?: number;
  input_cached?: number;
  output?: number;
  total?: number;
}
interface TokenData {
  total?: TotalData;
  cache_hit_ratio?: number;
  by_model?: ModelRow[];
  source?: string;
}

const PIE_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
  '#f44336', '#00BCD4', '#FFEB3B', '#E91E63',
];

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('zh-CN');
};

const pct = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toFixed(1) + '%';
};

export default function TokenDetail() {
  const { data, loading, error } = useApi<TokenData>('/token');
  const tc = chartColors();

  const byModel = data?.by_model ?? [];
  const pieData = byModel.map((m) => ({
    name: m.key ?? m.model ?? '未知',
    value: m.total ?? (m.input_other ?? 0) + (m.input_cached ?? 0) + (m.output ?? 0),
  }));
  const cacheRatio = data?.cache_hit_ratio ?? 0;
  const totalInfo = data?.total;

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">🪙 Token 用量分析</h1>
      <p className="page-subtitle">模型调用量、Token 消耗与缓存命中</p>

      {loading && (
        <div className="state-box">
          <div className="state-box__spinner" />
          <div>加载中...</div>
        </div>
      )}
      {error && !loading && (
        <div className="state-box state-box--error">
          <div className="state-box__spinner" />
          <div>加载失败：{error}</div>
        </div>
      )}

      {data && !loading && (
        <>
          {/* 概要 */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-block">
              <div className="stat-block__label">总调用次数</div>
              <div className="stat-block__value">{fmt(totalInfo?.calls)}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">总 Token 数</div>
              <div className="stat-block__value">{fmt(totalInfo?.total)}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">缓存命中</div>
              <div className="stat-block__value text-primary">{fmt(totalInfo?.input_cached)}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">缓存命中率</div>
              <div className="stat-block__value text-primary">{pct(cacheRatio)}</div>
            </div>
          </div>

          <div className="two-col">
            {/* 模型分布饼图 */}
            <div className="card">
              <div className="card__title">Token 分布（按模型）</div>
              <div className="chart-box">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, percent }) =>
                          `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                        style={{ fontSize: 11 }}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: tc.cardBg,
                          border: `1px solid ${tc.borderColor}`,
                          borderRadius: '8px',
                          color: tc.textPrimary,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: tc.tickSecondary }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="timeline-empty">暂无模型数据</div>
                )}
              </div>
            </div>

            {/* 缓存分析 */}
            <div className="card">
              <div className="card__title">缓存命中分析</div>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                整体缓存命中率：
                <span className="text-primary" style={{ fontSize: 24, fontWeight: 700, marginLeft: 8 }}>
                  {pct(cacheRatio)}
                </span>
              </div>
              <p className="form-row__desc" style={{ lineHeight: 1.7 }}>
                缓存命中可显著降低 Token 消耗与响应延迟。
                命中率越高代表 Prompt 前缀越稳定，系统提示词缓存复用效果越好。
              </p>
              <div className="stat-grid" style={{ marginTop: 16 }}>
                <div className="stat-block">
                  <div className="stat-block__label">输入（未缓存）</div>
                  <div className="stat-block__value">{fmt(totalInfo?.input_other)}</div>
                </div>
                <div className="stat-block">
                  <div className="stat-block__label">输入（已缓存）</div>
                  <div className="stat-block__value cell-good">{fmt(totalInfo?.input_cached)}</div>
                </div>
                <div className="stat-block">
                  <div className="stat-block__label">输出</div>
                  <div className="stat-block__value">{fmt(totalInfo?.output)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* 按模型明细表 */}
          <h2 className="section-title">按模型明细</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th className="numeric">调用数</th>
                  <th className="numeric">输入(其他)</th>
                  <th className="numeric">输入(缓存)</th>
                  <th className="numeric">输出</th>
                  <th className="numeric">合计</th>
                  <th className="numeric">失败率</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((m, i) => {
                  const fr = m.failure_rate ?? 0;
                  return (
                    <tr key={i}>
                      <td>{m.key ?? m.model ?? '-'}</td>
                      <td className="numeric">{fmt(m.calls)}</td>
                      <td className="numeric">{fmt(m.input_other)}</td>
                      <td className="numeric cell-good">{fmt(m.input_cached)}</td>
                      <td className="numeric">{fmt(m.output)}</td>
                      <td className="numeric">{fmt(m.total)}</td>
                      <td className={'numeric ' + (fr > 5 ? 'cell-error' : fr > 0 ? 'cell-warn' : 'cell-good')}>
                        {pct(fr)}
                      </td>
                    </tr>
                  );
                })}
                {byModel.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无模型数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
