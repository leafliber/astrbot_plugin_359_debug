import { useEffect, useState } from 'react';

export interface HealthScoreProps {
  /** 健康分数 0-100 */
  score: number;
  /** 评级文案，例如 优秀 / 良好 / 需关注 */
  level: string;
}

const RADIUS = 78;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 根据分数返回对应颜色 */
function colorForScore(score: number): string {
  if (score >= 80) return '#4CAF50';
  if (score >= 60) return '#FF9800';
  return '#f44336';
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
  const color = colorForScore(clamped);

  // 进入时动画
  useEffect(() => {
    const target = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;
    const timer = setTimeout(() => setOffset(target), 80);
    return () => clearTimeout(timer);
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
            {Math.round(clamped)}
          </div>
          <div className="health-score__label">健康分</div>
        </div>
      </div>
      <span className={'health-score__level ' + levelClass(clamped)}>
        {level}
      </span>
    </div>
  );
}
