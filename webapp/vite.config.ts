import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev proxy mimics the production layout (same-origin /api + /open/v1).
// Keep the browser's Host header: the worker rejects writes whose Origin
// differs from its own URL, and Vite's string shorthand would rewrite Host to
// 127.0.0.1:8787 (changeOrigin: true), blocking every POST from :5173.
const backend = { target: 'http://127.0.0.1:8787', changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/open/v1': backend,
      '/oauth': backend,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
