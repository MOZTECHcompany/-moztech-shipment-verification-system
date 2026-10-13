import { defineConfig, loadEnv } from 'vite';
import { resolveApiOrigin } from './config/apiOrigin.mjs';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceManifestPlugin } from './config/workspaceBuild.mjs';
import { sweetAlertLifecyclePlugin, sweetAlertPrebundlePlugin } from './config/sweetAlertLifecycle.mjs';
const projectDir = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, projectDir, 'VITE_');
  const target = resolveApiOrigin(env.VITE_API_BASE_URL, command === 'serve') || 'http://127.0.0.1:3001';
  const sourceCommit = env.VITE_SOURCE_COMMIT || 'development';
  if (sourceCommit !== 'development' && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('VITE_SOURCE_COMMIT must be a full Git commit');
  return {
  plugins: [sweetAlertLifecyclePlugin(), react(), ...(command === 'build' ? [workspaceManifestPlugin(sourceCommit)] : [])],
  optimizeDeps: { esbuildOptions: { plugins: [sweetAlertPrebundlePlugin()] } },
  define: { 'import.meta.env.VITE_SOURCE_COMMIT': JSON.stringify(sourceCommit) },
  experimental: { renderBuiltUrl: (_filename, context) => context.hostType === 'js' ? { relative: true } : { relative: false } },
  build: {
    // The SDK loads all styles into its ShadowRoot. Lazy chunks may only
    // preload JavaScript; they must not inject unscoped CSS into the ERP head.
    cssCodeSplit: false,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: { main: path.resolve(projectDir, 'index.html'), migrate: path.resolve(projectDir, 'migrate.html'), workspace: path.resolve(projectDir, 'src/workspace/index.jsx') },
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
