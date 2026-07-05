export interface TimelineItem {
  /** 时间戳（秒级或毫秒级，formatTs 会自动兼容） */
  ts: number | string;
  /** 级别 ERROR / WARN / INFO */
  level: string;
  /** 来源 */
  source: string;
  /** 消息内容 */
  msg: string;
  /** 所属模块 */
  module?: string;
}

export interface TimelineProps {
  items: TimelineItem[];
}

function formatTs(ts: number | string): string {
  if (!ts) return '';
  if (typeof ts === 'number') {
    // 后端 time.time() 返回秒级，new Date 需要毫秒；阈值 1e12 = 2001年
    const ms = ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString('zh-CN', { hour12: false });
  }
  return ts;
}

/** 规范化级别，便于匹配 CSS 类 */
function levelClass(level: string): string {
  const upper = (level || '').toUpperCase();
  if (['ERROR', 'FATAL', 'CRITICAL'].includes(upper)) return 'ERROR';
  if (['WARN', 'WARNING'].includes(upper)) return 'WARN';
  return 'INFO';
}

export default function Timeline({ items }: TimelineProps) {
  if (!items || items.length === 0) {
    return <div className="timeline-empty">暂无告警记录</div>;
  }

  return (
    <div className="timeline">
      {items.map((item, idx) => {
        const cls = levelClass(item.level);
        return (
          <div key={idx} className={`timeline-item level-${cls}`}>
            <div className="timeline-item__dot" />
            <div className="timeline-item__meta">
              <span className="timeline-item__source">{item.source}</span>
              {item.module && (
                <span className="timeline-item__module">{item.module}</span>
              )}
              <span>{formatTs(item.ts)}</span>
            </div>
            <div className="timeline-item__msg">{item.msg}</div>
          </div>
        );
      })}
    </div>
  );
}
