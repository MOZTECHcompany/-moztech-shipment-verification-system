export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const variants = {
  button: {
    base: 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] motion-safe:active:scale-[.98] shadow-sm',
    sizes: {
      xs: 'px-2.5 py-1.5 text-xs',
      sm: 'px-3.5 py-2 text-sm',
      md: 'px-5 py-2.5 text-sm',
      lg: 'px-6 py-3 text-base',
    },
    variants: {
      primary: 'bg-primary text-white hover:bg-primary/90 shadow-primary/30 shadow-lg border border-transparent',
      secondary: 'bg-white/80 backdrop-blur-md text-gray-700 border border-gray-200/50 hover:bg-white hover:border-gray-300 shadow-sm',
      destructive: 'bg-destructive text-white hover:bg-destructive/90 shadow-destructive/30 shadow-lg',
      danger: 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/30 shadow-lg',
      success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/30 shadow-lg',
      subtle: 'bg-gray-100/50 text-gray-800 hover:bg-gray-100',
      ghost: 'bg-transparent text-gray-700 hover:bg-gray-100/50',
    },
  },
  badge: {
    base: 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium backdrop-blur-sm border shadow-sm',
    variants: {
      neutral: 'bg-gray-100/50 text-gray-700 border-gray-200/50',
      info: 'bg-blue-100/50 text-blue-700 border-blue-200/50',
      success: 'bg-green-100/50 text-green-700 border-green-200/50',
      warning: 'bg-amber-100/50 text-amber-700 border-amber-200/50',
      danger: 'bg-red-100/50 text-red-700 border-red-200/50',
      purple: 'bg-purple-100/50 text-purple-700 border-purple-200/50',
    },
  },
  card: {
    base: 'glass rounded-2xl border border-white/40 shadow-xl transition-all duration-300 hover:shadow-2xl',
  },
};
