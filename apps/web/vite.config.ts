import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve('apps/web'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3001}`, ws: true } },
  },
  build: { outDir: resolve('dist/web'), emptyOutDir: true },
});