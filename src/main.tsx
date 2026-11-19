import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

registerSW({
  immediate: true,
  onNeedReload() {
    // Prevent unexpected page reloads while the user is scanning or reviewing receipts.
  },
  onNeedRefresh() {
    // Avoid reloading mid-session while the user may be capturing or scanning receipts.
  },
});

createRoot(document.getElementById('root')!).render(<App />);
