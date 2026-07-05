import { Link } from 'react-router-dom';
import { useApi } from '../api/bridge';

interface PluginRow {
  name?: string;
  version?: string;
  author?: string;
  activated?: boolean;
  reserved?: boolean;
  repo?: string;
  description?: string;
}

interface SecurityAlert {
  plugin?: string;
  pattern?: string;
  count?: number;
  file?: string;
  line?: number;
  severity?: string;
}

interface Conflict {
  conflict_key?: string;
  plugin_name?: string;
  handler?: string;
  status?: string;
  resolution?: string;
}

interface LifecycleEvent {
  ts?: number | string;
  event?: string;
  plugin?: string;
}

interface HookHandler {
  plugin?: string;
  reserved?: boolean;
  handler?: string;
  full_name?: string;
  priority?: number;
  enabled?: boolean;
  risks?: string[];
  desc?: string;
}

interface HookGroup {
  event_type?: string;
  label?: string;
  risk_level?: string;
  count?: number;
  multi_plugin?: boolean;
  same_priority?: boolean;
  handlers?: HookHandler[];
}

interface HookConflict {
  type?: string;
  severity?: string;
  event_type?: string;
  event_label?: string;
  plugin?: string;
  handler?: string;
  line?: number;
  count?: number;
  plugins?: string[];
  priority?: number;
  desc?: string;
}

interface HooksReport {
  total_handlers?: number;
  total_event_types?: number;
  groups?: HookGroup[];
  conflicts?: HookConflict[];
  conflict_count?: number;
  high_risk_count?: number;
  error?: string;
}

interface PluginData {
  total?: number;
  active?: number;
  inactive?: number;
  plugins?: PluginRow[];
  security_alerts?: SecurityAlert[];
  high_alert_count?: number;
  conflicts?: Conflict[];
  hooks?: HooksReport;
  lifecycle_log?: LifecycleEvent[];
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-';
  return String(v);
};

const formatTs = (ts: number | string | undefined): string => {
  if (!ts) return '-';
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? String(ts) : d.toLocaleString('zh-CN', { hour12: false });
  }
  return ts;
};

const severityClass = (sev: string | undefined): string => {
  const s = (sev || '').toLowerCase();
  if (['critical', 'high'].includes(s)) return 'severity-high';
  if (['medium'].includes(s)) return 'severity-medium';
  return 'severity-low';
};

// 钩子风险标签 → 中文
const RISK_LABELS: Record<string, string> = {
  event_stop: '事件终止',
  overwrite_system_prompt: '覆盖Prompt',
  overwrite_result: '覆盖结果',
};

const CONFLICT_TYPE_LABELS: Record<string, string> = {
  multi_handler: '多插件监听',
  event_stop: '事件终止',
  overwrite: '覆盖风险',
  same_priority: '同优先级',
};

const renderRiskBadge = (risk: string) => {
  const cls =
    risk === 'event_stop'
      ? 'severity-high'
      : risk === 'overwrite_system_prompt'
        ? 'severity-medium'
        : 'severity-low';
  return (
    <span key={risk} className={`tag ${cls === 'severity-high' ? 'inactive' : 'active'}`} style={{ marginRight: 4 }}>
      {RISK_LABELS[risk] || risk}
    </span>
  );
};

export default function PluginDetail() {
  const { data, loading, error } = useApi<PluginData>('/plugin');

  const plugins = data?.plugins ?? [];
  const alerts = data?.security_alerts ?? [];
  const conflicts = data?.conflicts ?? [];
  const audit = data?.lifecycle_log ?? [];
  const hooks = data?.hooks;
  const total = data?.total ?? plugins.length;
  const active = data?.active ?? plugins.filter((p) => p.activated).length;
  const inactive = data?.inactive ?? plugins.filter((p) => !p.activated).length;
  const highAlerts = data?.high_alert_count ?? alerts.filter((a) => a.severity === 'high').length;
  const hookConflicts = hooks?.conflicts ?? [];
  const hookHighRisk = hooks?.high_risk_count ?? 0;

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">🧩 插件分析</h1>
      <p className="page-subtitle">插件清单、安全审计、冲突检测与生命周期</p>

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
              <div className="stat-block__label">插件总数</div>
              <div className="stat-block__value">{total}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">已激活</div>
              <div className="stat-block__value text-primary">{active}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">未激活</div>
              <div className="stat-block__value text-muted">{inactive}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">高危告警</div>
              <div className={'stat-block__value ' + (highAlerts > 0 ? 'text-error' : 'text-primary')}>
                {highAlerts}
              </div>
              <div className="stat-block__sub">共 {alerts.length} 项</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">冲突</div>
              <div className={'stat-block__value ' + (conflicts.length > 0 ? 'text-warning' : 'text-primary')}>
                {conflicts.length}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">钩子总数</div>
              <div className="stat-block__value">{hooks?.total_handlers ?? '-'}</div>
              <div className="stat-block__sub">{hooks?.total_event_types ?? 0} 类事件</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">钩子冲突</div>
              <div className={'stat-block__value ' + (hookHighRisk > 0 ? 'text-error' : hookConflicts.length > 0 ? 'text-warning' : 'text-primary')}>
                {hookConflicts.length}
              </div>
              <div className="stat-block__sub">{hookHighRisk} 高危</div>
            </div>
          </div>

          {alerts.length > 0 && (
            <div className="alert-banner error">
              ⚠ 检测到 {alerts.length} 项安全风险，请尽快审查下方告警。
            </div>
          )}

          {/* 插件列表 */}
          <h2 className="section-title">插件列表</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>版本</th>
                  <th>作者</th>
                  <th>状态</th>
                  <th>保留</th>
                  <th>仓库</th>
                </tr>
              </thead>
              <tbody>
                {plugins.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name ?? '-'}</td>
                    <td>{p.version ?? '-'}</td>
                    <td>{p.author ?? '-'}</td>
                    <td>
                      <span className={'tag ' + (p.activated ? 'active' : 'inactive')}>
                        {p.activated ? '已激活' : '未激活'}
                      </span>
                    </td>
                    <td>{p.reserved ? '是' : '否'}</td>
                    <td>
                      {p.repo ? (
                        <a href={p.repo} target="_blank" rel="noreferrer">
                          {p.repo}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
                {plugins.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无插件
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 安全告警 */}
          <h2 className="section-title">安全告警</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>插件</th>
                  <th>匹配模式</th>
                  <th className="numeric">次数</th>
                  <th>文件</th>
                  <th className="numeric">行号</th>
                  <th>严重级别</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={i}>
                    <td>{a.plugin ?? '-'}</td>
                    <td className="text-mono">{a.pattern ?? '-'}</td>
                    <td className="numeric cell-error">{a.count ?? '-'}</td>
                    <td className="text-mono" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.file ?? '-'}
                    </td>
                    <td className="numeric">{a.line ?? '-'}</td>
                    <td className={severityClass(a.severity)}>
                      {a.severity ?? '-'}
                    </td>
                  </tr>
                ))}
                {alerts.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      未发现安全风险
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 冲突列表 */}
          <h2 className="section-title">插件指令冲突</h2>
          {conflicts.length > 0 ? (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>插件</th>
                    <th>冲突键</th>
                    <th>处理器</th>
                    <th>状态</th>
                    <th>解决方案</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c, i) => (
                    <tr key={i}>
                      <td>{c.plugin_name ?? '-'}</td>
                      <td className="text-mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.conflict_key ?? '-'}
                      </td>
                      <td className="text-mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.handler ?? '-'}
                      </td>
                      <td>
                        <span className={'tag ' + (c.status === 'resolved' ? 'active' : 'inactive')}>
                          {c.status ?? '-'}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>{c.resolution ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card">
              <div className="timeline-empty">未检测到插件冲突</div>
            </div>
          )}

          {/* 钩子全景与冲突 */}
          <h2 className="section-title">🪝 钩子全景与冲突</h2>
          <p className="page-subtitle" style={{ marginBottom: 12 }}>
            AstrBot 所有 <code>@filter.on_xxx()</code> 钩子按优先级串行执行；
            多插件监听同一钩子时，<strong>事件终止</strong>会静默掐断后续处理器，<strong>覆盖赋值</strong>会抹掉其它插件的修改。
          </p>

          {hooks?.error ? (
            <div className="card">
              <div className="timeline-empty" style={{ color: 'var(--text-error)' }}>
                钩子分析不可用：{hooks.error}
              </div>
            </div>
          ) : (
            <>
              {/* 钩子冲突告警 */}
              {hookConflicts.length > 0 && (
                <div className="table-wrapper" style={{ marginBottom: 16 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>类型</th>
                        <th>严重级别</th>
                        <th>钩子</th>
                        <th>涉及插件</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hookConflicts.map((c, i) => (
                        <tr key={i}>
                          <td>
                            <span className="text-mono">{CONFLICT_TYPE_LABELS[c.type ?? ''] ?? c.type}</span>
                          </td>
                          <td className={severityClass(c.severity)}>{c.severity}</td>
                          <td>{c.event_label ?? c.event_type ?? '-'}</td>
                          <td style={{ maxWidth: 200 }}>
                            {c.plugin ? (
                              <span className="text-mono">{c.plugin}{c.handler ? `.${c.handler}` : ''}</span>
                            ) : c.plugins && c.plugins.length > 0 ? (
                              <span className="text-mono">{c.plugins.join(', ')}</span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td style={{ whiteSpace: 'normal', fontSize: '0.85em' }}>{c.desc ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 钩子全景图：按事件分组 */}
              {(hooks?.groups ?? []).map((g, gi) => (
                <div key={gi} className="card" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong>{g.label ?? g.event_type}</strong>
                      <span className="text-mono" style={{ marginLeft: 8, fontSize: '0.8em', color: 'var(--text-muted)' }}>
                        {g.event_type}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="tag active">{g.count} 个处理器</span>
                      {g.multi_plugin && (
                        <span className="tag inactive">多插件</span>
                      )}
                      {g.risk_level === 'high' && (
                        <span className="tag inactive" style={{ background: 'var(--error)' }}>高风险</span>
                      )}
                      {g.same_priority && (
                        <span className="tag inactive">同优先级</span>
                      )}
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>执行序</th>
                          <th>插件</th>
                          <th>处理器</th>
                          <th className="numeric">优先级</th>
                          <th>状态</th>
                          <th>风险</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(g.handlers ?? []).map((h, hi) => (
                          <tr key={hi}>
                            <td className="numeric text-muted">{hi + 1}</td>
                            <td>
                              <span className="text-mono">{h.plugin ?? '?'}</span>
                              {h.reserved && (
                                <span className="tag active" style={{ marginLeft: 4, fontSize: '0.7em' }}>保留</span>
                              )}
                            </td>
                            <td className="text-mono">{h.handler ?? '-'}</td>
                            <td className="numeric">{h.priority ?? 0}</td>
                            <td>
                              <span className={'tag ' + (h.enabled ? 'active' : 'inactive')}>
                                {h.enabled ? '启用' : '禁用'}
                              </span>
                            </td>
                            <td>
                              {(h.risks ?? []).length === 0 ? (
                                <span className="text-muted">-</span>
                              ) : (
                                (h.risks ?? []).map(renderRiskBadge)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {(!hooks?.groups || hooks.groups.length === 0) && (
                <div className="card">
                  <div className="timeline-empty">未发现已注册的钩子</div>
                </div>
              )}
            </>
          )}

          {/* 生命周期审计 */}
          <h2 className="section-title">生命周期审计</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>事件</th>
                  <th>插件</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e, i) => {
                  const isLoad = (e.event ?? '').includes('load') && !(e.event ?? '').includes('unload');
                  return (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {typeof e.ts === 'number'
                          ? new Date(e.ts * 1000).toLocaleString('zh-CN', { hour12: false })
                          : formatTs(e.ts)}
                      </td>
                      <td>
                        <span className={'tag ' + (isLoad ? 'active' : 'inactive')}>
                          {e.event ?? '-'}
                        </span>
                      </td>
                      <td>{e.plugin ?? '-'}</td>
                    </tr>
                  );
                })}
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      暂无审计记录
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
