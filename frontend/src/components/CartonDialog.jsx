import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function CartonDialog({ open, title, onClose, children, footer }) {
    const ref = useRef(null);
    useEffect(() => {
        const dialog = ref.current;
        if (open && !dialog.open) { dialog.showModal(); dialog.querySelector('[data-carton-autofocus]')?.focus(); }
        else if (!open && dialog.open) dialog.close();
    }, [open]);
    return <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} className="w-[min(96vw,48rem)] max-h-[90vh] overflow-y-auto rounded-xl border-0 p-0 shadow-xl backdrop:bg-slate-900/30">
        <header className="flex items-center justify-between gap-3 border-b p-4"><h2 className="font-semibold text-lg">{title}</h2><button type="button" aria-label="關閉" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button></header>
        <div className="p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t p-4">{footer}</footer>}
    </dialog>;
}
