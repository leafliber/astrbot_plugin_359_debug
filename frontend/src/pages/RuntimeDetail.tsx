import { Link } from 'react-router-dom';
import { useApi } from '../api/bridge';

/** 后端返回结构：stages / by_provider / by_platform 均为 dict */
interface StageStat {
  n?: number;
  avg?: number;
  p50?: number;
  p95?: number;
}
interface RuntimeData {
  stages?: Record<string, StageStat>;
  total_records?: number;
  ttft?: StageStat;
  by_provider?: Record<string, StageStat>;
  by_platform?: Record<string, StageStat>;
  by_umo?: Record<string, StageStat>;
}

const fmt = (v: unknown, digits = 3): string => {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toFixed(digits);
};

const STAGE_LABELS: Record<string, string> = {
  enter: '进入链路 (enter)',
  llm_req: 'LLM 请求发出 (llm_req)',
  llm_resp: 'LLM 响应到达 (llm_resp)',
  llm: 'LLM 净耗时 (llm)',
  total: '端到端总耗时 (total)',
};

/** dict → 排序后的 [key, val] 数组 */
function dictEntries<T>(obj?: Record<string, T>): [string, T][] {
  if (!obj) return [];
  return Object.entries(obj).sort((a, b) => (b[1] as any)?.n - (a[1] as any)?.n);
}

export default function RuntimeDetail() {
  const { data, loading, error } = useApi<RuntimeData>('/runtime');

  const stages = dictEntries(data?.stages);
  const providers = dictEntries(data?.by_provider);
  const platforms = dictEntries(data?.by_platform);

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">⏱ 运行时分析</h1>
      <p className="page-subtitle">请求各阶段耗时分布 · 多提供商/平台对比</p>

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
          {/* 概要统计 */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-block">
              <div className="stat-block__label">采样记录数</div>
              <div className="stat-block__value">{data.total_records ?? '-'}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">TTFT 平均</div>
              <div className="stat-block__value">{fmt(data?.ttft?.avg)}</div>
              <div className="stat-block__sub">秒</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">TTFT P95</div>
              <div className="stat-block__value text-warning">{fmt(data?.ttft?.p95)}</div>
              <div className="stat-block__sub">秒</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">提供商数</div>
              <div className="stat-block__value">{providers.length}</div>
            </div>
          </div>

          {/* 阶段指标表 */}
          <h2 className="section-title">阶段耗时指标 (秒)</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>阶段</th>
                  <th className="numeric">次数 N</th>
                  <th className="numeric">平均</th>
                  <th className="numeric">P50</th>
                  <th className="numeric">P95</th>
                </tr>
              </thead>
              <tbody>
                {stages.map(([name, s]) => (
                  <tr key={name}>
                    <td>{STAGE_LABELS[name] ?? name}</td>
                    <td className="numeric">{s.n ?? '-'}</td>
                    <td className="numeric">{fmt(s.avg)}</td>
                    <td className="numeric">{fmt(s.p50)}</td>
                    <td className="numeric cell-warn">{fmt(s.p95)}</td>
                  </tr>
                ))}
                {stages.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无阶段数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* TTFT 指标 */}
          <h2 className="section-title">首 Token 延迟 TTFT (秒)</h2>
          <div className="stat-grid">
            <div className="stat-block">
              <div className="stat-block__label">平均</div>
              <div className="stat-block__value">{fmt(data?.ttft?.avg)}</div>
              <div className="stat-block__sub">秒</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">P50</div>
              <div className="stat-block__value">{fmt(data?.ttft?.p50)}</div>
              <div className="stat-block__sub">秒</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">P95</div>
              <div className="stat-block__value text-warning">{fmt(data?.ttft?.p95)}</div>
              <div className="stat-block__sub">秒</div>
            </div>
          </div>

          {/* 按提供商拆分 */}
          <h2 className="section-title">按提供商拆分 (ProviderStat 交叉校验)</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>提供商</th>
                  <th className="numeric">次数 N</th>
                  <th className="numeric">平均 (秒)</th>
                  <th className="numeric">P95 (秒)</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(([name, p]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="numeric">{p.n ?? '-'}</td>
                    <td className="numeric">{fmt(p.avg)}</td>
                    <td className="numeric cell-warn">{fmt(p.p95)}</td>
                  </tr>
                ))}
                {providers.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无提供商数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* F4: 按平台拆分 */}
          <h2 className="section-title">🌐 按平台拆分 (F4)</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>平台</th>
                  <th className="numeric">次数 N</th>
                  <th className="numeric">平均 (秒)</th>
                  <th className="numeric">P95 (秒)</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map(([name, p]) => (
                  <tr key={name}>
                    <td>{name || 'unknown'}</td>
                    <td className="numeric">{p.n ?? '-'}</td>
                    <td className="numeric">{fmt(p.avg)}</td>
                    <td className="numeric cell-warn">{fmt(p.p95)}</td>
                  </tr>
                ))}
                {platforms.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无平台维度数据
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
