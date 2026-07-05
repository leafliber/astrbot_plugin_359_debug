import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/bridge';
import { formatTs, fmt } from '../utils';
import { StateBox } from '../components/StateBox';

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

interface HookConflict {
  type?: string;
  severity?: string;
  static?: boolean;
  runtime_evidence?: boolean;
  event_type?: string;
  event_label?: string;
  plugin?: string;
  handler?: string;
  line?: number;
  count?: number;
  plugins?: string[];
  priority?: number;
  shared_obj?: boolean;
  calls?: number;
  stopped?: number;
  stop_rate?: number;
  last_order?: string[];
  desc?: string;
}

interface HookRuntimeInfo {
  calls?: number;
  stopped?: number;
  has_evidence?: boolean;
}

interface HookGroup {
  event_type?: string;
  label?: string;
  risk_level?: string;
  shared_obj?: boolean;
  count?: number;
  multi_plugin?: boolean;
  runtime?: HookRuntimeInfo | null;
  handlers?: HookHandler[];
  conflicts?: HookConflict[];
}

interface HooksReport {
  total_handlers?: number;
  total_event_types?: number;
  groups?: HookGroup[];
  conflicts?: HookConflict[];
  conflict_count?: number;
  high_risk_count?: number;
  medium_count?: number;
  low_count?: number;
  info_count?: number;
  runtime_tracked?: string[];
  self_plugin?: string;
  self_handler_count?: number;
  include_self?: boolean;
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

const severityClass = (sev: string | undefined): string => {
  const s = (sev || '').toLowerCase();
  if (['critical', 'high'].includes(s)) return 'severity-high';
  if (['medium'].includes(s)) return 'severity-medium';
  if (['info'].includes(s)) return 'severity-info';
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
  runtime_stop: '运行时终止',
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

// 钩子组卡片：折叠详情，精简显示
function HookGroupCard({ group }: { group: HookGroup }) {
  const [open, setOpen] = useState(false);
  const conflicts = group.conflicts ?? [];
  const handlers = group.handlers ?? [];
  const risk = group.risk_level ?? 'info';
  const runtime = group.runtime;
  const hasRuntimeEvidence = runtime?.has_evidence;

  // 头部严重级别样式
  const headClass =
    risk === 'high' ? 'severity-high' :
    risk === 'medium' ? 'severity-medium' :
    risk === 'low' ? 'severity-low' :
    risk === 'info' ? 'severity-info' : '';

  const riskLabel =
    risk === 'high' ? '高危' :
    risk === 'medium' ? '中危' :
    risk === 'low' ? '低危' :
    risk === 'info' ? '潜在' : '正常';

  const pluginSet = new Set<string>();
  handlers.forEach((h) => { if (h.plugin) pluginSet.add(h.plugin); });

  return (
    <div className="card" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
      {/* 折叠头部 */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
          background: open ? 'var(--bg-elevated, rgba(0,0,0,0.03))' : 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ width: 10, fontSize: '0.8em', color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
          <strong>{group.label ?? group.event_type}</strong>
          <span className={`tag ${risk === 'high' || risk === 'medium' ? 'inactive' : 'active'}`} >
            {riskLabel}
          </span>
          {group.shared_obj && (
            <span className="tag inactive" style={{ fontSize: '0.75em' }}>共享对象</span>
          )}
          {hasRuntimeEvidence && (
            <span className="tag inactive" style={{ background: 'var(--error)', fontSize: '0.75em' }}>
              运行时实证
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="text-muted" style={{ fontSize: '0.85em' }}>
            {handlers.length} 处理器 · {pluginSet.size} 插件
          </span>
          {conflicts.length > 0 && (
            <span className={headClass} style={{ fontSize: '0.85em' }}>
              {conflicts.length} 告警
            </span>
          )}
        </div>
      </div>

      {/* 展开内容 */}
      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border, rgba(0,0,0,0.06))' }}>
          {/* 冲突清单 */}
          {conflicts.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: '0.85em', color: 'var(--text-muted)', marginBottom: 6 }}>告警详情</div>
              {conflicts.map((c, i) => (
                <div key={i} style={{
                  padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                  background: 'var(--bg-elevated, rgba(0,0,0,0.03))',
                  borderLeft: `3px solid ${
                    c.severity === 'high' ? 'var(--error)' :
                    c.severity === 'medium' ? 'var(--warning, #f0ad4e)' :
                    c.severity === 'info' ? '#3b82f6' : 'var(--border)'
                  }`,
                  fontSize: '0.88em',
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={severityClass(c.severity)} style={{ fontWeight: 600 }}>
                      {c.severity}
                    </span>
                    <span className="text-mono" style={{ fontSize: '0.85em' }}>
                      {CONFLICT_TYPE_LABELS[c.type ?? ''] ?? c.type}
                    </span>
                    {c.runtime_evidence && (
                      <span className="tag inactive" style={{ fontSize: '0.7em', background: 'var(--error)' }}>实证</span>
                    )}
                    {c.static && !c.runtime_evidence && (
                      <span className="text-muted" style={{ fontSize: '0.75em' }}>静态</span>
                    )}
                  </div>
                  <div style={{ marginTop: 3 }}>{c.desc ?? '-'}</div>
                  {/* 运行时实证数据 */}
                  {c.type === 'runtime_stop' && (
                    <div style={{ marginTop: 4, fontSize: '0.85em', color: 'var(--text-muted)' }}>
                      调用 {c.calls} 次 / 终止 {c.stopped} 次 / 终止率 {c.stop_rate}%
                      {c.last_order && c.last_order.length > 0 && (
                        <span> · 末次顺序: {c.last_order.join(' → ')}</span>
                      )}
                    </div>
                  )}
                  {/* 涉及插件 */}
                  {c.plugins && c.plugins.length > 0 && (
                    <div style={{ marginTop: 3, fontSize: '0.82em' }} className="text-mono">
                      {c.plugins.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 处理器表 */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: '0.85em', color: 'var(--text-muted)', marginBottom: 6 }}>
              处理器（按执行顺序）
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>序</th>
                    <th>插件</th>
                    <th>处理器</th>
                    <th className="numeric">优先级</th>
                    <th>状态</th>
                    <th>风险</th>
                  </tr>
                </thead>
                <tbody>
                  {handlers.map((h, hi) => (
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
        </div>
      )}
    </div>
  );
}

export default function PluginDetail() {
  const { data, loading, error } = useApi<PluginData>('/plugin');
  // 钩子区块独立拉取，便于“显示本插件钩子”开关切换 include_self 参数
  const [showSelfHooks, setShowSelfHooks] = useState(false);
  const { data: hooksData } = useApi<HooksReport>(
    '/hooks',
    showSelfHooks ? { include_self: true } : undefined
  );

  const plugins = data?.plugins ?? [];
  const alerts = data?.security_alerts ?? [];
  const conflicts = data?.conflicts ?? [];
  const audit = data?.lifecycle_log ?? [];
  // 钩子数据优先用独立 /hooks 拉取结果（支持 include_self 切换），回退到 /plugin 内嵌
  const hooks = hooksData ?? data?.hooks;
  const total = data?.total ?? plugins.length;
  const active = data?.active ?? plugins.filter((p) => p.activated).length;
  const inactive = data?.inactive ?? plugins.filter((p) => !p.activated).length;
  const highAlerts = data?.high_alert_count ?? alerts.filter((a) => a.severity === 'high').length;
  const hookConflicts = hooks?.conflicts ?? [];
  const hookHighRisk = hooks?.high_risk_count ?? 0;
  const hookMedium = hooks?.medium_count ?? 0;
  const hookLow = hooks?.low_count ?? 0;
  const hookInfo = hooks?.info_count ?? 0;

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">🧩 插件分析</h1>
      <p className="page-subtitle">插件清单、安全审计、冲突检测与生命周期</p>

      <StateBox loading={loading} error={error} />

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
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>🪝 钩子全景与冲突</span>
            <label style={{ fontSize: '0.85em', fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showSelfHooks}
                onChange={(e) => setShowSelfHooks(e.target.checked)}
              />
              显示本插件钩子
              {(hooks?.self_handler_count ?? 0) > 0 && !showSelfHooks && (
                <span className="text-muted" style={{ marginLeft: 4 }}>
                  （已隐藏 {hooks?.self_handler_count} 个）
                </span>
              )}
            </label>
          </h2>
          <p className="page-subtitle" style={{ marginBottom: 12 }}>
            AstrBot 所有 <code>@filter.on_xxx()</code> 钩子按优先级串行执行；
            <strong className="severity-high">高危</strong>仅标注运行时实证（真的发生过终止/覆盖），
            <strong className="severity-medium">中危</strong>为静态扫描发现具体风险代码，
            <strong className="severity-low">低危</strong>为较轻的覆盖风险，
            <strong className="severity-info">潜在</strong>（蓝色）为多插件共用钩子等普遍现象，仅作提示。
            {!showSelfHooks && (hooks?.self_handler_count ?? 0) > 0 && (
              <span className="text-muted"> 本插件的诊断钩子默认隐藏（属观测工具，非被分析对象）。</span>
            )}
          </p>

          {hooks?.error ? (
            <div className="card">
              <div className="timeline-empty" style={{ color: 'var(--text-error)' }}>
                钩子分析不可用：{hooks.error}
              </div>
            </div>
          ) : (
            <>
              {/* 摘要条 */}
              <div className="card" style={{ marginBottom: 12, padding: '10px 14px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <span><strong>{hooks?.total_handlers ?? 0}</strong> 个处理器</span>
                <span><strong>{hooks?.total_event_types ?? 0}</strong> 类事件</span>
                <span className="severity-medium"><strong>{hookConflicts.length}</strong> 条告警</span>
                <span className="severity-high"><strong>{hookHighRisk}</strong> 高危</span>
                {hookMedium > 0 && <span className="severity-medium"><strong>{hookMedium}</strong> 中危</span>}
                {hookLow > 0 && <span className="severity-low"><strong>{hookLow}</strong> 低危</span>}
                {hookInfo > 0 && <span className="severity-info"><strong>{hookInfo}</strong> 潜在</span>}
                {(hooks?.runtime_tracked?.length ?? 0) > 0 && (
                  <span className="text-muted">运行时观测：{hooks?.runtime_tracked?.length} 类</span>
                )}
              </div>

              {/* 按钩子折叠展示 */}
              {(hooks?.groups ?? []).map((g, gi) => (
                <HookGroupCard key={gi} group={g} />
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
