export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const variants = {
  button: {
    base: 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]',
    sizes: {
      sm: 'px-3.5 py-2 text-sm',
      md: 'px-4 py-2.5 text-sm',
      lg: 'px-5 py-3 text-base',
    },
    variants: {
      primary: 'bg-primary text-primary-foreground hover:brightness-95',
      secondary: 'bg-secondary text-foreground border border-gray-300 hover:bg-accent',
      destructive: 'bg-destructive text-destructive-foreground hover:brightness-95',
      subtle: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
      ghost: 'bg-transparent text-gray-700 hover:bg-gray-100',
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
