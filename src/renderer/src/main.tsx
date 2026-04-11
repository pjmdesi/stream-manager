import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StoreProvider } from './context/StoreContext'
import { WatcherProvider } from './context/WatcherContext'
import { ConversionProvider } from './context/ConversionContext'
import './assets/index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StoreProvider>
      <WatcherProvider>
        <ConversionProvider>
          <App />
        </ConversionProvider>
      </WatcherProvider>
    </StoreProvider>
  </React.StrictMode>
)
