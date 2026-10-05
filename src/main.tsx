import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Pinch-zoom belongs to the chart. Stop iOS from zooming the whole page around it.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1 && !(e.target as Element).closest?.('.chart-box')) e.preventDefault();
  },
  { passive: false },
);

// The iPhone app bundles everything already; the service worker is only for the web version.
const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
if ('serviceWorker' in navigator && import.meta.env.PROD && !native) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // offline support is a bonus; the app works without it
  });
}
