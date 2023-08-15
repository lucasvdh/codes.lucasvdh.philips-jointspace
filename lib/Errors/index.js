const { ServiceError } = require('./ServiceError')
const { OfflineError } = require('./OfflineError')
const { BadRequestError } = require('./BadRequestError')
const { PairingError } = require('./PairingError')

module.exports = {
  ServiceError,
  OfflineError,
  BadRequestError,
  PairingError
}