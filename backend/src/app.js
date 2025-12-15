// backend/src/app.js
// 模組化應用程式主文件

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require("socket.io");
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/logger');

require('dotenv').config();

// 中間件
const { authenticateToken, authorizeAdmin } = require('./middleware/auth');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

// 路由
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const taskRoutes = require('./routes/taskRoutes');
const orderRoutes = require('./routes/orderRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const commentRoutes = require('./routes/commentRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
// TODO: 添加其他路由
// const orderRoutes = require('./routes/orderRoutes');
// const taskRoutes = require('./routes/taskRoutes');
// const reportRoutes = require('./routes/reportRoutes');

// 創建應用
const app = express();
const server = http.createServer(app);

// Render / reverse proxy 環境下，讓 req.ip 取到正確的 client IP
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// 安全性：JWT_SECRET 缺失時直接拒絕啟動（避免 token 可被偽造或驗證行為異常）
if (process.env.NODE_ENV !== 'test' && !process.env.JWT_SECRET) {
    logger.error('Missing required env: JWT_SECRET');
    throw new Error('Missing required env: JWT_SECRET');
}

// =================================================================
// CORS 配置
// =================================================================
const allowlist = process.env.NODE_ENV === 'production' 
    ? [
        'https://moztech-shipment-verification-system.onrender.com',
        'https://moztech-wms-98684976641.us-west1.run.app'
      ]
    : [
        'https://moztech-shipment-verification-system.onrender.com',
        'https://moztech-wms-98684976641.us-west1.run.app',
        'http://localhost:3000',
        'http://localhost:3001'
      ];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const allowed = allowlist.indexOf(origin) !== -1;
        if (!allowed) {
            logger.debug(`CORS: origin not allowed -> ${origin}`);
        }
        return callback(null, allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

// =================================================================
// Socket.IO 配置
// =================================================================
const io = new Server(server, {
    cors: {
        origin: corsOptions.origin,
        methods: corsOptions.methods,
        credentials: corsOptions.credentials
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

io.on('connection', (socket) => {
    logger.info(`Socket.IO: 客戶端已連接 - ${socket.id}`);
    
    socket.on('disconnect', (reason) => {
        logger.info(`Socket.IO: 客戶端已斷開 - ${socket.id}, 原因: ${reason}`);
    });
});

// 將 io 附加到 app 以便在路由中使用
app.set('io', io);

// =================================================================
// 全局中間件
// =================================================================
app.use(helmet());
app.use(morgan('dev'));

app.use((req, res, next) => {
    try {
        const id = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
        req.requestId = id;
        res.setHeader('X-Request-Id', id);
    } catch (e) {
        logger.warn('requestId 產生失敗:', e);
    }
    next();
});

app.use((req, res, next) => {
    res.header('Vary', 'Origin');
    next();
});

app.use(cors(corsOptions));
app.use(express.json());

// =================================================================
// 路由註冊
// =================================================================

// 健康檢查（無需認證）
app.get('/', (req, res) => {
    res.json({
        name: 'Moztech WMS API',
        version: '7.0.0',
        status: 'running',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 認證路由（無需認證）
app.use('/api/auth', authRoutes);

// 以下路由需要認證
app.use('/api/admin/users', authenticateToken, authorizeAdmin, userRoutes);
app.use('/api/admin', authenticateToken, authorizeAdmin, adminRoutes);
app.use('/api', authenticateToken, taskRoutes);
app.use('/api', authenticateToken, orderRoutes);
app.use('/api', authenticateToken, analyticsRoutes);
app.use('/api', authenticateToken, commentRoutes);
app.use('/api', authenticateToken, maintenanceRoutes);

// TODO: 添加其他需要認證的路由
// app.use('/api/orders', authenticateToken, orderRoutes);
// app.use('/api/tasks', authenticateToken, taskRoutes);
// app.use('/api/reports', authenticateToken, reportRoutes);
// app.use('/api/operation-logs', authenticateToken, operationLogRoutes);

// =================================================================
// 錯誤處理
// =================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = { app, server, io };
