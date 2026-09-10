import { defineConfig, loadEnv } from 'vite';
import { resolveApiOrigin } from './config/apiOrigin.mjs';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectDir = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, projectDir, 'VITE_');
  const target = resolveApiOrigin(env.VITE_API_BASE_URL, command === 'serve') || 'http://127.0.0.1:3001';
  return {
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { main: path.resolve(projectDir, 'index.html'), migrate: path.resolve(projectDir, 'migrate.html') },
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
  server: {
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        secure: true,
        ws: true,
      },
      // socket.io (若前端以相對路徑連線)
      '/socket.io': {
        target,
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
  // ✨ 2. 新增 (或加回) resolve.alias 设定
  resolve: {
    alias: {
      // 这会设定一个别名 '@'，让它指向 'src' 目录的根部
      '@': path.resolve(projectDir, './src'),
    },
  },
};
});