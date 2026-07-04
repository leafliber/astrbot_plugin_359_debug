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

interface OutputChain {
  available?: boolean;
  seg_count?: number;
  seg_types?: string[];
}

interface LastSnapshot {
  available?: boolean;
  model?: string;
  system_prompt?: string;
  system_prompt_len?: number;
  system_prompt_tokens?: number;
  system_prompt_changed?: boolean;
  contexts_count?: number;
  tools?: string[];
  extra_parts_count?: number;
  extra_texts?: string[];
  temp_parts_count?: number;
  output_chain?: OutputChain;
  ts?: number | string;
}

interface PromptDiff {
  ts?: number | string;
  changed?: boolean | string;
  len?: number;
  tokens?: number;
  diff?: string;
}

interface CacheAlert {
  ts?: number | string;
  level?: string;
  source?: string;
  msg?: string;
  module?: string;
}

interface ContextData {
  last_snapshot?: LastSnapshot;
  token_breakdown?: {
    system_prompt?: number;
    contexts?: number;
    tools?: number;
    extra_parts?: number;
    total?: number;
    pct?: Record<string, number>;
  };
  prompt_diff?: PromptDiff[];
  cache_alerts?: CacheAlert[];
  system_prompt?: string;
}

const PIE_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0'];

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('zh-CN');
};

const formatTs = (ts: number | string | undefined): string => {
  if (!ts) return '-';
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? String(ts) : d.toLocaleString('zh-CN', { hour12: false });
  }
  return ts;
};

export default function ContextDetail() {
  const { data, loading, error } = useApi<ContextData>('/context');

  const snap = data?.last_snapshot;
  const breakdown = data?.token_breakdown ?? {};
  const pieData = [
    { name: '系统提示词', value: breakdown.system_prompt ?? 0 },
    { name: '上下文', value: breakdown.contexts ?? 0 },
    { name: '工具', value: breakdown.tools ?? 0 },
    { name: '附加部分', value: breakdown.extra_parts ?? 0 },
  ].filter((d) => d.value > 0);

  const history = data?.prompt_diff ?? [];
  const alerts = data?.cache_alerts ?? [];
  const systemPrompt = snap?.system_prompt ?? data?.system_prompt ?? '';
  const outputChain = snap?.output_chain;

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">📝 上下文注入分析</h1>
      <p className="page-subtitle">Prompt 构成、变更历史与缓存稳定性</p>

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
          {/* 最近快照概要 */}
          <h2 className="section-title">最近快照</h2>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-block">
              <div className="stat-block__label">模型</div>
              <div className="stat-block__value" style={{ fontSize: 16 }}>
                {snap?.model ?? '-'}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">系统提示词长度</div>
              <div className="stat-block__value">{fmt(snap?.system_prompt_len)}</div>
              <div className="stat-block__sub">字符</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">上下文条数</div>
              <div className="stat-block__value">{fmt(snap?.contexts_count)}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">工具数</div>
              <div className="stat-block__value">{fmt(snap?.tools?.length ?? 0)}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">附加部分</div>
              <div className="stat-block__value">{fmt(snap?.extra_parts_count)}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">总 Token</div>
              <div className="stat-block__value text-primary">{fmt(data?.token_breakdown?.total)}</div>
            </div>
          </div>

          <div className="two-col">
            {/* Token 构成饼图 */}
            <div className="card">
              <div className="card__title">Token 构成</div>
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
                          background: '#16213e',
                          border: '1px solid #2a2f4e',
                          borderRadius: '8px',
                          color: '#e0e0e0',
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: '#a0a8c0' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="timeline-empty">暂无构成数据</div>
                )}
              </div>
            </div>

            {/* 缓存中断告警 */}
            <div className="card">
              <div className="card__title">缓存中断告警</div>
              {alerts.length > 0 ? (
                <div className="timeline">
                  {alerts.map((d, i) => {
                    const level = d.level ?? 'WARN';
                    return (
                      <div key={i} className={`timeline-item level-${level}`}>
                        <div className="timeline-item__dot" />
                        <div className="timeline-item__meta">
                          <span className="timeline-item__source">
                            {d.source ?? '-'}
                            {d.module ? ` · ${d.module}` : ''}
                          </span>
                          <span>{formatTs(d.ts)}</span>
                        </div>
                        <div className="timeline-item__msg">
                          {d.msg ?? '缓存被破坏'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="timeline-empty">
                  未检测到缓存中断，状态良好
                </div>
              )}
            </div>
          </div>

          {/* F3: 输出链装饰信息 */}
          {outputChain && (
            <>
              <h2 className="section-title">输出链装饰 (F3)</h2>
              <div className="stat-grid" style={{ marginBottom: 20 }}>
                <div className="stat-block">
                  <div className="stat-block__label">是否可用</div>
                  <div
                    className="stat-block__value"
                    style={{ fontSize: 16, color: outputChain.available ? '#4CAF50' : '#9C27B0' }}
                  >
                    {outputChain.available ? '是' : '否'}
                  </div>
                </div>
                <div className="stat-block">
                  <div className="stat-block__label">段数</div>
                  <div className="stat-block__value">{fmt(outputChain.seg_count ?? 0)}</div>
                </div>
                <div className="stat-block">
                  <div className="stat-block__label">段类型</div>
                  <div className="stat-block__value" style={{ fontSize: 14 }}>
                    {outputChain.seg_types?.length
                      ? outputChain.seg_types.join(', ')
                      : '-'}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Prompt 变更历史 */}
          <h2 className="section-title">Prompt 变更历史</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>是否变更</th>
                  <th className="numeric">长度</th>
                  <th className="numeric">Token</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const rawChanged = h.changed;
                  const changedStr = String(rawChanged ?? '-');
                  const isChanged =
                    rawChanged === true ||
                    changedStr === 'true' ||
                    changedStr === '1';
                  const display =
                    isChanged
                      ? '是'
                      : rawChanged === false ||
                        changedStr === 'false' ||
                        changedStr === '0'
                      ? '否'
                      : changedStr;
                  return (
                    <tr key={i}>
                      <td>{formatTs(h.ts)}</td>
                      <td className={isChanged ? 'cell-warn' : 'cell-good'}>
                        {display}
                      </td>
                      <td className="numeric">{fmt(h.len)}</td>
                      <td className="numeric">{fmt(h.tokens)}</td>
                    </tr>
                  );
                })}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: '#6b7390' }}>
                      暂无变更历史
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 系统提示词全文预览 */}
          <h2 className="section-title">系统提示词预览</h2>
          <pre className={'pre-block' + (systemPrompt ? '' : ' empty')}>
            {systemPrompt || '（暂无系统提示词内容）'}
          </pre>
        </>
      )}
    </div>
  );
}
