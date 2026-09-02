import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev proxy mimics the production layout (same-origin /api + /open/v1).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/open/v1': 'http://127.0.0.1:8787',
      '/oauth': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
