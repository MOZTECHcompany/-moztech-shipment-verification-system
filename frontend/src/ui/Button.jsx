import React from 'react';
import { cx, variants } from './utils';

export function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  className,
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  children,
  ...props
}) {
  return (
    <Component
      className={cx(
        variants.button.base,
        variants.button.sizes[size],
        variants.button.variants[variant],
        className
      )}
      {...props}
    >
      {LeadingIcon && (
        <LeadingIcon className={cx('mr-1.5', size === 'lg' ? 'w-5 h-5' : 'w-4 h-4')} />
      )}
      {children}
      {TrailingIcon && (
        <TrailingIcon className={cx('ml-1.5', size === 'lg' ? 'w-5 h-5' : 'w-4 h-4')} />
      )}
    </Component>
  );
}

export default Button;
