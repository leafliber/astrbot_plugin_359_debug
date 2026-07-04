import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * 全局错误边界
 *
 * 捕获子组件渲染 / 生命周期中的运行时错误，
 * 避免页面切换时整个 React 树白屏崩溃。
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 静默吞掉已知的 recharts ResizeObserver / ref 卸载错误
    const msg = error?.message || '';
    if (
      msg.includes('not a function') ||
      msg.includes('ResizeObserver') ||
      msg.includes('current') ||
      msg.includes('unmounted')
    ) {
      // 这类错误在路由切换时偶发，重置即可恢复
      return;
    }
    // 其他错误也仅打印，不向上抛出
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="state-box state-box--error">
          <div className="state-box__spinner" />
          <div>页面渲染异常：{this.state.message}</div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
