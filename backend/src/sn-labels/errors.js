class LabelError extends Error {
    constructor(message, status) { super(message); this.status = status; }
}
class BadRequestException extends LabelError { constructor(message) { super(message, 400); } }
class ConflictException extends LabelError { constructor(message) { super(message, 409); } }
class NotFoundException extends LabelError { constructor(message) { super(message, 404); } }
module.exports = { BadRequestException, ConflictException, NotFoundException };
