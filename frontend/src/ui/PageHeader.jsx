import React from 'react';
import { cx } from './utils';

export function PageHeader({ title, description, actions, className }) {
  return (
    <div className={cx('bg-white rounded-2xl border border-gray-100 shadow-apple-sm px-5 py-4 mb-4', className)}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          {description && (
            <p className="text-sm text-gray-500 mt-1">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export default PageHeader;
