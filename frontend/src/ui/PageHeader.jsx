import React from 'react';
import { cx } from './utils';

export function PageHeader({ title, description, actions, backButton, className }) {
  return (
    <div className={cx('glass rounded-2xl px-6 py-5 mb-6', className)}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          {backButton && (
            <div className="mt-1">
              {backButton}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
            {description && (
              <p className="text-sm text-gray-500 mt-1 font-medium">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2 sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
