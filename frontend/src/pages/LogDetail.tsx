import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/bridge';

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
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '0';
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

const levelClass = (level: string): string => {
  const u = (level || '').toUpperCase();
  if (['ERROR', 'FATAL', 'CRITICAL'].includes(u)) return 'cell-error';
  if (['WARN', 'WARNING'].includes(u)) return 'cell-warn';
  return 'cell-good';
};

export default function LogDetail() {
  const { data, loading, error } = useApi<LogData>('/log');

  const [levelFilter, setLevelFilter] = useState('');
  const [pluginFilter, setPluginFilter] = useState('');

  const fileEnabled = data?.file_available ?? true;
  const totalByLevel = data?.total_by_level ?? data?.by_level ?? {};
  const allEntries = data?.entries ?? data?.errors ?? [];
  const clusters = data?.clusters ?? data?.error_clusters ?? [];

  const filteredEntries = useMemo(() => {
    return allEntries.filter((e) => {
      const lvl = (e.level || '').toUpperCase();
      if (levelFilter && !lvl.includes(levelFilter.toUpperCase())) return false;
      const plugin = e.plugin ?? e.module ?? '';
      if (pluginFilter && !String(plugin).toLowerCase().includes(pluginFilter.toLowerCase())) return false;
      return true;
    });
  }, [allEntries, levelFilter, pluginFilter]);

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">📋 错误日志分析</h1>
      <p className="page-subtitle">日志级别分布、错误聚合与文件可用性检查</p>

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
            <input
              className="text-input"
              placeholder="例如 ERROR / WARN"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            />
            <label>模块 / 插件：</label>
            <input
              className="text-input"
              placeholder="关键字过滤"
              value={pluginFilter}
              onChange={(e) => setPluginFilter(e.target.value)}
            />
            <span className="text-muted" style={{ fontSize: 12 }}>
              共 {filteredEntries.length} 条
            </span>
          </div>

          {/* 错误条目表 */}
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
                {filteredEntries.slice(0, 200).map((e, i) => (
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

          {/* 错误聚类 */}
          <h2 className="section-title">错误聚类</h2>
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
        </>
      )}
    </div>
  );
}
