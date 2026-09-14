// frontend/src/api/socket.js

import { io } from 'socket.io-client';

import { API_ORIGIN } from './origin';

let sessionToken = null;

// App owns the connection lifecycle. The callback supplies the current token
// for every reconnect, without trusting user IDs or roles supplied by the UI.
export const socket = io(API_ORIGIN || undefined, {
    autoConnect: false, // 手動控制連線時機
    reconnectionAttempts: 5,
    transports: ['websocket'],
    auth: callback => callback(sessionToken ? { token: sessionToken } : {}),
});

export function setSocketSession(token) {
    const next = typeof token === 'string' && token.trim() ? token : null;
    if (next !== sessionToken) {
        socket.disconnect();
        sessionToken = next;
    }
    if (sessionToken && !socket.connected) socket.connect();
    if (!sessionToken) socket.disconnect();
}

// 可以在这里监听一些全局事件，方便调试
socket.on('connect', () => {
    console.log('Socket.IO 已成功连接:', socket.id);
});

socket.on('disconnect', (reason) => {
    console.log('Socket.IO 连接已断开');
    // A Cloud Run revision drains sockets with a server disconnect. Socket.IO
    // does not retry that reason itself. Logout/session expiry clears the token
    // first, so only a still-authenticated session can reconnect here.
    if (reason === 'io server disconnect' && sessionToken) socket.connect();
});

socket.on('connect_error', (err) => {
    console.error('Socket.IO 连接错误:', err.message);
});
