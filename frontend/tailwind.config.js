// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    screens: {
      'xs': '475px',   // 超小屏幕
      'sm': '640px',   // 小屏幕
      'md': '768px',   // 中等屏幕
      'lg': '1024px',  // 大屏幕
      'xl': '1280px',  // 超大屏幕
      '2xl': '1536px', // 2倍超大屏幕
    },
    extend: {
      // Apple 風格字體
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', '"Noto Sans TC"', 'SF Pro Text', 'Helvetica Neue', 'sans-serif'],
      },
      // 精緻的色彩系統
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        accent: 'hsl(var(--accent))',
        'accent-foreground': 'hsl(var(--accent-foreground))',
        destructive: 'hsl(var(--destructive))',
        'destructive-foreground': 'hsl(var(--destructive-foreground))',
        // Apple 風格色彩 - 低飽和度高級感
        apple: {
          blue: '#5E9FDB',      // 降低飽和度的藍
          green: '#6BBF8D',     // 柔和的綠
          orange: '#E8A87C',    // 柔和的橙
          red: '#E57373',       // 柔和的紅
          purple: '#B39DDB',    // 柔和的紫
          pink: '#D4A5C5',      // 柔和的粉
          indigo: '#7986CB',    // 柔和的靛
          gray: {
            50: '#FAFAFA',
            100: '#F5F5F5',
            200: '#EEEEEE',
            300: '#E0E0E0',
            400: '#BDBDBD',
            500: '#9E9E9E',
            600: '#757575',
            700: '#616161',
            800: '#424242',
            900: '#212121',
          }
        }
      },
      // 圓角系統
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: `calc(var(--radius) - 4px)`,
        xl: '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      // 陰影系統 - Apple 風格，更柔和細緻
      boxShadow: {
        'apple-sm': '0 2px 8px -2px rgba(0, 0, 0, 0.1), 0 1px 4px -1px rgba(0, 0, 0, 0.06)',
        'apple': '0 4px 16px -4px rgba(0, 0, 0, 0.12), 0 2px 8px -2px rgba(0, 0, 0, 0.08)',
        'apple-lg': '0 12px 32px -8px rgba(0, 0, 0, 0.15), 0 4px 16px -4px rgba(0, 0, 0, 0.1)',
        'apple-xl': '0 24px 48px -12px rgba(0, 0, 0, 0.18), 0 8px 24px -6px rgba(0, 0, 0, 0.12)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
      },
      // 動畫系統
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-5px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(5px)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      },
      animation: {
        shake: 'shake 0.5s ease-in-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
      },
      // 毛玻璃效果
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}