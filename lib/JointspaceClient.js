'use strict'

const crypto = require('crypto')
const needle = require('needle')
const initialState = require('../assets/json/notifyChange.json')
const allPossibleInputs = require('../assets/json/allPossibleInputs.json')
const PairingError = require('./Errors/PairingError')
const UnauthenticatedError = require('./Errors/UnauthenticatedError')

const secretKey = 'ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA=='

class JointspaceClient {

  constructor (deviceId) {
    this.authKey = null
    this.timestamp = null
    this.timeout = null
    this.secure = null
    this.port = null
    this.debug = false
    this.host = null
    this.apiVersion = null
    this.user = null
    this.pass = null
    this.logListener = null

    if (typeof deviceId === 'undefined') {
      this.deviceId = crypto.createHash('md5')
        .update(Math.random().toString(36))
        .digest('hex')
        .substring(0, 8)
    } else {
      this.deviceId = deviceId
    }

    this.device = {
      'app_id': 'gapp.id',
      'id': this.deviceId,
      'device_name': 'Homey',
      'device_os': 'Android',
      'app_name': 'Homey Jointspace App',
      'type': 'native'
    }
  }

  /**
   * @param {String} host
   * @param {Number} apiVersion
   * @param {String} user
   * @param {String} pass
   * @param {Boolean} secure
   * @param {Number} port
   */
  setConfig (host, apiVersion = null, user = null, pass = null, secure = null, port = null) {
    this.host = host
    this.apiVersion = apiVersion
    this.setCredentials(user, pass)
    this.setSecure(secure)
    this.setPort(port)
  }

  /**
   * @param {Boolean} secure
   */
  setSecure (secure) {
    this.secure = secure
  }

  /**
   * @param {String} user
   * @param {String} pass
   */
  setCredentials (user, pass) {
    this.user = user
    this.pass = pass
  }

  /**
   * @param {Number} port
   */
  setPort (port) {
    this.port = port
  }

  registerLogListener (callback) {
    this.logListener = callback
  }

  log (...data) {
    if (this.debug && this.logListener !== null) {
      this.logListener(data)
    }
  }

  /**
   * @param {Number} apiVersion
   * @returns {String}
   */
  static getProtocolByApiVersion (apiVersion) {
    return apiVersion >= 6 ? 'https' : 'http'
  }

  /**
   * @param {Number} apiVersion
   * @returns {Number}
   */
  static getPortByApiVersion (apiVersion) {
    return apiVersion >= 6 ? 1926 : 1925
  }

  startPair () {
    let data = { 'device': this.device, 'scope': ['read', 'write', 'control'] }

    return this.post('pair/request', data).then(response => {
      this.authKey = response.auth_key
      this.timestamp = response.timestamp
      this.timeout = response.timeout
      return response
    }).catch(error => {
      this.log('startPair() error', error)
      return new PairingError(error)
    })
  }

  static createSignature (base64Key, secret) {
    return crypto.createHmac('sha256', Buffer.from(base64Key, 'base64'))
      .update(secret)
      .digest('base64')
  }

  /**
   * @param {Array<Number>} pin
   * @returns {Promise<Object>}
   */
  async confirmPair (pin) {
    let signature = JointspaceClient.createSignature(secretKey, `${this.timestamp}${pin}`),
      user = this.deviceId,
      pass = this.authKey

    this.user = user
    this.pass = pass

    let grantRequest = {
      'device': this.device,
      'auth': {
        'auth_AppId': '1',
        'pin': pin,
        'auth_timestamp': this.timestamp,
        'auth_signature': signature
      }
    }

    return this.post('pair/grant', grantRequest)
      .then((response) => {
        if (response.error_id !== 'SUCCESS') {
          this.log(response)
          throw new PairingError(response)
        }

        return { user, pass }
      })
      .catch((error) => {
        this.log(error)
        throw new PairingError(error)
      })
  }

  /**
   * @param {String} method
   * @param {String} path
   * @param {Object} data
   * @param {Number} port
   * @param {Object<String>} headers
   * @param {Boolean} secure
   * @param {Boolean} prefixPathWithApiVersion
   * @returns {Promise}
   */
  request (method, path, data = {}, headers = {}, port = null, secure = null, prefixPathWithApiVersion = true) {
    this.log('Sending request', ...arguments)

    let protocol

    if (secure === null && this.secure !== null) {
      secure = this.secure
    } else if (secure === null) {
      secure = false
    }

    // Set protocol giving function param precedence
    protocol = secure ? 'https' : 'http'
    path = (prefixPathWithApiVersion ? (this.apiVersion + '/' + path) : path)

    // Set port giving function param precedence
    if (port === null && this.port !== null) {
      port = this.port
    } else if (port === null) {
      port = JointspaceClient.getPortByApiVersion(this.apiVersion)
    }

    const requestOptions = {
      compressed: true,
      timeout: 60,
      rejectUnauthorized: false,
      json: true
    }

    if (this.isPaired()) {
      requestOptions.username = this.user
      requestOptions.password = this.pass
      requestOptions.auth = 'digest'
    }

    this.log(`${protocol}://${this.host}:${port}/${path}`)

    return needle(method.toUpperCase(), `${protocol}://${this.host}:${port}/${path}`, data, requestOptions)
      .then((response) => {
        if (response.statusCode === 401) {
          throw new UnauthenticatedError()
        }

        this.log('response', response)
        return response.body
      })
  }

  get (path, data = {}, headers = {}, port = null, secure = null, prefixPathWithApiVersion = true) {
    return this.request('GET', path, data, headers, port, secure, prefixPathWithApiVersion)
  }

  post (path, data = {}, headers = {}, port = null, secure = null, prefixPathWithApiVersion = true) {
    return this.request('POST', path, data, headers, port, secure, prefixPathWithApiVersion)
  }

  /**
   * @return {boolean} - True or False value indicating if the client contains
   */
  isPaired () {
    return !!(this.user && this.pass)
  }

  /**
   * @returns {Promise<Object>}
   */
  getSystem () {
    // It's required to access the system endpoint on port 1925 because
    // some newer models which use port 1926 still only listen
    // on port 1925 for the system endpoint
    return this.get('system', {}, {}, 1925, false, false)
  }

  getApplications () {
    return this.get('applications').then(response => response.applications);
  }

  sendKey (key) {
    return this.post('input/key', {
      key: key
    })
  }

  launchActivity (intent) {
    return this.post('activities/launch', {
      intent: intent,
    })
  }

  getChannels () {
    return this.get('channeldb/tv/channelLists/all')
  }

  getCurrentActivity () {
    return this.get('activities/current')
  }

  getSource () {
    return this.get('sources/current')
  }

  getAmbilight () {
    return this.get('ambilight/currentconfiguration')
  }

  setAmbilight (state) {
    return this.post('ambilight/power', {
      power: state ? 'On' : 'Off'
    })
  }

  setAmbilightConfiguration (ambilightConfiguration) {
    return this.post('ambilight/currentconfiguration', ambilightConfiguration)
  }

  setAmbiHue (state) {
    return this.post('HueLamp/power', {
      power: state ? 'On' : 'Off'
    })
  }

  getAmbiHue () {
    return this.get('HueLamp/power')
  }

  getAudioData () {
    return this.get('audio/volume')
  }

  /**
   * Set current volume and (un)mute
   *
   * Muting/unmuting the volume of the TV requires the current volume to be provided on some models.
   *
   * @param volume
   * @param mute
   * @returns {Promise}
   */
  setVolume (volume, mute = false) {
    return this.post('audio/volume', {
      current: volume,
      muted: mute
    })
  }

  getNetworkDevices () {
    return this.get('network/devices')
  }

  getPowerState () {
    return this.get('powerstate')
  }

  setPowerState (state) {
    return state
      ? this.post('apps/ChromeCast', {}, {}, 8008, false, false)
      : this.post('powerstate', { powerstate: 'Standby' })
  }

  getPossibleKeys () {
    return allPossibleInputs
  }

  setSetting (setting) {
    return this.post('menuitems/settings/update', setting)
  }

  notifyChange (lastState) {
    if (!lastState || !lastState.powerstate) {
      lastState = initialState
      lastState.notification.companionlauncher.device_id = this.deviceId
    } else {
      lastState = { 'notification': lastState }
    }
    return this.post('notifychange', lastState, {}, 1925, false)
  }
}

module.exports = JointspaceClient