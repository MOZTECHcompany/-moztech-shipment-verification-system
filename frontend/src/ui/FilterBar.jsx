import React from 'react';
import { Search } from 'lucide-react';
import { cx } from './utils';

export function FilterBar({ value, onChange, placeholder = '搜尋...', children, className }) {
  return (
    <div className={cx('glass rounded-2xl px-4 py-3 mb-6', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/50 border border-gray-200/50 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 focus:bg-white transition-all"
          />
        </div>
        {children}
      </div>
    </div>
  );
}

export default FilterBar;
