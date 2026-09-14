import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { io as client } from 'socket.io-client';
const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Server } = requireBackend('socket.io');
test('Vite forwards HTTP and websocket to the isolated loopback API', async () => {
  const backend = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: req.url }));
  });
  const sockets = new Server(backend);
  let vite;
  let socket;
  try {
    await new Promise((resolve, reject) => {
      backend.once('error', reject);
      backend.listen(3001, '127.0.0.1', resolve);
    });
    vite = await createServer({
      root: fileURLToPath(new URL('../', import.meta.url)),
      server: { host: '127.0.0.1', port: 0 },
    });
    await vite.listen();
    const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const response = await fetch(`${url}/api/isolation-smoke`);
    assert.deepEqual(await response.json(), { path: '/api/isolation-smoke' });
    socket = client(url, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket proxy timed out')), 3000);
      socket.once('connect', () => { clearTimeout(timeout); resolve(); });
      socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
    });
    assert.equal(sockets.engine.clientsCount, 1);
  } finally {
    socket?.disconnect();
    await new Promise(resolve => sockets.close(resolve));
    backend.closeAllConnections();
    await vite?.close();
  }
});
