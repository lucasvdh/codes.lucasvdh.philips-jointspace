const ServiceError = require('./ServiceError');

class OfflineError extends ServiceError {
  constructor (errors) {
    super('TV is offline', errors, 'OfflineError', 503);
  }
}

module.exports = OfflineError