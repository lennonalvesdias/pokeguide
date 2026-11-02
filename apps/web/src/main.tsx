import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import { track } from './features/diagnostics/metrics.ts';
// Fontes empacotadas com o app (e no pré-cache do PWA): nada de Google Fonts, funciona offline.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import '@fontsource/silkscreen/latin-400.css';
import './styles.css';

registerSW({ immediate: true });
track({ kind: 'app-open' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
