/**
 * 自我诊断面板 —— 展示钩子链路的注册/绑定/心跳/缓冲健康状况。
 *
 * 数据来源：后端 /diag 接口（diagnose_hooks()）。
 * 放在设置页顶部，帮助快速定位「某模块一直不更新」问题。
 */
import { useState } from 'react';
import { useApi, apiGet } from '../api/bridge';

/** 单个 handler 的绑定详情 */
interface BindingDetail {
  name: string;
  event: string;
  module_path?: string;
  bound: boolean;
  enabled: boolean;
  in_star_map: boolean;
  star_map_activated?: boolean;
  priority?: number;
}

/** /diag 返回结构 */
interface DiagReport {
  timestamp?: number;
  self_plugin_name?: string | null;
  module_path_patch?: {
    main_module?: string | null;
    patched_count?: number;
  };
  registry?: {
    total?: number;
    ours?: number;
    by_event?: Record<string, number>;
    error?: string;
  };
  binding?: {
    bound?: number;
    unbound?: number;
    details?: BindingDetail[];
  };
  config?: Record<string, unknown>;
  heartbeat?: Record<string, { calls?: number; last_ts?: number; last_err?: string | null }>;
  buffers?: {
    runtime_buf?: number;
    tool_buf?: number;
    context_last_keys?: number;
    context_history?: number;
    alert_history?: number;
    token_cache?: number | string;
  };
  runtime_chain?: {
    wait_calls?: number;
    req_calls?: number;
    resp_calls?: number;
    sent_calls?: number;
    timings_active?: number;
    runtime_buf_len?: number;
  };
}

/** 心跳友好名映射 */
const HB_LABELS: Record<string, string> = {
  _rt_on_wait: '运行时·等待请求',
  _rt_on_req: '运行时·LLM请求',
  _rt_on_resp: '运行时·LLM响应',
  _rt_on_sent: '运行时·消息发送后',
  _ctx_on_req_head: '上下文·请求头',
  _ctx_on_req_tail: '上下文·请求尾',
  _ctx_on_decorating: '上下文·结果装饰',
  _tl_on_tool_start: '工具·调用开始',
  _tl_on_tool_end: '工具·调用结束',
  _tl_on_agent_begin: '工具·Agent开始',
  _tl_on_agent_done: '工具·Agent结束',
  _tk_on_resp: 'Token·响应',
  _pl_on_loaded: '插件·加载',
  _pl_on_unloaded: '插件·卸载',
  _lg_on_plugin_error: '日志·插件异常',
};

const fmtTime = (ts?: number) => {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  return d.toLocaleTimeString();
};

export default function SelfDiag() {
  const { data, loading, error, refresh } = useApi<DiagReport>('/diag');
  const [expanded, setExpanded] = useState(false);

  // 整体健康判定
  const reg = data?.registry ?? {};
  const bnd = data?.binding ?? {};
  const hb = data?.heartbeat ?? {};
  const buf = data?.buffers ?? {};
  const cfg = data?.config ?? {};

  const oursCount = reg.ours ?? 0;
  const boundCount = bnd.bound ?? 0;
  const unboundCount = bnd.unbound ?? 0;
  const hbCount = Object.keys(hb).length;
  const hbCalls = Object.values(hb).reduce(
    (s, v) => s + (v.calls ?? 0),
    0
  );

  // 健康等级
  let level: 'ok' | 'warn' | 'error' = 'ok';
  const issues: string[] = [];
  if (reg.error) {
    level = 'error';
    issues.push('注册表查询失败');
  }
  if (oursCount === 0) {
    level = 'error';
    issues.push('未在注册表中找到本插件钩子（@filter 装饰器可能未执行）');
  } else if (unboundCount > 0) {
    level = 'warn';
    issues.push(`${unboundCount} 个钩子未绑定 self`);
  }
  // 检查 star_map 激活
  const notInStarMap = (bnd.details ?? []).filter((d) => !d.in_star_map);
  if (notInStarMap.length > 0) {
    level = level === 'ok' ? 'warn' : level;
    issues.push(`${notInStarMap.length} 个钩子不在 star_map（会被静默跳过）`);
  }
  // 检查心跳
  if (oursCount > 0 && hbCount === 0) {
    level = level === 'ok' ? 'warn' : level;
    issues.push('尚无任何钩子被触发（请先发送一条消息）');
  }

  // 模块开关检查（哪些已开启但心跳为 0）
  const moduleStatuses = [
    { key: 'enable_runtime_analysis', label: '运行时', hooks: ['_rt_on_wait', '_rt_on_req', '_rt_on_resp', '_rt_on_sent'] },
    { key: 'enable_context_dump', label: '上下文', hooks: ['_ctx_on_req_head', '_ctx_on_req_tail', '_ctx_on_decorating'] },
    { key: 'enable_tool_analysis', label: '工具', hooks: ['_tl_on_tool_start', '_tl_on_tool_end', '_tl_on_agent_begin', '_tl_on_agent_done'] },
    { key: 'enable_token_analysis', label: 'Token', hooks: ['_tk_on_resp'] },
    { key: 'enable_log_analysis', label: '日志', hooks: ['_lg_on_plugin_error'] },
  ].map((m) => {
    const enabled = cfg[m.key] !== false;
    const fired = m.hooks.some((h) => (hb[h]?.calls ?? 0) > 0);
    return { ...m, enabled, fired };
  });

  const levelText = level === 'ok' ? '健康' : level === 'warn' ? '需关注' : '异常';
  const levelClass = `self-diag__badge self-diag__badge--${level}`;

  const refreshDiag = () => {
    apiGet('/diag').finally(() => refresh());
  };

  return (
    <div className="self-diag">
      <div className="self-diag__header">
        <div className="self-diag__title">
          <span className="self-diag__icon">🩺</span>
          <span>自我诊断</span>
          <span className={levelClass}>{levelText}</span>
        </div>
        <div className="self-diag__actions">
          <button
            className="btn btn-secondary self-diag__refresh"
            onClick={refreshDiag}
            disabled={loading}
            title="重新诊断"
          >
            {loading ? '⟳' : '↻'} 刷新
          </button>
          <button
            className="btn btn-secondary self-diag__toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起 ▴' : '展开 ▾'}
          </button>
        </div>
      </div>

      {/* 顶层指标 */}
      <div className="self-diag__metrics">
        <div className="self-diag__metric">
          <div className="self-diag__metric-value">{oursCount}</div>
          <div className="self-diag__metric-label">注册钩子</div>
        </div>
        <div className="self-diag__metric">
          <div className={`self-diag__metric-value ${unboundCount === 0 ? 'self-diag__metric--ok' : 'self-diag__metric--warn'}`}>
            {boundCount}/{oursCount}
          </div>
          <div className="self-diag__metric-label">已绑定</div>
        </div>
        <div className="self-diag__metric">
          <div className={`self-diag__metric-value ${hbCount > 0 ? 'self-diag__metric--ok' : ''}`}>
            {hbCount}
          </div>
          <div className="self-diag__metric-label">已触发钩子</div>
        </div>
        <div className="self-diag__metric">
          <div className="self-diag__metric-value">{hbCalls}</div>
          <div className="self-diag__metric-label">总调用次数</div>
        </div>
      </div>

      {/* 问题提示 */}
      {issues.length > 0 ? (
        <div className="self-diag__issues">
          {issues.map((msg, i) => (
            <div key={i} className={`self-diag__issue self-diag__issue--${level}`}>
              ⚠ {msg}
            </div>
          ))}
        </div>
      ) : (
        <div className="self-diag__issues">
          <div className="self-diag__issue self-diag__issue--ok">
            ✓ 钩子链路正常
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="self-diag__issue self-diag__issue--error">
          ✗ 诊断接口错误：{error}
        </div>
      )}

      {/* 展开详情 */}
      {expanded && data && (
        <div className="self-diag__detail">
          {/* 模块心跳矩阵 */}
          <div className="self-diag__section">
            <div className="self-diag__section-title">模块心跳</div>
            <div className="self-diag__module-grid">
              {moduleStatuses.map((m) => {
                const cls = !m.enabled
                  ? 'off'
                  : m.fired
                  ? 'ok'
                  : 'pending';
                const txt = !m.enabled
                  ? '已关闭'
                  : m.fired
                  ? '已触发'
                  : '等待触发';
                return (
                  <div key={m.key} className={`self-diag__module self-diag__module--${cls}`}>
                    <span className="self-diag__module-label">{m.label}</span>
                    <span className="self-diag__module-status">{txt}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 运行时链路完整性 */}
          {data.runtime_chain && (() => {
            const rc = data.runtime_chain;
            const chain = [
              { label: '等待请求 (wait)', calls: rc.wait_calls ?? 0 },
              { label: 'LLM请求 (req)', calls: rc.req_calls ?? 0 },
              { label: 'LLM响应 (resp)', calls: rc.resp_calls ?? 0 },
              { label: '消息发送后 (sent)', calls: rc.sent_calls ?? 0 },
            ];
            const brokenAt = chain.findIndex((c) => c.calls === 0);
            const hasData = (rc.runtime_buf_len ?? 0) > 0;
            return (
              <div className="self-diag__section">
                <div className="self-diag__section-title">
                  运行时链路
                  {brokenAt >= 0 && !hasData && (
                    <span className="self-diag__bind-tag self-diag__bind-tag--err" style={{ marginLeft: 8 }}>
                      断链 at: {chain[brokenAt].label}
                    </span>
                  )}
                  {hasData && (
                    <span className="self-diag__bind-tag" style={{ marginLeft: 8, background: 'rgba(34,197,94,0.15)', color: '#16a34a' }}>
                      缓冲 {rc.runtime_buf_len} 条
                    </span>
                  )}
                </div>
                <div className="self-diag__chain-flow">
                  {chain.map((c, i) => {
                    const cls = c.calls > 0 ? 'ok' : 'broken';
                    return (
                      <div key={i} className="self-diag__chain-step">
                        <div className={`self-diag__chain-node self-diag__chain-node--${cls}`}>
                          {c.calls > 0 ? '✓' : '✗'}
                        </div>
                        <div className="self-diag__chain-label">{c.label}</div>
                        <div className="self-diag__chain-count">{c.calls} 次</div>
                        {i < chain.length - 1 && (
                          <div className={`self-diag__chain-arrow ${chain[i + 1].calls === 0 ? 'broken' : ''}`}>
                            →
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 心跳详情 */}
          {hbCount > 0 && (
            <div className="self-diag__section">
              <div className="self-diag__section-title">心跳详情</div>
              <div className="self-diag__hb-list">
                {Object.entries(hb)
                  .sort((a, b) => (b[1].calls ?? 0) - (a[1].calls ?? 0))
                  .map(([name, info]) => (
                    <div key={name} className="self-diag__hb-item">
                      <span className="self-diag__hb-name">
                        {HB_LABELS[name] ?? name}
                      </span>
                      <span className="self-diag__hb-calls">{info.calls ?? 0} 次</span>
                      <span className="self-diag__hb-time">{fmtTime(info.last_ts)}</span>
                      {info.last_err && (
                        <span className="self-diag__hb-err" title={info.last_err}>
                          ⚠
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 缓冲区 */}
          <div className="self-diag__section">
            <div className="self-diag__section-title">数据缓冲</div>
            <div className="self-diag__buf-grid">
              <div className="self-diag__buf">
                <span className="self-diag__buf-label">运行时</span>
                <span className="self-diag__buf-value">{buf.runtime_buf ?? 0}</span>
              </div>
              <div className="self-diag__buf">
                <span className="self-diag__buf-label">工具</span>
                <span className="self-diag__buf-value">{buf.tool_buf ?? 0}</span>
              </div>
              <div className="self-diag__buf">
                <span className="self-diag__buf-label">上下文(当前)</span>
                <span className="self-diag__buf-value">{buf.context_last_keys ?? 0}</span>
              </div>
              <div className="self-diag__buf">
                <span className="self-diag__buf-label">上下文(历史)</span>
                <span className="self-diag__buf-value">{buf.context_history ?? 0}</span>
              </div>
              <div className="self-diag__buf">
                <span className="self-diag__buf-label">告警</span>
                <span className="self-diag__buf-value">{buf.alert_history ?? 0}</span>
              </div>
              <div className="self-diag__buf">
                <span className="self-diag__buf-label">Token缓存</span>
                <span className="self-diag__buf-value">{buf.token_cache ?? 0}</span>
              </div>
            </div>
          </div>

          {/* 绑定明细 */}
          {(bnd.details ?? []).length > 0 && (
            <div className="self-diag__section">
              <div className="self-diag__section-title">
                绑定明细（{boundCount} 已绑定 / {unboundCount} 未绑定）
              </div>
              <div className="self-diag__bind-list">
                {(bnd.details ?? [])
                  .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
                  .map((d) => {
                    const ok = d.bound && d.in_star_map && d.enabled;
                    return (
                      <div
                        key={d.name}
                        className={`self-diag__bind-item ${ok ? '' : 'self-diag__bind-item--warn'}`}
                      >
                        <span className={`self-diag__bind-flag ${ok ? 'ok' : 'warn'}`}>
                          {ok ? '✓' : '⚠'}
                        </span>
                        <span className="self-diag__bind-name">{d.name}</span>
                        <span className="self-diag__bind-evt">{d.event}</span>
                        <span className="self-diag__bind-pri">pri={d.priority ?? 0}</span>
                        {!d.bound && <span className="self-diag__bind-tag">未绑定</span>}
                        {!d.in_star_map && (
                          <span className="self-diag__bind-tag self-diag__bind-tag--err">
                            不在star_map
                          </span>
                        )}
                        {!d.enabled && <span className="self-diag__bind-tag">已禁用</span>}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* 元信息 */}
          <div className="self-diag__meta">
            {data.self_plugin_name && (
              <span>插件名: {data.self_plugin_name}</span>
            )}
            {data.module_path_patch?.main_module && (
              <span>主模块: {data.module_path_patch.main_module}</span>
            )}
            {data.timestamp && <span>诊断时间: {fmtTime(data.timestamp)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
