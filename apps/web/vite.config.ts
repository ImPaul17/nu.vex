import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false, ws: true } }
  }
});
