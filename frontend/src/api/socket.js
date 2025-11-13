// frontend/src/api/socket.js

import { io } from 'socket.io-client';

// 从 .env 文件中获取后端 URL，或者直接硬编码
// 注意：线上地址不能包含 /api/... 路径
const SOCKET_URL = import.meta.env.VITE_API_BASE_URL || 'https://moztech-wms-api.onrender.com';

// 创建一个 socket 实例，但先不连接
export const socket = io(SOCKET_URL, {
    autoConnect: false, // 手動控制連線時機
    reconnectionAttempts: 5,
    transports: ['websocket'],
});

// 可以在这里监听一些全局事件，方便调试
socket.on('connect', () => {
    console.log('Socket.IO 已成功连接:', socket.id);
});

socket.on('disconnect', () => {
    console.log('Socket.IO 连接已断开');
});

socket.on('connect_error', (err) => {
    console.error('Socket.IO 连接错误:', err.message);
});