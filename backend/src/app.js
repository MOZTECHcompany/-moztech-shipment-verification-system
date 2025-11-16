// backend/src/app.js
// 模組化應用程式主文件

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/logger');

// 中間件
const { authenticateToken, authorizeAdmin } = require('./middleware/auth');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

// 路由
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
// TODO: 添加其他路由
// const orderRoutes = require('./routes/orderRoutes');
// const taskRoutes = require('./routes/taskRoutes');
// const reportRoutes = require('./routes/reportRoutes');

require('dotenv').config();

// 創建應用
const app = express();
const server = http.createServer(app);

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
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/admin', authenticateToken, authorizeAdmin, adminRoutes);

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
