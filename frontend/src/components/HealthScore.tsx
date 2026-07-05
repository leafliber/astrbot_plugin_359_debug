import { useEffect, useState } from 'react';
import { cssVar } from '../theme-utils';

export interface HealthScoreProps {
  /** 健康分数 0-100 */
  score: number;
  /** 评级文案，例如 优秀 / 良好 / 需关注 */
  level: string;
}

const RADIUS = 78;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 根据分数返回对应颜色（读取主题变量） */
function colorForScore(score: number): string {
  if (score >= 80) return cssVar('--color-primary', '#4CAF50');
  if (score >= 60) return cssVar('--color-warning', '#FF9800');
  return cssVar('--color-error', '#f44336');
}

/** 根据分数返回等级样式类 */
function levelClass(score: number): string {
  if (score >= 80) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

export default function HealthScore({ score, level }: HealthScoreProps) {
  const clamped = Math.max(0, Math.min(100, score || 0));
  const [offset, setOffset] = useState(CIRCUMFERENCE);
  const [displayScore, setDisplayScore] = useState(0);
  const color = colorForScore(clamped);

  // 环形进度动画
  useEffect(() => {
    const target = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;
    const timer = setTimeout(() => setOffset(target), 80);
    return () => clearTimeout(timer);
  }, [clamped]);

  // 数字递增动画（与环形同步）
  useEffect(() => {
    if (clamped <= 0) {
      setDisplayScore(0);
      return;
    }
    const duration = 1100;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(eased * clamped));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clamped]);

  return (
    <div className="health-score">
      <div className="health-score__wrapper">
        <svg className="health-score__svg" viewBox="0 0 180 180">
          <circle
            className="health-score__track"
            cx="90"
            cy="90"
            r={RADIUS}
          />
          <circle
            className="health-score__progress"
            cx="90"
            cy="90"
            r={RADIUS}
            stroke={color}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="health-score__center">
          <div className="health-score__value" style={{ color }}>
            {displayScore}
          </div>
          <div className="health-score__label">日常分</div>
        </div>
      </div>
      <span className={'health-score__level ' + levelClass(clamped)}>
        {level}
      </span>
    </div>
  );
}
