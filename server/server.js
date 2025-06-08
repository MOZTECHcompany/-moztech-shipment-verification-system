import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001; 

// Render 會將數據儲存在 /data/logs，這樣重啟後不會消失
const LOGS_DIR = process.env.RENDER_DATA_DIR ? path.join(process.env.RENDER_DATA_DIR, 'logs') : path.join(process.cwd(), 'logs');

app.use(cors());
app.use(express.json());

const ensureLogsDirExists = async () => {
    try {
        await fs.access(LOGS_DIR);
    } catch (error) {
        console.log(`'logs' directory not found. Creating it at: ${LOGS_DIR}`);
        await fs.mkdir(LOGS_DIR, { recursive: true });
    }
};

app.get('/', (req, res) => {
    res.status(200).send('Log Server is running!');
});

app.post('/log', async (req, res) => {
    const { event, orderId, data } = req.body;
    if (!event || !orderId || !data) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const logEntry = { timestamp: new Date().toISOString(), event, data };
    const logFilePath = path.join(LOGS_DIR, `${orderId}.log`);
    const logLine = JSON.stringify(logEntry) + '\n';
    try {
        await fs.appendFile(logFilePath, logLine);
        res.status(201).json({ message: 'Log received' });
    } catch (error) {
        console.error('Failed to write log:', error);
        res.status(500).json({ error: 'Failed to write log' });
    }
});

app.get('/log/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const logFilePath = path.join(LOGS_DIR, `${orderId}.log`);
    try {
        const fileContent = await fs.readFile(logFilePath, 'utf8');
        const logs = fileContent.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line));
        res.status(200).json(logs);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(200).json([]);
        }
        console.error('Failed to read log:', error);
        res.status(500).json({ error: 'Failed to read log' });
    }
});

app.listen(PORT, () => {
    ensureLogsDirExists();
    console.log(`Log server listening on port ${PORT}`);
});