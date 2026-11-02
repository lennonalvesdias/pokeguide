import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import { track } from './features/diagnostics/metrics.ts';
import './styles.css';

registerSW({ immediate: true });
track({ kind: 'app-open' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
