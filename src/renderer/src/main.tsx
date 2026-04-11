import React, { Component } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StoreProvider } from './context/StoreContext'
import { WatcherProvider } from './context/WatcherContext'
import { ConversionProvider } from './context/ConversionContext'
import './assets/index.css'

// Top-level fallback: shown when the entire app tree crashes (e.g. a broken context provider).
// Always renders window controls so the user can close the app.
class AppErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col h-screen bg-navy-900 text-gray-200">
          <div
            className="flex items-center justify-between h-10 bg-navy-800 border-b border-white/5 px-4 shrink-0"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <span className="text-sm font-semibold text-purple-400 tracking-wide">Stream Manager</span>
            <div
              className="flex items-center gap-1"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <button
                onClick={() => window.api.windowMinimize()}
                className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
              >―</button>
              <button
                onClick={() => window.api.windowClose()}
                className="p-1.5 rounded hover:bg-red-600 text-gray-500 hover:text-white transition-colors"
              >✕</button>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center px-8">
            <p className="text-sm text-gray-300 font-medium">The app encountered an unexpected error.</p>
            <p className="text-xs text-gray-500 font-mono break-all max-w-lg">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded text-xs bg-white/10 hover:bg-white/15 text-gray-300 transition-colors"
            >
              Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <StoreProvider>
        <WatcherProvider>
          <ConversionProvider>
            <App />
          </ConversionProvider>
        </WatcherProvider>
      </StoreProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)
