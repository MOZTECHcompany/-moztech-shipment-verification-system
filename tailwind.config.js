/** @type {import('tailwindcss').Config} */
export default {
  // 【關鍵修改】使用更廣泛的掃描路徑，確保能掃描到所有子資料夾
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", 
  ],
  theme: {
    extend: {},
  },
  plugins: [
    // 確保這個外掛也被加入，如果沒有就手動加入
    require("tailwindcss-animate"), 
  ],
}