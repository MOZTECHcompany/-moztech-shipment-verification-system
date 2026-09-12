jest.mock('../app', () => ({
    app: { locals: {} },
    server: { listen: jest.fn(), close: jest.fn(), closeIdleConnections: jest.fn() },
    io: { disconnectSockets: jest.fn(), close: jest.fn(callback => callback()) }
}));
jest.mock('../config/database', () => ({ pool: { query: jest.fn() }, testConnection: jest.fn(), closePool: jest.fn() }));
jest.mock('../config/schemaReadiness', () => ({ assertSchemaReady: jest.fn() }));
jest.mock('../services/attachmentStorage', () => ({ getAttachmentStorage: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('child_process', () => ({ exec: jest.fn() }));
test('startup never migrates; SIGTERM waits for HTTP drain before closing DB', async () => {
    const { server, io } = require('../app');
    const db = require('../config/database');
    db.testConnection.mockResolvedValue(true);
    require('../config/schemaReadiness').assertSchemaReady.mockResolvedValue(true);
    require('../services/attachmentStorage').getAttachmentStorage.mockReturnValue({});
    io.close.mockImplementation(callback => callback());
    const handlers = {};
    jest.spyOn(process, 'on').mockImplementation((event, callback) => { handlers[event] = callback; return process; });
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    require('../server');
    await new Promise(resolve => setImmediate(resolve));
    expect(require('../config/schemaReadiness').assertSchemaReady).toHaveBeenCalledWith(db.pool);
    expect(server.listen).toHaveBeenCalledWith(expect.anything(), process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', expect.any(Function));
    expect(require('child_process').exec).not.toHaveBeenCalled();
    const shutdown = handlers.SIGTERM();
    expect(db.closePool).not.toHaveBeenCalled();
    expect(io.disconnectSockets).toHaveBeenCalledWith(true);
    server.close.mock.calls[0][0]();
    await shutdown;
    expect(db.closePool).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
});

for (const failure of ['schema', 'storage']) {
    test(`startup refuses to listen when ${failure} is not ready`, async () => {
        jest.resetModules();
        const { server } = require('../app');
        const db = require('../config/database');
        db.testConnection.mockResolvedValue(true);
        const { assertSchemaReady } = require('../config/schemaReadiness');
        const { getAttachmentStorage } = require('../services/attachmentStorage');
        assertSchemaReady.mockResolvedValue(true);
        getAttachmentStorage.mockReturnValue({});
        if (failure === 'schema') assertSchemaReady.mockRejectedValue(new Error('SCHEMA_NOT_READY'));
        else getAttachmentStorage.mockImplementation(() => { throw new Error('STORAGE_CONFIG_INVALID'); });
        jest.spyOn(process, 'on').mockImplementation(() => process);
        const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        require('../server');
        await new Promise(resolve => setImmediate(resolve));
        expect(exit).toHaveBeenCalledWith(1);
        expect(server.listen).not.toHaveBeenCalled();
    });
}
