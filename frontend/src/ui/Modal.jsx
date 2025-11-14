import React from 'react';
import { Button } from './Button';
import { cx } from './utils';

export function Modal({ open, onClose, title, children, footer, className }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className={cx('w-full max-w-lg bg-white rounded-2xl shadow-apple-xl border border-gray-100', className)}>
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="px-5 py-4">{children}</div>
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
            {footer || (
              <>
                <Button variant="secondary" onClick={onClose}>取消</Button>
                <Button>確認</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Modal;
