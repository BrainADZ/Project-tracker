import { createRoot } from 'react-dom/client';
import './theme.css';
import './app.css';
import App from './App.jsx';
import { AppProvider } from './store.jsx';
import { RouterProvider } from './router.jsx';
import { setupInstallableApp } from './installApp.js';

setupInstallableApp();

async function start() {
  const root = createRoot(document.getElementById('root'));
  root.render(
    <RouterProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  );
}

start();
