import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.dirname(fileURLToPath(import.meta.url));

// Install-as-app tags (manifest, icons, phone status bar). Only for the real app: the
// browser demo is a single file inside another page, where none of this applies.
const APP_HEAD = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#f3f6fb" />',
  '<link rel="icon" href="/icons/brand-icon-512.png" type="image/png" />',
  '<link rel="apple-touch-icon" href="/icons/brand-icon-512.png" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  '<meta name="apple-mobile-web-app-title" content="BrainADZ" />',
].join('\n    ');

function installableApp() {
  return { name: 'installable-app', transformIndexHtml: (html) => html.replace('</title>', `</title>\n    ${APP_HEAD}`) };
}

export default defineConfig(() => {
  return {
    root: clientDir,
    publicDir: 'public',
    plugins: [react(), installableApp()],
    define: { __DEMO__: 'false' },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: 4096,
    },
    server: { port: 8125, strictPort: true, proxy: { '/api': 'http://localhost:7125' } },
  };
});
