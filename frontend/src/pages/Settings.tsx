import { useEffect, useState } from 'react';
import { useApi, apiPost } from '../api/bridge';
import SelfDiag from '../components/SelfDiag';

/**
 * 插件配置结构（键名严格对齐后端 CONFIG_DEFAULTS）。
 */
interface PluginConfig {
  enable_runtime_analysis: boolean;
  enable_token_analysis: boolean;
  enable_context_dump: boolean;
  enable_tool_analysis: boolean;
  enable_log_analysis: boolean;
  enable_plugin_analysis: boolean;
  command_prefix: string;
  admin_only: boolean;
  slow_response_threshold: number;
  token_alert_threshold: number;
  cache_disruption_rounds: number;
  log_tail_lines: number;
  [key: string]: unknown;
}

/** 模块开关定义 */
const MODULES = [
  { key: 'enable_runtime_analysis', icon: '⏱️', title: '运行时监控', desc: '采集请求阶段、LLM 耗时等指标' },
  { key: 'enable_token_analysis',   icon: '🔢', title: 'Token 统计', desc: '统计模型 Token 用量与缓存命中' },
  { key: 'enable_context_dump',     icon: '📝', title: '上下文追踪', desc: 'Prompt 变更历史、缓存命中检测' },
  { key: 'enable_tool_analysis',    icon: '🔧', title: '工具调用监控', desc: '函数调用统计与 Agent 轨迹' },
  { key: 'enable_log_analysis',     icon: '📋', title: '日志分析', desc: '错误聚类、堆栈提取' },
  { key: 'enable_plugin_analysis',  icon: '🧩', title: '插件健康', desc: '插件冲突检测与生命周期审计' },
] as const;

/** 阈值配置定义 */
const THRESHOLDS = [
  { key: 'slow_response_threshold', label: '慢响应阈值', unit: '秒', min: 1, max: 300, step: 0.5, def: 10, desc: 'LLM 响应超过此阈值时触发告警' },
  { key: 'token_alert_threshold',   label: 'Token 用量告警', unit: 'tokens', min: 100, max: 1000000, step: 1000, def: 10000, desc: '单次请求 Token 超过此值时告警' },
  { key: 'cache_disruption_rounds', label: '缓存破坏检测轮数', unit: '轮', min: 1, max: 20, step: 1, def: 3, desc: '连续 N 轮缓存未命中视为缓存破坏' },
  { key: 'log_tail_lines',          label: '日志读取行数', unit: '行', min: 100, max: 5000, step: 100, def: 500, desc: '日志分析时从文件尾部读取的行数' },
] as const;

// ==================== 存储管理子组件 ====================

interface StorageKey {
  key: string;
  label: string;
  count: number;
  module: string;
}

interface StorageStatus {
  keys: StorageKey[];
  total_keys: number;
  plugin_id: string | null;
}

/** 按模块分组的存储管理面板 */
function StoragePanel({
  onClearKey,
  onClearAll,
  onSaveAll,
  busy,
}: {
  onClearKey: (key: string) => void;
  onClearAll: () => void;
  onSaveAll: () => void;
  busy: string | null;
}) {
  const { data, loading, refresh } = useApi<StorageStatus>('/storage_status', undefined, 5000);
  const keys = data?.keys ?? [];
  const totalCount = keys.reduce((acc, k) => acc + k.count, 0);

  // 按模块分组
  const moduleGroups: Record<string, StorageKey[]> = {};
  for (const k of keys) {
    const m = k.module || 'other';
    if (!moduleGroups[m]) moduleGroups[m] = [];
    moduleGroups[m].push(k);
  }
  const moduleLabels: Record<string, string> = {
    runtime: '运行时', token: 'Token', context: '上下文',
    tool: '工具', log: '日志', alert: '告警', plugin: '插件',
  };

  return (
    <>
      {/* 总览条 */}
      <div className="storage-overview">
        <div className="storage-overview__stat">
          <span className="storage-overview__value">{keys.length}</span>
          <span className="storage-overview__label">持久化键</span>
        </div>
        <div className="storage-overview__stat">
          <span className="storage-overview__value">{totalCount}</span>
          <span className="storage-overview__label">总记录数</span>
        </div>
        <div className="storage-overview__stat">
          <span className="storage-overview__value storage-overview__value--live">●</span>
          <span className="storage-overview__label">每 5s 自动刷新</span>
        </div>
      </div>

      {/* 分模块清理 */}
      <div className="storage-modules">
        {loading && keys.length === 0 ? (
          <div className="storage-empty">加载中...</div>
        ) : keys.length === 0 ? (
          <div className="storage-empty">暂无持久化数据</div>
        ) : (
          Object.entries(moduleGroups).map(([mod, modKeys]) => {
            const modTotal = modKeys.reduce((a, k) => a + k.count, 0);
            return (
              <div key={mod} className="storage-module-card">
                <div className="storage-module-card__header">
                  <div>
                    <span className="storage-module-card__title">{moduleLabels[mod] || mod}</span>
                    <span className="storage-module-card__count">{modTotal} 条</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost-danger"
                    onClick={() => modKeys.forEach((k) => onClearKey(k.key))}
                    disabled={busy !== null}
                  >
                    清理本模块
                  </button>
                </div>
                <div className="storage-module-card__keys">
                  {modKeys.map((k) => (
                    <div key={k.key} className="storage-key-row">
                      <span className="storage-key-row__label">{k.label}</span>
                      <span className="storage-key-row__count">{k.count}</span>
                      {k.count > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost-danger"
                          onClick={() => onClearKey(k.key)}
                          disabled={busy !== null}
                          title={`清理 ${k.label}`}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 操作按钮 */}
      <div className="storage-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => { onSaveAll(); refresh(); }}
          disabled={busy !== null}
        >
          {busy === 'save' ? '保存中...' : '💾 立即保存到 KV'}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={onClearAll}
          disabled={busy !== null}
        >
          {busy === 'clear-all' ? '清理中...' : '🗑️ 一键清理全部'}
        </button>
      </div>
    </>
  );
}

// ==================== 确认对话框 ====================

function ConfirmDialog({
  title, message, confirmLabel, onConfirm, onCancel, busy,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: '0.92em', lineHeight: 1.6 }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? '执行中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

export default function Settings() {
  const { data, loading } = useApi<{ config: PluginConfig }>('/settings');
  const [config, setConfig] = useState<PluginConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // 存储操作状态
  const [bufBusy, setBufBusy] = useState<string | null>(null);  // null | 'save' | 'clear-key' | 'clear-all'
  const [bufFeedback, setBufFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmKey, setConfirmKey] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => { if (data?.config) setConfig(data.config); }, [data]);

  const update = (key: keyof PluginConfig, value: unknown) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiPost('/settings', { config });
      if (res?.ok) {
        setFeedback({ ok: true, msg: '配置已保存' });
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setFeedback({ ok: false, msg: res?.error || '保存失败' });
      }
    } catch (e: any) {
      setFeedback({ ok: false, msg: e?.message || '网络错误' });
    } finally {
      setSaving(false);
    }
  };

  const scan = async () => {
    setFeedback(null);
    try {
      const res = await apiPost('/scan', {});
      if (res?.ok !== false) {
        setFeedback({ ok: true, msg: '扫描已触发，请稍后查看数据' });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback({ ok: false, msg: res?.error || '触发失败' });
      }
    } catch (e: any) {
      setFeedback({ ok: false, msg: e?.message || '网络错误' });
    }
  };

  // ===== 存储操作 =====
  const saveAllBuffers = async () => {
    setBufBusy('save');
    setBufFeedback(null);
    try {
      const res = await apiPost('/save_cache', {});
      if (res?.ok) {
        setBufFeedback({ ok: true, msg: '✓ 全部缓冲已保存到 KV' });
        setTimeout(() => setBufFeedback(null), 3000);
      } else {
        setBufFeedback({ ok: false, msg: res?.error || '保存失败' });
      }
    } catch (e: any) {
      setBufFeedback({ ok: false, msg: e?.message || '网络错误' });
    } finally {
      setBufBusy(null);
    }
  };

  const clearOneKey = async (key: string) => {
    setConfirmKey(null);
    setBufBusy('clear-key');
    setBufFeedback(null);
    try {
      const res = await apiPost('/clear_cache', { keys: [key] });
      if (res?.ok) {
        setBufFeedback({ ok: true, msg: `✓ 已清理 ${key}` });
        setTimeout(() => setBufFeedback(null), 3000);
      } else {
        setBufFeedback({ ok: false, msg: res?.error || '清理失败' });
      }
    } catch (e: any) {
      setBufFeedback({ ok: false, msg: e?.message || '网络错误' });
    } finally {
      setBufBusy(null);
    }
  };

  const clearAllBuffers = async () => {
    setConfirmAll(false);
    setBufBusy('clear-all');
    setBufFeedback(null);
    try {
      const res = await apiPost('/clear_cache', { keys: null });
      if (res?.ok) {
        setBufFeedback({ ok: true, msg: '✓ 全部持久化数据已清空' });
        setTimeout(() => setBufFeedback(null), 4000);
      } else {
        setBufFeedback({ ok: false, msg: res?.error || '清理失败' });
      }
    } catch (e: any) {
      setBufFeedback({ ok: false, msg: e?.message || '网络错误' });
    } finally {
      setBufBusy(null);
    }
  };

  return (
    <div>
      <h1 className="page-title">⚙️ 设置</h1>
      <p className="page-subtitle">管理各分析模块的开关、阈值与持久化存储</p>

      {/* 自我诊断面板 */}
      <SelfDiag />

      {/* ===== 功能模块开关 ===== */}
      <h2 className="section-title">功能模块</h2>
      <div className="settings-grid">
        {MODULES.map((m) => {
          const enabled = config[m.key] !== false;
          return (
            <div key={m.key} className={`settings-card ${enabled ? 'settings-card--on' : ''}`}>
              <div className="settings-card__header">
                <div className="settings-card__info">
                  <span className="settings-card__icon">{m.icon}</span>
                  <div>
                    <div className="settings-card__title">{m.title}</div>
                    <div className="settings-card__desc">{m.desc}</div>
                  </div>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => update(m.key, e.target.checked)}
                  />
                  <span className="toggle__slider" />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== 阈值配置 ===== */}
      <h2 className="section-title">阈值配置</h2>
      <div className="card">
        {THRESHOLDS.map((t, i) => (
          <div key={t.key} className="form-row" style={i === THRESHOLDS.length - 1 ? { borderBottom: 'none' } : undefined}>
            <div className="form-row__label">
              <span className="form-row__name">{t.label}</span>
              <span className="form-row__desc">{t.desc}（默认 {t.def}）</span>
            </div>
            <div className="threshold-input">
              <input
                type="number"
                className="input threshold-input__field"
                min={t.min}
                max={t.max}
                step={t.step}
                value={Number(config[t.key] ?? t.def)}
                onChange={(e) => update(t.key as keyof PluginConfig, Number(e.target.value))}
              />
              <span className="threshold-input__unit">{t.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ===== 指令与权限 ===== */}
      <h2 className="section-title">指令与权限</h2>
      <div className="card">
        <div className="form-row">
          <div className="form-row__label">
            <span className="form-row__name">指令前缀</span>
            <span className="form-row__desc">指令前缀，例如 debug 则使用 /debug runtime</span>
          </div>
          <input
            type="text"
            className="input"
            style={{ width: 120, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
            value={String(config.command_prefix ?? 'debug')}
            onChange={(e) => update('command_prefix', e.target.value)}
          />
        </div>
        <div className="form-row form-row--inline" style={{ borderBottom: 'none' }}>
          <div className="form-row__label">
            <span className="form-row__name">🔐 仅管理员可用</span>
            <span className="form-row__desc">开启后只有管理员能执行诊断指令（建议开启）</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={config.admin_only !== false}
              onChange={(e) => update('admin_only', e.target.checked)}
            />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>

      {/* ===== 持久化存储 ===== */}
      <h2 className="section-title">持久化存储</h2>
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88em', marginBottom: 12 }}>
          运行时 / Token / 上下文 / 工具 / 告警 / 日志等数据通过 AstrBot KV 持久化。
          自动每 60s 同步，重启不丢失。可分模块清理或一键全清。
        </p>
        <StoragePanel
          onClearKey={(k) => setConfirmKey({ key: k, label: k })}
          onClearAll={() => setConfirmAll(true)}
          onSaveAll={saveAllBuffers}
          busy={bufBusy}
        />
        {bufFeedback && (
          <div className={'feedback ' + (bufFeedback.ok ? 'success' : 'error')} style={{ marginTop: 12 }}>
            {bufFeedback.msg}
          </div>
        )}
      </div>

      {/* ===== 全局操作 ===== */}
      <div className="settings-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中...' : '💾 保存配置'}
        </button>
        <button className="btn btn-secondary" onClick={scan}>
          🔍 立即扫描
        </button>
        {feedback && (
          <div className={'feedback ' + (feedback.ok ? 'success' : 'error')}>
            {feedback.msg}
          </div>
        )}
      </div>

      {/* 确认对话框 */}
      {confirmAll && (
        <ConfirmDialog
          title="⚠ 确认清理全部持久化数据？"
          message={
            <>
              将清空本插件在 KV 中的所有数据（运行时、Token、上下文、工具调用、
              告警、日志、钩子实证等 9 个缓冲区），不可撤销。<br />
              <strong style={{ color: 'var(--text-error)' }}>
                内存中的数据会立即清空，插件重启后从头采集。
              </strong>
            </>
          }
          confirmLabel="确认清空全部"
          onConfirm={clearAllBuffers}
          onCancel={() => setConfirmAll(false)}
          busy={bufBusy !== null}
        />
      )}
      {confirmKey && (
        <ConfirmDialog
          title={`确认清理 ${confirmKey.label}？`}
          message={
            <>
              将清空该缓冲区的 KV 持久化数据和内存中的记录，不可撤销。
            </>
          }
          confirmLabel="确认清理"
          onConfirm={() => clearOneKey(confirmKey.key)}
          onCancel={() => setConfirmKey(null)}
          busy={bufBusy !== null}
        />
      )}
    </div>
  );
}
