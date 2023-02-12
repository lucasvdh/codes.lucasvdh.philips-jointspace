class ServiceError extends Error {
  constructor (message, errors = [], apiCode = 'ServiceError', statusCode = 500) {
    super(message);

    this.name       = this.constructor.name;
    this.errors     = errors;
    this.statusCode = statusCode;
    this.apiCode    = apiCode;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ServiceError