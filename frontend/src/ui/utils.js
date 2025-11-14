export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const variants = {
  button: {
    base: 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed',
    sizes: {
      sm: 'h-9 px-3 text-sm',
      md: 'h-10 px-4 text-sm',
      lg: 'h-11 px-5 text-base',
    },
    variants: {
      primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
      secondary: 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 focus-visible:ring-blue-400',
      destructive: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
      subtle: 'bg-gray-100 text-gray-800 hover:bg-gray-200 focus-visible:ring-gray-400',
      ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus-visible:ring-blue-400',
    },
  },
  badge: {
    base: 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium',
    variants: {
      neutral: 'bg-gray-100 text-gray-700',
      info: 'bg-blue-100 text-blue-700',
      success: 'bg-green-100 text-green-700',
      warning: 'bg-amber-100 text-amber-700',
      danger: 'bg-red-100 text-red-700',
    },
  },
  card: {
    base: 'bg-white rounded-2xl border border-gray-100 shadow-apple-sm',
  },
};
