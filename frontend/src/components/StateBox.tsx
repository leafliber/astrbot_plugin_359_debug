/**
 * 公共加载 / 错误状态块。
 * 用于替换各页面中重复的 loading / error JSX。
 *
 * 用法：<StateBox loading={loading} error={error} />
 * - loading 为真时展示加载中
 * - loading 为假且 error 为真时展示加载失败
 * - 其余情况返回 null（由调用方自行渲染数据块）
 */
export function StateBox({
  loading,
  error,
}: {
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <div className="state-box">
        <div className="state-box__spinner" />
        <div>加载中...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="state-box state-box--error">
        <div className="state-box__spinner" />
        <div>加载失败：{error}</div>
      </div>
    );
  }
  return null;
}
