import React from 'react';
import { cx } from './utils';

export function Table({ className, children, ...props }) {
  return (
    <div className={cx('overflow-hidden rounded-2xl border border-gray-100 shadow-apple-sm', className)}>
      <table className="min-w-full divide-y divide-gray-100" {...props}>{children}</table>
    </div>
  );
}

export function THead({ children }) {
  return (
    <thead className="bg-gray-50/70">
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
  return <tbody className="divide-y divide-gray-100 bg-white">{children}</tbody>;
}

export function TR({ children, className }) {
  return <tr className={cx('hover:bg-gray-50/70', className)}>{children}</tr>;
}

export function TD({ className, children }) {
  return <td className={cx('px-4 py-3 text-sm text-gray-800', className)}>{children}</td>;
}

export default Table;
