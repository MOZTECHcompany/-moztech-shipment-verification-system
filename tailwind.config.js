/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // --- 新增動畫設定 ---
      keyframes: {
        'flash-green': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(74, 222, 128, 0.3)' }, // 綠色閃爍
        },
        'flash-yellow': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(250, 204, 21, 0.3)' }, // 黃色閃爍
        },
      },
      animation: {
        'flash-green': 'flash-green 0.7s ease-out',
        'flash-yellow': 'flash-yellow 0.7s ease-out',
      },
    },
  },
  plugins: [],
}