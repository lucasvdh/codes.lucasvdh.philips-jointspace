const ServiceError = require('./ServiceError');

class BadRequestError extends ServiceError{
  constructor (message ,errors = []) {
    super(message, errors, 'BadRequestError', 403);
  }
}

module.exports = BadRequestError;