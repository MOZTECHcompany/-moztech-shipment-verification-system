/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme' // 【新增】引入預設主題

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 【關鍵修改】將 Noto Sans TC 加入到預設的 font-sans 列表的最前面
      fontFamily: {
        sans: ['"Noto Sans TC"', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
}