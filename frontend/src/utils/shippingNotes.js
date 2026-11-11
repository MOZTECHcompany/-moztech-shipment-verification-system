export const SHIPPING_NOTE_MARKER = 'WMS-NOTE';

// Older orders and snapshots can omit this field. Keep each nonempty source row
// as literal text, including its original line breaks and repeated content.
export function readShippingNotes(order) {
    const notes = order?.shipping_notes;
    return Array.isArray(notes) ? notes.filter(note => typeof note?.text === 'string' && note.text.trim()) : [];
}
