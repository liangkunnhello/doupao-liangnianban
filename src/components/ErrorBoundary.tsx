import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

const isElectronRuntime = (typeof (window as unknown as Record<string, unknown>).electronAPI !== 'undefined'
  && ((window as unknown as Record<string, { isElectron?: boolean }>).electronAPI?.isElectron === true))
  || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'))

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 捕获到未处理错误:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
          <div className="max-w-md text-center">
            <div className="text-4xl mb-4">⚠</div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
              应用遇到了一个错误
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 font-mono break-all">
              {this.state.error?.message}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                if (!isElectronRuntime) {
                  window.location.reload()
                }
              }}
              className="px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
            >
              {isElectronRuntime ? '重试' : '重新加载'}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
