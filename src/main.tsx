import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installGlobalCrashReporter } from './lib/reportCrash';
import './styles/globals.css';

// root 之外的同步异常 / 未处理的 Promise 也要留痕（ErrorBoundary 只能兜渲染期）
installGlobalCrashReporter();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
