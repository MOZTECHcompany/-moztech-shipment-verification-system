import React from 'react';
import { cx, variants } from './utils';

const statusToVariant = {
  pending: 'warning',
  picking: 'info',
  picked: 'purple',
  packing: 'success',
  completed: 'success',
  voided: 'danger',
};

export function Badge({ variant = 'neutral', status, className, children, ...props }) {
  const v = status ? (statusToVariant[status] || 'neutral') : variant;
  const map = variants.badge.variants;
  const cls = map[v] || map.neutral;
  return (
    <span className={cx(variants.badge.base, cls, className)} {...props}>
      {children}
    </span>
  );
}

export default Badge;
