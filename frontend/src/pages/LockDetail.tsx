/**
 * 会话锁详情页
 *
 * 展示 AstrBot 运行时的会话锁状态：
 *  - 各会话的持锁状态、等待者数、持锁时长、风险等级
 *  - 活跃事件数、活跃 Agent Runner
 *  - asyncio Task 统计
 */
import { Link } from 'react-router-dom';
import { useApi } from '../api/bridge';

interface LockSession {
  umo: string;
  locked: boolean;
  waiters: number;
  hold_secs: number;
  level: 'ok' | 'warn' | 'danger';
  active_events: number;
  has_runner: boolean;
}

interface LockSummary {
  total_sessions: number;
  danger: number;
  warning: number;
  total_waiters: number;
  max_hold_secs: number;
  total_tasks: number;
}

interface LockData {
  sessions: LockSession[];
  summary: LockSummary;
  tasks: { total_tasks: number; lock_waiting_approx: number };
  thresholds: {
    hold_warn: number;
    hold_danger: number;
    waiter_warn: number;
  };
}

const LEVEL_LABEL: Record<string, string> = {
  danger: '高危',
  warn: '警告',
  ok: '正常',
};

const LEVEL_CLASS: Record<string, string> = {
  danger: 'cell-error',
  warn: 'cell-warn',
  ok: 'cell-good',
};

function fmtDuration(secs: number): string {
  if (!secs || secs <= 0) return '-';
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

function maskUmo(umo: string): string {
  // 脱敏：保留平台和最后4字符
  if (!umo) return '-';
  if (umo.length <= 12) return umo;
  const parts = umo.split(':');
  const platform = parts[0] || '';
  const tail = umo.slice(-4);
  return `${platform}:***${tail}`;
}

export default function LockDetail() {
  const { data, loading, error } = useApi<LockData>('/lock');

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">🔒 会话锁分析</h1>
      <p className="page-subtitle">
        检测长时间持锁、请求堆积与潜在死锁风险
      </p>

      {loading && (
        <div className="state-box">
          <div className="state-box__spinner" />
          <div>加载中...</div>
        </div>
      )}
      {error && !loading && (
        <div className="state-box state-box--error">
          <div>加载失败：{error}</div>
        </div>
      )}

      {data && !loading && (
        <>
          {/* 概要统计 */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-block">
              <div className="stat-block__label">活跃会话</div>
              <div className="stat-block__value">{data.summary.total_sessions}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">高危（疑似死锁）</div>
              <div className={'stat-block__value ' + (data.summary.danger > 0 ? 'cell-error' : 'cell-good')}>
                {data.summary.danger}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">警告（锁堆积）</div>
              <div className={'stat-block__value ' + (data.summary.warning > 0 ? 'cell-warn' : 'cell-good')}>
                {data.summary.warning}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">等待中的请求</div>
              <div className="stat-block__value">{data.summary.total_waiters}</div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">最长持锁时长</div>
              <div className={'stat-block__value ' + (data.summary.max_hold_secs >= data.thresholds.hold_danger ? 'cell-error' : data.summary.max_hold_secs >= data.thresholds.hold_warn ? 'cell-warn' : '')}>
                {fmtDuration(data.summary.max_hold_secs)}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block__label">asyncio 任务总数</div>
              <div className="stat-block__value">{data.summary.total_tasks}</div>
            </div>
          </div>

          {/* 风险说明 */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card__title">监控原理</div>
            <p className="form-row__desc" style={{ lineHeight: 1.8 }}>
              AstrBot 通过 <code>session_lock_manager</code> 对每个会话（unified_msg_origin）
              的 LLM 请求串行化，避免并发污染对话历史。当 LLM Provider 网络挂起、工具调用
              卡住或 MCP 执行无返回时，该锁可能被<strong>长时间持有</strong>，导致同会话
              后续消息全部堆积。
            </p>
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-block">
                <div className="stat-block__label">持锁告警阈值</div>
                <div className="stat-block__value" style={{ fontSize: 16 }}>
                  {data.thresholds.hold_warn}s
                </div>
              </div>
              <div className="stat-block">
                <div className="stat-block__label">持锁高危阈值</div>
                <div className="stat-block__value cell-error" style={{ fontSize: 16 }}>
                  {data.thresholds.hold_danger}s
                </div>
              </div>
              <div className="stat-block">
                <div className="stat-block__label">等待者告警阈值</div>
                <div className="stat-block__value" style={{ fontSize: 16 }}>
                  ≥ {data.thresholds.waiter_warn}
                </div>
              </div>
            </div>
          </div>

          {/* 会话明细表 */}
          <h2 className="section-title">会话明细</h2>
          {data.sessions.length === 0 ? (
            <div className="card">
              <div className="timeline-empty">
                ✅ 当前无活跃会话锁，系统运行正常
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>会话 (UMO)</th>
                    <th className="numeric">状态</th>
                    <th className="numeric">持锁</th>
                    <th className="numeric">等待者</th>
                    <th className="numeric">持锁时长</th>
                    <th className="numeric">活跃事件</th>
                    <th className="numeric">Agent运行</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {maskUmo(s.umo)}
                      </td>
                      <td className={'numeric ' + LEVEL_CLASS[s.level]}>
                        {LEVEL_LABEL[s.level] || s.level}
                      </td>
                      <td className="numeric">
                        {s.locked ? '🔒 是' : '-'}
                      </td>
                      <td className={'numeric ' + (s.waiters >= data.thresholds.waiter_warn ? 'cell-warn' : '')}>
                        {s.waiters}
                      </td>
                      <td className={'numeric ' + (s.hold_secs >= data.thresholds.hold_danger ? 'cell-error' : s.hold_secs >= data.thresholds.hold_warn ? 'cell-warn' : '')}>
                        {fmtDuration(s.hold_secs)}
                      </td>
                      <td className="numeric">{s.active_events}</td>
                      <td className="numeric">{s.has_runner ? '✓' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 提示 */}
          <div className="alert-banner" style={{ marginTop: 20 }}>
            💡 UMO（会话标识）已脱敏显示。持锁时长为近似值，依赖运行时探针采集。
            如发现高危会话，建议检查对应 LLM Provider 的网络连通性或重启相关服务。
          </div>
        </>
      )}
    </div>
  );
}
