import React from 'react';
import { cx, variants } from './utils';

export function Card({ className, children, ...props }) {
  return (
    <div className={cx(variants.card.base, className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <div className={cx('px-5 py-4 border-b border-gray-100', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }) {
  return (
    <h3 className={cx('text-lg font-semibold text-gray-900', className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }) {
  return (
    <p className={cx('text-sm text-gray-500 mt-1', className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }) {
  return (
    <div className={cx('px-5 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }) {
  return (
    <div className={cx('px-5 py-4 border-t border-gray-100', className)} {...props}>
      {children}
    </div>
  );
}

export default Card;
