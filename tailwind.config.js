/** @type {import('tailwindcss').Config} */
export default {
  // 【關鍵修改】使用更廣泛的掃描路徑，確保能掃描到所有子資料夾
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", 
  ],
  theme: {
    extend: {
      // 我們之前為動畫效果加入的 keyframes
      keyframes: {
        'flash-green': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(74, 222, 128, 0.3)' },
        },
        'flash-yellow': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(250, 204, 21, 0.3)' },
        },
      },
      animation: {
        'flash-green': 'flash-green 0.7s ease-out',
        'flash-yellow': 'flash-yellow 0.7s ease-out',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"), // 確保這個外掛也被加入
  ],
}