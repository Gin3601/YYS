import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 顶层渲染错误兜底。
 *
 * 不修复任何错误本身，只让单个组件抛错时整个页面不变成白屏。
 * 用户看到友好提示 + 错误堆栈，可以点「重新加载」恢复。
 *
 * React 16+ 的 componentDidCatch 只能捕渲染期错误，
 * 抓不到事件回调、定时器、Promise 里的异常 —— 那些靠 onerror / unhandledrejection 监听。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] render error:', error, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <div className="boot" style={{ borderColor: 'var(--danger)' }}>
            <p><strong>页面渲染出错了</strong></p>
            <p style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {this.state.error.message}
            </p>
            <p>
              这通常说明前端代码有 bug，刷新页面可能能恢复；如果反复出现请把浏览器控制台的报错截图反馈给开发者。
            </p>
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn primary" onClick={() => location.reload()}>
                重新加载
              </button>
              <button type="button" className="btn" onClick={this.reset}>
                尝试继续
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
