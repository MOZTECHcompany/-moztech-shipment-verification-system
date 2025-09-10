import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss' // 引入 tailwindcss
import autoprefixer from 'autoprefixer' // 引入 autoprefixer

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'https://moztech-wms-api.onrender.com',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss, // 將 tailwindcss 作為 postcss 的外掛
        autoprefixer,
      ],
    },
  },
})