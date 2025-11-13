import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path'; // ✨ 1. 确保引入了 Node.js 的 'path' 模块

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
        target: 'https://moztech-wms-api.onrender.com',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      // socket.io (若前端以相對路徑連線)
      '/socket.io': {
        target: 'https://moztech-wms-api.onrender.com',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  // ✨ 2. 新增 (或加回) resolve.alias 设定
  resolve: {
    alias: {
      // 这会设定一个别名 '@'，让它指向 'src' 目录的根部
      '@': path.resolve(__dirname, './src'),
    },
  },
});