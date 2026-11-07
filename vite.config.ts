import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The web UI lives in web/ and is served by the API server on :8000 in production.
// `npm run dev` runs vite on :5173 and proxies /api + /media to :8000.
export default defineConfig({
  root: r('./web'),
  plugins: [react()],
  resolve: { alias: { '@shared': r('./shared'), '@video': r('./video') } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000', '/media': 'http://localhost:8000' },
  },
  build: { outDir: r('./dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
