import React from 'react';
import { FixedSizeList } from 'react-window';
import { Check, ShoppingCart } from 'lucide-react';

function SerialRow({ index, style, data }) {
    const instance = data[index];
    return <div style={style} className="px-1 py-0.5">
        <div className={`h-full px-2 rounded text-xs font-mono border flex items-center justify-between ${instance.status === 'packed' ? 'bg-green-50 border-green-200 text-green-700' : instance.status === 'picked' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
            <span className="truncate" title={instance.serial_number}>{instance.serial_number}</span>
            {instance.status === 'packed' ? <Check size={12} /> : instance.status === 'picked' ? <ShoppingCart size={12} /> : null}
        </div>
    </div>;
}
export default function SerialList({ instances }) {
    return <FixedSizeList height={Math.min(192, instances.length * 32)} width="100%" itemCount={instances.length}
        itemSize={32} itemData={instances} itemKey={(index, data) => data[index].id} overscanCount={5}>
        {SerialRow}
    </FixedSizeList>;
}
