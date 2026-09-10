import React from 'react';
import { Button } from './Button';

export function EmptyState({ icon: Icon, title, description, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center text-center bg-white border border-gray-100 rounded-2xl py-12 shadow-apple-sm">
      {Icon && <Icon className="w-12 h-12 text-gray-300 mb-3" />}
      <h3 className="text-gray-800 font-semibold">{title}</h3>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      {action && (
        <Button className="mt-4" onClick={onAction}>{action}</Button>
      )}
    </div>
  );
}

export default EmptyState;
