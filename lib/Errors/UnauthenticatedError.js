const ServiceError = require('./ServiceError');

class UnauthenticatedError extends ServiceError {
  constructor () {
    super('Unauthenticated', [], 'UnauthenticatedError', 401);
  }
}

module.exports = UnauthenticatedError