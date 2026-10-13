// frontend/src/api/socket.js

import { io } from 'socket.io-client';

import { API_ORIGIN } from './origin';

let sessionToken = null;

// App owns the connection lifecycle. The callback supplies the current token
// for every reconnect, without trusting user IDs or roles supplied by the UI.
const socketOptions = () => ({
    autoConnect: false, // 手動控制連線時機
    reconnectionAttempts: 5,
    transports: ['websocket'],
    auth: callback => callback(sessionToken ? { token: sessionToken } : {}),
});

function createTransport(origin) {
    const transport = io(origin || undefined, socketOptions());
    transport.on('connect', () => console.log('Socket.IO 已成功连接:', transport.id));
    transport.on('disconnect', reason => {
        console.log('Socket.IO 连接已断开');
        if (reason === 'io server disconnect' && sessionToken && transport === socket) transport.connect();
    });
    transport.on('connect_error', error => console.error('Socket.IO 连接错误:', error.message));
    return transport;
}

export let socket = createTransport(API_ORIGIN);

// Configure before rendering any workspace children, so their subscriptions
// all refer to the current transport. Never carry credentials to another origin.
export function initializeSocketOrigin(origin = API_ORIGIN) {
    if (origin) {
        const value = new URL(origin);
        if (!['http:', 'https:'].includes(value.protocol) || value.origin !== origin || value.username || value.password) throw new TypeError('Socket origin must be an exact HTTP(S) origin');
    }
    sessionToken = null;
    socket.disconnect();
    socket.removeAllListeners?.();
    socket = createTransport(origin);
    return socket;
}

export function setSocketSession(token) {
    const next = typeof token === 'string' && token.trim() ? token : null;
    if (next !== sessionToken) {
        socket.disconnect();
        sessionToken = next;
    }
    if (sessionToken && !socket.connected) socket.connect();
    if (!sessionToken) socket.disconnect();
}
