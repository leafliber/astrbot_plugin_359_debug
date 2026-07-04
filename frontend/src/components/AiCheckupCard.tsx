/**
 * AI 智能体检结论卡片
 *
 * 展示 LLM 对各模块数据综合诊断后的结构化结论：
 *  - 总评分 + 整体评价
 *  - 健康亮点
 *  - 风险项（按 high/medium/low 着色）
 *  - 总结建议
 */
import { useEffect, useRef, useState } from 'react';

/** 单个风险项 */
export interface CheckupRisk {
  module: string;
  level: 'high' | 'medium' | 'low';
  issue: string;
  advice: string;
}

/** LLM 返回的结构化结论 */
export interface CheckupConclusion {
  overall: string;
  overall_score: number;
  highlights: string[];
  risks: CheckupRisk[];
  summary: string;
}

/** /ai_checkup 端点返回的完整结果 */
export interface CheckupResult {
  timestamp: number;
  provider_id: string | null;
  provider_name: string | null;
  modules: Record<string, { score: number }>;
  conclusion: CheckupConclusion | null;
  raw_text: string | null;
  error: string | null;
}

const LEVEL_LABEL: Record<string, string> = {
  high: '高危',
  medium: '中危',
  low: '低危',
};

const LEVEL_COLOR: Record<string, string> = {
  high: 'var(--color-error)',
  medium: 'var(--color-warning)',
  low: 'var(--color-primary)',
};

function scoreColor(score: number): string {
  if (score >= 90) return 'var(--color-primary)';
  if (score >= 75) return '#43A047';
  if (score >= 60) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function scoreLabel(score: number): string {
  if (score >= 90) return '优秀';
  if (score >= 75) return '良好';
  if (score >= 60) return '需关注';
  return '需修复';
}

/** 数字递增动画 */
function useCountUp(target: number, duration = 800): number {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return val;
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}

interface Props {
  result: CheckupResult;
  onClose?: () => void;
}

export default function AiCheckupCard({ result, onClose }: Props) {
  const { conclusion, error, provider_name, timestamp } = result;

  // 错误状态
  if (error) {
    return (
      <div className="card ai-checkup ai-checkup--error anim-scale">
        <div className="ai-checkup__header">
          <span className="ai-checkup__icon">⚠️</span>
          <div>
            <div className="ai-checkup__title">AI 体检失败</div>
            <div className="ai-checkup__subtitle">{provider_name || '未知 Provider'}</div>
          </div>
          {onClose && (
            <button className="ai-checkup__close" onClick={onClose} title="关闭">
              ✕
            </button>
          )}
        </div>
        <div className="ai-checkup__error-msg">{error}</div>
      </div>
    );
  }

  // LLM 返回了文本但无法解析为 JSON
  if (!conclusion) {
    return (
      <div className="card ai-checkup anim-scale">
        <div className="ai-checkup__header">
          <span className="ai-checkup__icon">🤖</span>
          <div>
            <div className="ai-checkup__title">AI 体检结论（原文）</div>
            <div className="ai-checkup__subtitle">
              {provider_name} · {formatTime(timestamp)}
            </div>
          </div>
          {onClose && (
            <button className="ai-checkup__close" onClick={onClose} title="关闭">
              ✕
            </button>
          )}
        </div>
        <pre className="ai-checkup__raw">{result.raw_text}</pre>
      </div>
    );
  }

  const score = conclusion.overall_score ?? 0;
  const displayScore = useCountUp(score);
  const color = scoreColor(score);
  const hasRisks = conclusion.risks && conclusion.risks.length > 0;
  const hasHighlights = conclusion.highlights && conclusion.highlights.length > 0;

  return (
    <div className="card ai-checkup anim-scale">
      {/* 头部 */}
      <div className="ai-checkup__header">
        <span className="ai-checkup__icon">🩺</span>
        <div className="ai-checkup__header-text">
          <div className="ai-checkup__title">AI 智能体检结论</div>
          <div className="ai-checkup__subtitle">
            {provider_name} · {formatTime(timestamp)}
          </div>
        </div>
        {onClose && (
          <button className="ai-checkup__close" onClick={onClose} title="关闭">
            ✕
          </button>
        )}
      </div>

      {/* 总评分 */}
      <div className="ai-checkup__score-row">
        <div
          className="ai-checkup__score-circle"
          style={{ borderColor: color }}
        >
          <span className="ai-checkup__score-num" style={{ color }}>
            {displayScore}
          </span>
          <span className="ai-checkup__score-unit">分</span>
        </div>
        <div className="ai-checkup__overall">
          <div className="ai-checkup__level" style={{ color }}>
            {scoreLabel(score)}
          </div>
          <div className="ai-checkup__overall-text">{conclusion.overall}</div>
        </div>
      </div>

      {/* 亮点 */}
      {hasHighlights && (
        <div className="ai-checkup__section">
          <div className="ai-checkup__section-title ai-checkup__section-title--good">
            ✅ 健康亮点
          </div>
          <ul className="ai-checkup__list ai-checkup__list--good">
            {conclusion.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 风险 */}
      {hasRisks && (
        <div className="ai-checkup__section">
          <div className="ai-checkup__section-title ai-checkup__section-title--risk">
            ⚠️ 风险项（{conclusion.risks.length}）
          </div>
          <div className="ai-checkup__risks">
            {conclusion.risks.map((r, i) => {
              const c = LEVEL_COLOR[r.level] || LEVEL_COLOR.low;
              return (
                <div key={i} className="ai-checkup__risk" style={{ borderLeftColor: c }}>
                  <div className="ai-checkup__risk-head">
                    <span className="ai-checkup__risk-tag" style={{ background: c }}>
                      {LEVEL_LABEL[r.level] || r.level}
                    </span>
                    <span className="ai-checkup__risk-module">{r.module}</span>
                  </div>
                  <div className="ai-checkup__risk-issue">{r.issue}</div>
                  {r.advice && (
                    <div className="ai-checkup__risk-advice">
                      <span className="ai-checkup__advice-label">建议：</span>
                      {r.advice}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 总结 */}
      {conclusion.summary && (
        <div className="ai-checkup__summary">
          <span className="ai-checkup__summary-icon">💡</span>
          {conclusion.summary}
        </div>
      )}
    </div>
  );
}
