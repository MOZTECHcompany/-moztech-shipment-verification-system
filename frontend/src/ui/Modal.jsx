import React from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { cx } from './utils';

export function Modal({ open, onClose, title, children, footer, className }) {
  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-all" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className={cx('w-full max-w-lg glass-panel rounded-2xl shadow-2xl transform transition-all animate-in zoom-in-95 duration-200', className)}>
          <div className="px-6 py-5 border-b border-gray-100/50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors rounded-full p-1 hover:bg-gray-100/50">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div className="px-6 py-6">{children}</div>
          <div className="px-6 py-5 border-t border-gray-100/50 flex items-center justify-end gap-3 bg-gray-50/30 rounded-b-2xl">
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

  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}

export default Modal;
