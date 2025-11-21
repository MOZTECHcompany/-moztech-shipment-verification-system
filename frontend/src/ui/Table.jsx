import React from 'react';
import { cx } from './utils';

export function Table({ className, children, ...props }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <div className="min-w-full overflow-hidden rounded-2xl border border-white/40 shadow-sm bg-white/30 backdrop-blur-md">
        <table className="min-w-full divide-y divide-gray-200/50" {...props}>{children}</table>
      </div>
    </div>
  );
}

export function THead({ children }) {
  return (
    <thead className="bg-gray-50/50 backdrop-blur-sm">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({ className, children }) {
  return (
    <th className={cx('px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide', className)}>
      {children}
    </th>
  );
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-gray-200/50 bg-transparent">{children}</tbody>;
}

export function TR({ children, className }) {
  return <tr className={cx('hover:bg-white/50 transition-colors duration-150', className)}>{children}</tr>;
}

export function TD({ className, children }) {
  return <td className={cx('px-4 py-3 text-sm text-gray-800', className)}>{children}</td>;
}

export default Table;
