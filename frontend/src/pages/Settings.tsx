import { useEffect, useState } from 'react';
import { useApi, apiPost } from '../api/bridge';
import SelfDiag from '../components/SelfDiag';

/**
 * 插件配置结构（键名严格对齐后端 CONFIG_DEFAULTS）。
 */
interface PluginConfig {
  // 模块开关
  enable_runtime_analysis: boolean;
  enable_token_analysis: boolean;
  enable_context_dump: boolean;
  enable_tool_analysis: boolean;
  enable_log_analysis: boolean;
  enable_plugin_analysis: boolean;
  // 指令
  command_prefix: string;
  admin_only: boolean;
  // 阈值
  slow_response_threshold: number;
  token_alert_threshold: number;
  cache_disruption_rounds: number;
  // 存储
  token_persist_to: string;
  log_tail_lines: number;
  // 其他可能存在的键（框架注入）
  [key: string]: unknown;
}

/** 模块开关定义 */
const MODULES = [
  { key: 'enable_runtime_analysis', title: '运行时监控', desc: '采集请求阶段、LLM 耗时等指标' },
  { key: 'enable_token_analysis', title: 'Token 统计', desc: '统计模型 Token 用量与缓存命中' },
  { key: 'enable_context_dump', title: '上下文追踪', desc: 'Prompt 变更历史、缓存命中检测' },
  { key: 'enable_tool_analysis', title: '工具调用监控', desc: '函数调用统计与 Agent 轨迹' },
  { key: 'enable_log_analysis', title: '日志分析', desc: '错误聚类、堆栈提取' },
  { key: 'enable_plugin_analysis', title: '插件健康', desc: '插件冲突检测与生命周期审计' },
] as const;

/** 持久化方式选项 */
const PERSIST_OPTIONS = [
  { value: 'kv', label: 'KV 存储（推荐）' },
  { value: 'db', label: '数据库' },
  { value: 'memory', label: '内存（重启丢失）' },
];

export default function Settings() {
  const { data, loading } = useApi<{ config: PluginConfig }>('/settings');
  const [config, setConfig] = useState<PluginConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (data?.config) setConfig(data.config);
  }, [data]);

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
        setFeedback({ ok: true, msg: '保存成功' });
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

  if (loading && !config) {
    return (
      <div className="state-box">
        <div className="state-box__spinner" />
        <div>加载配置中...</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="state-box">
        <div>暂无配置数据</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">⚙️ 设置</h1>
      <p className="page-subtitle">管理各分析模块的开关与阈值</p>

      {/* 自我诊断面板（钩子链路健康状况） */}
      <SelfDiag />

      {/* 功能模块开关 */}
      <h2 className="section-title">功能模块</h2>
      <div className="settings-grid">
        {MODULES.map((m) => {
          const enabled = config[m.key] !== false; // 默认开启，仅 false 时关闭
          return (
            <div key={m.key} className="settings-card">
              <div className="settings-card__header">
                <div>
                  <div className="settings-card__title">{m.title}</div>
                  <div className="settings-card__desc">{m.desc}</div>
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

      {/* 数值配置 */}
      <h2 className="section-title">阈值配置</h2>
      <div className="card">
        <div className="form-row">
          <label className="form-row__label">慢响应阈值（秒）</label>
          <input
            type="number"
            className="input"
            min={1}
            max={300}
            step={0.5}
            value={Number(config.slow_response_threshold ?? 10)}
            onChange={(e) =>
              update('slow_response_threshold', Number(e.target.value))
            }
          />
          <span className="form-row__desc">
            LLM 响应超过此阈值时触发告警（默认 10）
          </span>
        </div>
        <div className="form-row">
          <label className="form-row__label">Token 用量告警阈值</label>
          <input
            type="number"
            className="input"
            min={100}
            step={1000}
            value={Number(config.token_alert_threshold ?? 10000)}
            onChange={(e) =>
              update('token_alert_threshold', Number(e.target.value))
            }
          />
          <span className="form-row__desc">
            单次请求 Token 超过此值时告警（默认 10000）
          </span>
        </div>
        <div className="form-row">
          <label className="form-row__label">缓存破坏检测轮数</label>
          <input
            type="number"
            className="input"
            min={1}
            max={20}
            value={Number(config.cache_disruption_rounds ?? 3)}
            onChange={(e) =>
              update('cache_disruption_rounds', Number(e.target.value))
            }
          />
          <span className="form-row__desc">
            连续 N 轮缓存未命中视为缓存破坏（默认 3）
          </span>
        </div>
        <div className="form-row">
          <label className="form-row__label">日志读取行数</label>
          <input
            type="number"
            className="input"
            min={100}
            max={5000}
            step={100}
            value={Number(config.log_tail_lines ?? 500)}
            onChange={(e) =>
              update('log_tail_lines', Number(e.target.value))
            }
          />
          <span className="form-row__desc">
            日志分析时从文件尾部读取的行数（默认 500）
          </span>
        </div>
      </div>

      {/* 指令与权限 */}
      <h2 className="section-title">指令与权限</h2>
      <div className="card">
        <div className="form-row">
          <label className="form-row__label">指令前缀</label>
          <input
            type="text"
            className="input"
            value={String(config.command_prefix ?? 'debug')}
            onChange={(e) => update('command_prefix', e.target.value)}
          />
          <span className="form-row__desc">
            指令前缀，例如 debug 则使用 /debug runtime（默认 debug）
          </span>
        </div>
        <div className="form-row form-row--inline">
          <div>
            <label className="form-row__label">仅管理员可用</label>
            <span className="form-row__desc">
              开启后只有管理员能执行诊断指令（建议开启）
            </span>
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

      {/* 存储 */}
      <h2 className="section-title">存储方式</h2>
      <div className="card">
        <div className="form-row">
          <label className="form-row__label">Token 数据持久化</label>
          <select
            className="input"
            style={{ width: 'auto', minWidth: 200 }}
            value={String(config.token_persist_to ?? 'kv')}
            onChange={(e) => update('token_persist_to', e.target.value)}
          >
            {PERSIST_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="form-row__desc">
            Token 统计数据的持久化方式（默认 KV 存储）
          </span>
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中...' : '保存配置'}
        </button>
        <button className="btn btn-secondary" onClick={scan}>
          立即扫描
        </button>
        {feedback && (
          <div className={'feedback ' + (feedback.ok ? 'success' : 'error')}>
            {feedback.msg}
          </div>
        )}
      </div>
    </div>
  );
}
