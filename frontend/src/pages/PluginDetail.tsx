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

interface PluginData {
  total?: number;
  active?: number;
  inactive?: number;
  plugins?: PluginRow[];
  security_alerts?: SecurityAlert[];
  high_alert_count?: number;
  conflicts?: Conflict[];
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

export default function PluginDetail() {
  const { data, loading, error } = useApi<PluginData>('/plugin');

  const plugins = data?.plugins ?? [];
  const alerts = data?.security_alerts ?? [];
  const conflicts = data?.conflicts ?? [];
  const audit = data?.lifecycle_log ?? [];
  const total = data?.total ?? plugins.length;
  const active = data?.active ?? plugins.filter((p) => p.activated).length;
  const inactive = data?.inactive ?? plugins.filter((p) => !p.activated).length;
  const highAlerts = data?.high_alert_count ?? alerts.filter((a) => a.severity === 'high').length;

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
