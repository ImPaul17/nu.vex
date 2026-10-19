import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { frontendNotices } from '../../scripts/frontend-notices.mjs';

export default defineConfig({
  plugins: [sveltekit(), frontendNotices()],
  clearScreen: false,
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false, ws: true } }
  }
});
