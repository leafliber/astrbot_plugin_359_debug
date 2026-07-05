import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/bridge';
import { formatTs, fmt } from '../utils';
import { StateBox } from '../components/StateBox';

interface LogEntry {
  time?: number | string;
  ts?: number | string;
  level?: string;
  module?: string;
  msg?: string;
  message?: string;
  plugin?: string;
}

interface ErrorCluster {
  fingerprint?: string;
  fp?: string;
  count?: number;
  sample?: LogEntry;
  level?: string;
}

interface Diagnosis {
  category?: string;
  category_label?: string;
  severity?: string;
  count?: number;
  levels?: string[];
  root_cause?: string;
  suggestion?: string;
  evidence?: string[];
  sources?: string[];
  first_seen?: string;
  last_seen?: string;
}

interface UnmatchedSample {
  level?: string;
  module?: string;
  msg?: string;
  time?: string;
}

interface DiagnosisReport {
  total_issues?: number;
  total_affected?: number;
  total_candidates?: number;
  max_severity?: string;
  diagnoses?: Diagnosis[];
  unmatched_samples?: UnmatchedSample[];
  summary?: string;
}

interface LogData {
  file_available?: boolean;
  total_by_level?: Record<string, number>;
  by_level?: Record<string, number>;
  entries?: LogEntry[];
  errors?: LogEntry[];
  clusters?: ErrorCluster[];
  error_clusters?: ErrorCluster[];
  file_path?: string;
  hint?: string;
  diagnosis?: DiagnosisReport;
}

const levelClass = (level: string): string => {
  const u = (level || '').toUpperCase();
  if (['ERROR', 'FATAL', 'CRITICAL'].includes(u)) return 'cell-error';
  if (['WARN', 'WARNING'].includes(u)) return 'cell-warn';
  return 'cell-good';
};

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
type Level = (typeof LEVELS)[number];

export default function LogDetail() {
  const [pageSize, setPageSize] = useState<number | 'all'>('all');
  const { data, loading, error } = useApi<LogData>('/log', { limit: pageSize });

  const [levelFilter, setLevelFilter] = useState<'WARN' | 'ERROR'>('WARN');
  const [pluginFilter, setPluginFilter] = useState('');

  const fileEnabled = data?.file_available ?? true;
  const totalByLevel = data?.total_by_level ?? data?.by_level ?? {};
  const allEntries = data?.entries ?? data?.errors ?? [];
  const clusters = data?.clusters ?? data?.error_clusters ?? [];
  const diagnosis = data?.diagnosis;
  const filteredEntries = useMemo(() => {
    return allEntries.filter((e) => {
      const lvl = (e.level || '').toUpperCase();
      if (levelFilter && !lvl.includes(levelFilter)) return false;
      const plugin = e.plugin ?? e.module ?? '';
      if (pluginFilter && !String(plugin).toLowerCase().includes(pluginFilter.toLowerCase())) return false;
      return true;
    });
  }, [allEntries, levelFilter, pluginFilter]);

  // 全部读取时，级别只能 WARN / ERROR
  const isAllRead = pageSize === 'all';

  const handlePageSizeChange = (val: string) => {
    if (val === 'all') {
      setPageSize('all');
      // 切到全部读取时，若当前级别不在允许范围内则自动调整为 WARN
      if (levelFilter !== 'WARN' && levelFilter !== 'ERROR') {
        setLevelFilter('WARN');
      }
    } else {
      setPageSize(Number(val));
    }
  };

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">📋 错误日志分析</h1>
      <p className="page-subtitle">日志级别分布、错误聚合与文件可用性检查</p>

      <StateBox loading={loading} error={error} />

      {data && !loading && (
        <>
          {/* 文件可用性警告 */}
          {!fileEnabled && (
            <div className="alert-banner warning">
              ⚠ 日志文件不可用，部分日志数据可能不完整。
              {data?.hint ? `（${data.hint}）` : '请在配置中开启日志文件记录后重试。'}
            </div>
          )}

          {/* 日志文件路径 */}
          {fileEnabled && data?.file_path && (
            <div className="alert-banner" style={{ background: 'var(--muted-bg)' }}>
              📄 日志文件：<span className="text-mono">{data.file_path}</span>
            </div>
          )}

          {/* 级别统计 */}
          <h2 className="section-title">按级别统计</h2>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            {Object.keys(totalByLevel).length > 0 ? (
              Object.entries(totalByLevel).map(([level, count]) => (
                <div className="stat-block" key={level}>
                  <div className="stat-block__label">{level}</div>
                  <div className={'stat-block__value ' + levelClass(level)}>
                    {fmt(count)}
                  </div>
                </div>
              ))
            ) : (
              <div className="stat-block">
                <div className="stat-block__label">无日志</div>
                <div className="stat-block__value text-muted">-</div>
              </div>
            )}
          </div>

          {/* 过滤控件 */}
          <div className="filter-bar">
            <label>级别：</label>
            <select
              className="text-input"
              style={{ width: 'auto' }}
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as 'WARN' | 'ERROR')}
            >
              {isAllRead ? (
                <>
                  <option value="WARN">WARN</option>
                  <option value="ERROR">ERROR</option>
                </>
              ) : (
                <>
                  <option value="">全部</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </>
              )}
            </select>
            <label>模块 / 插件：</label>
            <input
              className="text-input"
              placeholder="关键字过滤"
              value={pluginFilter}
              onChange={(e) => setPluginFilter(e.target.value)}
            />
            <label>读取条数：</label>
            <select
              className="text-input"
              style={{ width: 'auto' }}
              value={pageSize}
              onChange={(e) => handlePageSizeChange(e.target.value)}
            >
              <option value={100}>100 条</option>
              <option value={500}>500 条</option>
              <option value={1000}>1000 条</option>
              <option value={2000}>2000 条</option>
              <option value={5000}>5000 条</option>
              <option value="all">全部</option>
            </select>
            {isAllRead && (
              <span className="text-muted" style={{ fontSize: 12, color: 'var(--color-warn)' }}>
                全部读取模式下仅支持 WARN / ERROR 筛选
              </span>
            )}
            <span className="text-muted" style={{ fontSize: 12 }}>
              共 {filteredEntries.length} 条
            </span>
          </div>

          {/* WARN/ERROR 智能诊断 */}
          <h2 className="section-title">🔍 WARN/ERROR 智能诊断</h2>
          <p className="form-row__desc" style={{ marginBottom: 8 }}>
            纯规则引擎自动分类 WARN/ERROR 日志，给出根因分析与修复建议，不依赖 LLM。
          </p>

          {diagnosis && (diagnosis.total_issues ?? 0) > 0 ? (
            <>
              {/* 摘要条 */}
              <div className="alert-banner" style={{
                background: (diagnosis.max_severity === 'high')
                  ? 'var(--error-bg, rgba(220,53,69,0.1))'
                  : 'var(--warn-bg, rgba(255,193,7,0.1))',
                borderColor: diagnosis.max_severity === 'high' ? 'var(--error)' : 'var(--warn, #f0ad4e)',
              }}>
                <strong>{diagnosis.summary}</strong>
                <span style={{ marginLeft: 12, fontSize: '0.88em' }}>
                  分析范围：{diagnosis.total_candidates ?? 0} 条 WARN/ERROR，命中 {diagnosis.total_affected ?? 0} 条
                </span>
              </div>

              {/* 诊断卡片 */}
              {(diagnosis.diagnoses ?? []).map((d, i) => (
                <DiagnosisCard key={i} diag={d} />
              ))}

              {/* 未匹配样例 */}
              {(diagnosis.unmatched_samples?.length ?? 0) > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.88em' }}>
                    未识别模式的 WARN/ERROR 样例（{diagnosis.unmatched_samples?.length} 条）
                  </summary>
                  <div className="table-wrapper" style={{ marginTop: 8 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>级别</th>
                          <th>模块</th>
                          <th>消息</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(diagnosis.unmatched_samples ?? []).map((u, j) => (
                          <tr key={j}>
                            <td className={levelClass(u.level ?? 'ERROR')}>{u.level}</td>
                            <td className="text-mono">{u.module ?? '-'}</td>
                            <td style={{ whiteSpace: 'normal', maxWidth: 500 }}>{u.msg ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          ) : (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)' }}>
                {diagnosis?.summary ?? '无 WARN/ERROR 日志，状态良好 ✓'}
              </div>
            </div>
          )}

          {/* 错误聚类 */}
          <h2 className="section-title">错误聚类</h2>
          <p className="form-row__desc" style={{ marginBottom: 8 }}>
            汇总 WARN / ERROR 级别日志，以及消息内容含错误关键词的 INFO / DEBUG 日志，按指纹去重聚类。
          </p>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>指纹</th>
                  <th className="numeric">出现次数</th>
                  <th>级别</th>
                  <th>模块</th>
                  <th>示例消息</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c, i) => (
                  <tr key={i}>
                    <td className="text-mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.fingerprint ?? c.fp ?? '-'}
                    </td>
                    <td className="numeric cell-error">{fmt(c.count)}</td>
                    <td className={levelClass(c.level ?? 'ERROR')}>{c.level ?? 'ERROR'}</td>
                    <td>{c.sample?.module ?? '-'}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 400 }}>{c.sample?.msg ?? c.sample?.message ?? '-'}</td>
                  </tr>
                ))}
                {clusters.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      未发现错误聚类
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 日志条目表 */}
          <h2 className="section-title">日志条目</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>级别</th>
                  <th>模块</th>
                  <th>消息</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatTs(e.time ?? e.ts)}</td>
                    <td className={levelClass(e.level ?? '')}>{e.level ?? '-'}</td>
                    <td>{e.module ?? e.plugin ?? '-'}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 500 }}>{e.msg ?? e.message ?? '-'}</td>
                  </tr>
                ))}
                {filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无匹配的日志条目
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

// 诊断卡片：展示一个分类的根因、建议、证据
function DiagnosisCard({ diag }: { diag: Diagnosis }) {
  const sev = diag.severity ?? 'low';
  const sevColor =
    sev === 'high' ? 'var(--error)' :
    sev === 'medium' ? 'var(--warn, #f0ad4e)' :
    'var(--border)';
  const sevBg =
    sev === 'high' ? 'rgba(220,53,69,0.06)' :
    sev === 'medium' ? 'rgba(255,193,7,0.06)' :
    'var(--bg-elevated, rgba(0,0,0,0.03))';

  return (
    <div className="card" style={{
      marginBottom: 10,
      borderLeft: `4px solid ${sevColor}`,
      background: sevBg,
    }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '1.05em' }}>{diag.category_label ?? diag.category ?? '未知'}</strong>
          <span className="text-mono" style={{ fontSize: '0.78em', color: 'var(--text-muted)' }}>
            {diag.category}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`tag ${sev === 'high' ? 'inactive' : 'active'}`}
            style={sev === 'high' ? { background: 'var(--error)' } : {}}>
            {sev === 'high' ? '高危' : sev === 'medium' ? '中危' : '低危'}
          </span>
          <span className="text-muted" style={{ fontSize: '0.85em' }}>
            {diag.count} 次
          </span>
          {(diag.levels ?? []).map((l) => (
            <span key={l} className={`tag ${l.includes('ERR') ? 'inactive' : 'active'}`} style={{ fontSize: '0.72em' }}>
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* 根因 + 建议 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: '0.78em', color: 'var(--text-muted)', marginBottom: 3 }}>根因分析</div>
          <div style={{ fontSize: '0.92em' }}>{diag.root_cause ?? '-'}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.78em', color: 'var(--text-muted)', marginBottom: 3 }}>修复建议</div>
          <div style={{ fontSize: '0.92em', color: sev === 'high' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {diag.suggestion ?? '-'}
          </div>
        </div>
      </div>

      {/* 证据样例 */}
      {(diag.evidence?.length ?? 0) > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: '0.78em', color: 'var(--text-muted)', marginBottom: 3 }}>证据样例</div>
          {(diag.evidence ?? []).map((ev, i) => (
            <div key={i} className="text-mono" style={{
              fontSize: '0.82em', padding: '3px 8px', marginBottom: 2,
              background: 'var(--bg-elevated, rgba(0,0,0,0.04))', borderRadius: 3,
              borderLeft: '2px solid var(--border)',
              whiteSpace: 'normal', wordBreak: 'break-word',
            }}>
              {ev}
            </div>
          ))}
        </div>
      )}

      {/* 涉及模块 + 时间范围 */}
      <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.78em', color: 'var(--text-muted)' }}>
        {(diag.sources?.length ?? 0) > 0 && (
          <span>模块：<span className="text-mono">{(diag.sources ?? []).join(', ')}</span></span>
        )}
        {diag.first_seen && (
          <span>首次：{diag.first_seen}</span>
        )}
        {diag.last_seen && (
          <span>末次：{diag.last_seen}</span>
        )}
      </div>
    </div>
  );
}
