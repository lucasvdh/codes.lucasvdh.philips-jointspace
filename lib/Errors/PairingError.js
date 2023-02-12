const ServiceError = require('./ServiceError');

class PairingError extends ServiceError {
  constructor (error) {
    super('An error occurred during the pairing process', error, 'PairingError', 500);

    this.error_id = error.error_id;
    this.error_text = error.error_text;
  }
}

module.exports = PairingError