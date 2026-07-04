import { useEffect, useState } from 'react';
import { useApi, apiPost } from '../api/bridge';

interface PluginConfig {
  runtime_enabled: boolean;
  runtime_alert_threshold: number;
  runtime_dump_root: string;
  token_enabled: boolean;
  token_alert_threshold: number;
  context_enabled: boolean;
  cache_disruption_rounds: number;
  tool_enabled: boolean;
  log_enabled: boolean;
  log_dump_root: string;
  plugin_enabled: boolean;
  plugin_analysis_enabled: boolean;
}

const MODULES = [
  { key: 'runtime_enabled', title: '运行时监控', desc: '采集请求阶段、LLM 耗时等指标' },
  { key: 'token_enabled', title: 'Token 统计', desc: '统计模型 Token 用量与缓存命中' },
  { key: 'context_enabled', title: '上下文追踪', desc: 'Prompt 变更历史、缓存命中检测' },
  { key: 'tool_enabled', title: '工具调用监控', desc: '函数调用统计与 Agent 轨迹' },
  { key: 'log_enabled', title: '日志分析', desc: '错误聚类、堆栈提取' },
  { key: 'plugin_enabled', title: '插件健康', desc: '插件冲突检测与生命周期审计' },
] as const;

export default function Settings() {
  const { data, loading } = useApi<{ config: PluginConfig }>('/settings');
  const [config, setConfig] = useState<PluginConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (data?.config) setConfig(data.config);
  }, [data]);

  const update = <K extends keyof PluginConfig>(key: K, value: PluginConfig[K]) => {
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
      if (res?.ok) {
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

      {/* 功能模块开关 */}
      <h2 className="section-title">功能模块</h2>
      <div className="settings-grid">
        {MODULES.map((m) => (
          <div key={m.key} className="settings-card">
            <div className="settings-card__header">
              <div>
                <div className="settings-card__title">{m.title}</div>
                <div className="settings-card__desc">{m.desc}</div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={!!config[m.key as keyof PluginConfig]}
                  onChange={(e) =>
                    update(m.key as keyof PluginConfig, e.target.checked as never)
                  }
                />
                <span className="toggle__slider" />
              </label>
            </div>
          </div>
        ))}
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
            value={config.runtime_alert_threshold}
            onChange={(e) =>
              update('runtime_alert_threshold', Number(e.target.value))
            }
          />
          <span className="form-row__desc">
            LLM 响应超过此阈值时触发告警
          </span>
        </div>
        <div className="form-row">
          <label className="form-row__label">Token 用量告警阈值</label>
          <input
            type="number"
            className="input"
            min={100}
            step={1000}
            value={config.token_alert_threshold}
            onChange={(e) =>
              update('token_alert_threshold', Number(e.target.value))
            }
          />
          <span className="form-row__desc">
            单次请求 Token 超过此值时告警
          </span>
        </div>
        <div className="form-row">
          <label className="form-row__label">缓存破坏检测轮数</label>
          <input
            type="number"
            className="input"
            min={1}
            max={20}
            value={config.cache_disruption_rounds}
            onChange={(e) =>
              update('cache_disruption_rounds', Number(e.target.value))
            }
          />
          <span className="form-row__desc">
            连续 N 轮缓存未命中视为缓存破坏
          </span>
        </div>
      </div>

      {/* 高级配置 */}
      <h2 className="section-title">存储路径</h2>
      <div className="card">
        <div className="form-row">
          <label className="form-row__label">运行时快照目录</label>
          <input
            type="text"
            className="input"
            value={config.runtime_dump_root}
            onChange={(e) => update('runtime_dump_root', e.target.value)}
          />
          <span className="form-row__desc">诊断快照的保存根目录</span>
        </div>
        <div className="form-row">
          <label className="form-row__label">日志归档目录</label>
          <input
            type="text"
            className="input"
            value={config.log_dump_root}
            onChange={(e) => update('log_dump_root', e.target.value)}
          />
          <span className="form-row__desc">错误日志与堆栈的保存目录</span>
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
