import React, { useState } from 'react';
import { cx } from './utils';

// 通用輸入框：支援 label、icon、錯誤訊息，與 Apple 風格聚焦樣式
export function Input({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  icon: Icon,
  error,
  className,
  autoComplete,
  onKeyDown,
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className={cx('w-full', className)}>
      {label && (
        <label className="block text-sm font-semibold text-gray-700 mb-2.5">
          {label}
        </label>
      )}
      <div className={cx(
        'relative group',
      )}>
        {Icon && (
          <Icon
            className={cx(
              'absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 transition-all duration-200',
              focused ? 'text-apple-blue scale-110' : 'text-gray-400'
            )}
          />
        )}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          className={cx(
            'relative w-full font-medium outline-none transition-all',
            'bg-white border-2 border-gray-200 rounded-xl',
            'placeholder-gray-400 text-gray-900',
            'py-4', Icon ? 'pl-12 pr-4' : 'px-4',
            focused && 'focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10',
            error && 'border-red-300 focus:border-red-400 focus:ring-red-300/30'
          )}
        />
      </div>
      {error && (
        <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}
