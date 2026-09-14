const logger = require('./logger');

// Transactional events must never advertise data that can still roll back.
function deferredEvents(io) {
    const events = [];
    return {
        emit: (name, payload) => events.push([name, payload]),
        publish: () => {
            for (const [name, payload] of events) {
                try { io?.emit(name, payload); }
                catch (error) { logger.warn('已提交作業的即時通知發送失敗:', { event: name, message: error.message }); }
            }
        }
    };
}

module.exports = { deferredEvents };
