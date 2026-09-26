import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { game: 'index.html', viewer: 'viewer.html' },
    },
  },
  server: { host: true, port: 5173 },
});
