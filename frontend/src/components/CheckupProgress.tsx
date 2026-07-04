/**
 * AI 智能体检 · 进度动画组件
 *
 * 体检进行时展示两阶段动效：
 *  1. 采集阶段（collecting）：6 个模块依次点亮 ✓
 *  2. 诊断阶段（analyzing）：AI 综合诊断的脉冲波纹动画
 */
interface ProgressModule {
  key: string;
  name: string;
  icon: string;
}

const PROGRESS_MODULES: ProgressModule[] = [
  { key: 'runtime', name: '运行时', icon: '⏱' },
  { key: 'token', name: 'Token', icon: '🪙' },
  { key: 'context', name: '上下文', icon: '📝' },
  { key: 'tool', name: '工具', icon: '🔧' },
  { key: 'log', name: '日志', icon: '📋' },
  { key: 'plugin', name: '插件', icon: '🧩' },
];

export type CheckupPhase = 'collecting' | 'analyzing';

interface Props {
  /** 当前阶段 */
  phase: CheckupPhase;
  /** 已采集完成的模块数量（0~6） */
  doneCount: number;
}

export default function CheckupProgress({ phase, doneCount }: Props) {
  const isAnalyzing = phase === 'analyzing';

  return (
    <div className="checkup-progress anim-scale">
      {/* 阶段标题 */}
      <div className="checkup-progress__title">
        {isAnalyzing ? (
          <>
            <span className="checkup-progress__brain">🧠</span>
            <span>AI 综合诊断中</span>
            <span className="checkup-progress__dots">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </span>
          </>
        ) : (
          <>
            <span className="checkup-progress__scan">🔍</span>
            <span>正在采集模块数据</span>
          </>
        )}
      </div>

      {/* 模块进度条 */}
      <div className="checkup-progress__modules">
        {PROGRESS_MODULES.map((m, i) => {
          const done = i < doneCount;
          const active = !done && i === doneCount && !isAnalyzing;
          const pending = !done && !active;
          return (
            <div
              key={m.key}
              className={
                'checkup-module ' +
                (done ? 'is-done' : active ? 'is-active' : 'is-pending')
              }
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="checkup-module__icon">
                {done ? '✓' : m.icon}
              </div>
              <div className="checkup-module__name">{m.name}</div>
              {active && <div className="checkup-module__pulse" />}
            </div>
          );
        })}
      </div>

      {/* AI 诊断波纹（analyzing 阶段） */}
      {isAnalyzing && (
        <div className="checkup-progress__waves">
          <div className="wave" />
          <div className="wave" />
          <div className="wave" />
        </div>
      )}

      {/* 进度条 */}
      <div className="checkup-progress__bar">
        <div
          className="checkup-progress__bar-fill"
          style={{
            width: isAnalyzing ? '100%' : `${(doneCount / 6) * 100}%`,
          }}
        />
      </div>
      <div className="checkup-progress__hint">
        {isAnalyzing
          ? '正在调用 LLM 对 6 个模块的数据进行综合分析…'
          : `已采集 ${doneCount} / 6 个模块`}
      </div>
    </div>
  );
}
