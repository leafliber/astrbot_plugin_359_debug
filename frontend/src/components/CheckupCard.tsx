import { Link } from 'react-router-dom';
import { cssVar } from '../theme-utils';

export type CheckupStatus = 'ok' | 'warn' | 'error';

export interface CheckupCardProps {
  /** 模块标题 */
  title: string;
  /** 模块分数 0-100 */
  score: number;
  /** 概要说明 */
  summary: string;
  /** 状态 */
  status: CheckupStatus;
  /** 详情路由路径 */
  detailRoute: string;
  /** 图标 emoji */
  icon?: string;
}

const STATUS_LABEL: Record<CheckupStatus, string> = {
  ok: '正常',
  warn: '警告',
  error: '异常',
};

function scoreColor(score: number): string {
  if (score >= 80) return cssVar('--color-primary', '#4CAF50');
  if (score >= 60) return cssVar('--color-warning', '#FF9800');
  return cssVar('--color-error', '#f44336');
}

export default function CheckupCard({
  title,
  score,
  summary,
  status,
  detailRoute,
  icon = '',
}: CheckupCardProps) {
  return (
    <Link to={detailRoute} className={`checkup-card status-${status}`}>
      <div className="checkup-card__header">
        <div className="checkup-card__icon-title">
          {icon && <span className="checkup-card__icon">{icon}</span>}
          <span className="checkup-card__title">{title}</span>
        </div>
        <span className={`status-badge ${status}`}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="checkup-card__score" style={{ color: scoreColor(score) }}>
        {Math.round(score)}
        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>
          {' '}
          / 100
        </span>
      </div>
      <div className="checkup-card__summary">{summary}</div>
      <div className="checkup-card__footer">
        <span className="checkup-card__link">查看详情 →</span>
      </div>
    </Link>
  );
}
