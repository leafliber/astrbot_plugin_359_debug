import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, apiPost } from '../api/bridge';

interface SettingsData {
  // 启用开关
  enable_runtime_analysis?: boolean;
  enable_token_analysis?: boolean;
  enable_context_dump?: boolean;
  enable_tool_analysis?: boolean;
  enable_log_analysis?: boolean;
  enable_plugin_analysis?: boolean;
  [key: string]: any;
}

interface Feedback {
  type: 'success' | 'error';
  message: string;
}

/** 所有 enable_* 开关的元数据 */
const TOGGLE_FIELDS: { key: string; label: string; desc: string }[] = [
  { key: 'enable_runtime_analysis', label: '运行时分析', desc: '采集请求各阶段耗时指标' },
  { key: 'enable_token_analysis', label: 'Token 统计', desc: '统计模型 Token 用量与成本' },
  { key: 'enable_context_dump', label: '上下文注入', desc: '记录 Prompt 构成与变更' },
  { key: 'enable_tool_analysis', label: '工具调用', desc: '记录工具调用频率与轨迹' },
  { key: 'enable_log_analysis', label: '错误日志', desc: '聚合错误日志与聚类分析' },
  { key: 'enable_plugin_analysis', label: '插件分析', desc: '插件安全审计与冲突检测' },
];

/** 数值阈值字段 */
const NUMBER_FIELDS: { key: string; label: string; desc: string; min: number; step: number }[] = [
  { key: 'slow_response_threshold', label: '慢响应阈值', desc: '超过该耗时(ms)标记为慢响应', min: 0, step: 100 },
  { key: 'token_alert_threshold', label: 'Token 告警阈值', desc: '单次请求 Token 超过该值告警', min: 0, step: 1000 },
  { key: 'cache_disruption_rounds', label: '缓存中断轮次', desc: '连续中断多少轮后告警', min: 1, step: 1 },
  { key: 'log_tail_lines', label: '日志尾部行数', desc: '读取日志文件的尾部行数', min: 10, step: 50 },
];

export default function Settings() {
  const { data, loading, error, refresh } = useApi<{ config: SettingsData }>('/settings');
  // 后端返回 { config: { ... } }，这里解包出实际配置
  const settings = data?.config;

  const [form, setForm] = useState<Record<string, any>>({});
  const [pricingText, setPricingText] = useState('');
  const [pricingError, setPricingError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // 数据加载后初始化表单
  useEffect(() => {
    if (settings) {
      const next: Record<string, any> = { ...settings };
      setForm(next);
      const pricing = settings.model_pricing;
      if (pricing && typeof pricing === 'object') {
        try {
          setPricingText(JSON.stringify(pricing, null, 2));
        } catch {
          setPricingText('');
        }
      } else if (typeof pricing === 'string') {
        setPricingText(pricing);
      } else {
        setPricingText('{\n  "gpt-4o": {"input": 0.005, "cached": 0.0025, "output": 0.015}\n}');
      }
    }
  }, [settings]);

  const updateField = (key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFeedback(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    setPricingError('');

    // 校验并解析 model_pricing
    let pricing: any = undefined;
    const trimmed = pricingText.trim();
    if (trimmed) {
      try {
        pricing = JSON.parse(trimmed);
      } catch (e: any) {
        setPricingError('model_pricing 不是合法的 JSON：' + (e?.message ?? String(e)));
        setSaving(false);
        return;
      }
    }

    const payload = { ...form };
    if (pricing !== undefined) {
      payload.model_pricing = pricing;
    }

    try {
      await apiPost('/settings', { config: payload });
      setFeedback({ type: 'success', message: '设置已保存' });
      refresh();
    } catch (e: any) {
      setFeedback({ type: 'error', message: '保存失败：' + (e?.message ?? String(e)) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link to="/" className="page-back">← 返回</Link>
      <h1 className="page-title">⚙ 设置</h1>
      <p className="page-subtitle">配置体检模块开关、阈值与模型定价</p>

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

      {settings && !loading && (
        <div className="settings-form">
          {/* 开关 */}
          <div className="card">
            <div className="card__title">模块开关</div>
            {TOGGLE_FIELDS.map((f) => (
              <div className="form-row" key={f.key}>
                <div className="form-row__label">
                  <span className="form-row__name">{f.label}</span>
                  <span className="form-row__desc">{f.desc}</span>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={!!form[f.key]}
                    onChange={(e) => updateField(f.key, e.target.checked)}
                  />
                  <span className="toggle__slider" />
                </label>
              </div>
            ))}
          </div>

          {/* 阈值 */}
          <div className="card">
            <div className="card__title">阈值配置</div>
            {NUMBER_FIELDS.map((f) => (
              <div className="form-row" key={f.key}>
                <div className="form-row__label">
                  <span className="form-row__name">{f.label}</span>
                  <span className="form-row__desc">{f.desc}</span>
                </div>
                <input
                  className="number-input"
                  type="number"
                  min={f.min}
                  step={f.step}
                  value={form[f.key] ?? 0}
                  onChange={(e) => updateField(f.key, Number(e.target.value))}
                />
              </div>
            ))}
          </div>

          {/* 模型定价 */}
          <div className="card">
            <div className="card__title">模型定价 (model_pricing)</div>
            <p className="form-row__desc" style={{ marginBottom: 10 }}>
              以 JSON 格式配置各模型的每千 Token 价格（单位：美元）。
            </p>
            <textarea
              className="textarea-input"
              value={pricingText}
              onChange={(e) => {
                setPricingText(e.target.value);
                setFeedback(null);
                setPricingError('');
              }}
              spellCheck={false}
            />
            {pricingError && (
              <div className="feedback error" style={{ marginTop: 10 }}>
                {pricingError}
              </div>
            )}
          </div>

          {/* 反馈与保存 */}
          {feedback && (
            <div className={'feedback ' + feedback.type}>{feedback.message}</div>
          )}
          <div>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
