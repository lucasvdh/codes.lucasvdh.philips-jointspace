'use strict'

const Homey = require('homey')
const JointspaceClient = require('../../lib/JointspaceClient')
const { PairingError } = require('../../lib/Errors')

// a list of devices, with their 'id' as key
// it is generally advisable to keep a list of
// paired and active devices in your driver's memory.
var devices = {}

function guid () {
  function s4 () {
    return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1)
  }

  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4()
}

class PhilipsJointSpaceDriver extends Homey.Driver {

  async init (device_data, callback) {
    devices_data.forEach((device_data) => {
      this.log('Philips TV - init device: ' + JSON.stringify(device_data))
      this.initDevice(device_data)
    })

    callback()
  }

  async onInit () {
    this.log('Philips Jointspace driver has been inited')

    this.registerFlowCards()

    this.jointspaceClient = new JointspaceClient()
    this.jointspaceClient.registerLogListener(this.log)
  }

  // a helper method to add a device to the devices list
  async initDevice (device_data) {
    devices[device_data.id] = {}
    devices[device_data.id].state = { onoff: true }
    devices[device_data.id].data = device_data
  }

  onPair (session) {
    let devices = []
    let pairingIp = null
    const discoveryStrategy = this.getDiscoveryStrategy()

    let pairingDevice = null

    session.setHandler('showView', async (view) => {
      this.log('showView:' + view)

      if (view === 'discover') {
        const discoveryResults = discoveryStrategy.getDiscoveryResults()
        devices = []

        await Promise.all(Object.values(discoveryResults).map(discoveryResult => {
          return this.getDeviceByDiscoveryResult(discoveryResult)
        })).then((discoveredDevices) => {
          devices = discoveredDevices.filter(item => {
            try {
              this.getDevice({ id: item.id })

              return false
            }
              // if not found (exception), the add as discoverred device
            catch (error) {}

            return true
          })
        })

        if (devices.length > 0) {
          await session.showView('list_devices')
        } else {
          await session.showView('add_by_ip')
        }
      }

      if (view === 'check_ip') {
        devices = []
        if (pairingIp === '') {
          await session.showView('add_by_ip')
          await session.emit('alert', this.homey.__('error.provide_the_ip_address'))
        }

        try {
          let device = await this.getDeviceByIp(pairingIp)
          // check if device is already added
          try {
            this.getDevice({ id: device.id })
          }
            // if not found (exception), the add as discoverred device
          catch (error) {
            devices.push(device)
          }

          if (devices.length > 0) {
            await session.showView('list_devices')
          } else {
            await session.showView('add_by_ip')
            await session.emit('alert', this.homey.__('error.device_not_found'))
          }

        } catch (error) {
          await session.showView('add_by_ip')
          await session.emit('alert', this.homey.__('error.something_went_wrong'))
        }
      }

      if (view === 'validate') {
        this.log('showView:validate')
        devices = []

        this.log('pairingDevice', pairingDevice)

        if (pairingDevice === null) {
          await session.showView('discover')
        }

        this.log('pairingDevice.settings.secure', pairingDevice.settings.secure)

        if (pairingDevice.settings.secure === true) {
          await session.showView('start_pair')
        } else {
          await session.showView('add_device')
        }
      }

      if (view === 'start_pair') {
        console.log('Philips TV - starting pair')
        this.log('start_pair')
        this.log('pairingDevice', pairingDevice)

        // Update Jointspace client with config
        this.jointspaceClient.setConfig(pairingDevice.settings.ipAddress, pairingDevice.settings.apiVersion, null, null, pairingDevice.settings.secure, pairingDevice.settings.port)

        this.jointspaceClient.getSystem()
          .then(async (response) => {
            let systemFeatures

            // Get system feature to check if http or https should be used
            if (
              typeof response.featuring !== 'undefined'
              || typeof response.featuring.systemfeatures !== 'undefined'
            ) {
              systemFeatures = response.featuring.systemfeatures
            }

            let pairingType = systemFeatures.pairing_type

            if (pairingType === 'digest_auth_pairing') {
              // We've got an android tv which required pairing
              this.jointspaceClient.startPair().then(async (response) => {
                this.log('startPair.then', response)
                if (response.error_id === 'SUCCESS') {
                  this.log('session.showView(\'authenticate\')')
                  await session.showView('authenticate')
                }
                // else {
                //   await session.showView('discover')
                //   session.emit('error', 'concurrent_pairing')
                // }
              }).catch(async (error) => {
                this.log('start pair error', error)
                //   await session.showView('discover')
                //
                //   console.log(error)
                //
                //   if (typeof error.statusCode !== 'undefined') {
                //     if (error.statusCode === 404) {
                //       session.emit('error', 'not_found')
                //     } else {
                //       session.emit('error', JSON.stringify(error))
                //     }
                //   } else if (typeof error.code !== 'undefined') {
                //     if (error.code === 'ECONNRESET') {
                //       session.emit('error', 'host_unreachable')
                //     } else {
                //       session.emit('error', JSON.stringify(error))
                //     }
                //   } else {
                //     session.emit('error', JSON.stringify(error))
                //   }
              })
            }
            // else if (pairingType === 'none') {
            //   await session.showView('add_device')
            // } else {
            //   await session.showView('discover')
            //   session.emit('error', 'unknown_pairing_type', pairingType)
            // }
          })
          .catch((error) => {
            this.log('pairing error', error)
            session.showView('discover')

            if (typeof error !== 'undefined' && error !== null) {
              if (typeof error.statusCode !== 'undefined') {
                console.log(error.statusCode)
                if (error.statusCode === 404) {
                  session.emit('error', 'not_found')
                } else {
                  session.emit('error', error)
                }
              } else if (typeof error.code !== 'undefined') {
                if (error.code === 'EHOSTUNREACH' || error.code === 'ECONNRESET') {
                  session.emit('error', 'host_unreachable')
                } else if (error.code === 'ETIMEDOUT') {
                  session.emit('error', 'host_timeout')
                } else {
                  session.emit('error', error)
                }
              }
            } else {
              session.emit('error', error)
            }
          })
      }
    })

    session.setHandler('list_devices_selection', async (devices) => {
      pairingDevice = devices.pop()
    })

    session.setHandler('getTvIp', async () => {
      this.log('getTvIp')
      return pairingIp
    })

    session.setHandler('setTvIp', async (ip) => {
      pairingIp = ip
    })

    session.setHandler('list_devices', async (data) => {
      return devices
    })

    session.setHandler('log', async (message) => {
      return this.log('session.log', message)
    })

    session.setHandler('pincode', async (code) => {
      this.log('session.setHandler(\'pincode\')', code)

      return this.jointspaceClient.confirmPair(code.join(''))
        .then(function (credentials) {
          pairingDevice.data.credentials = credentials

          session.showView('add_device')

          return true
        }).catch((error) => {
          if (typeof error.error_id !== 'undefined') {
            if (error.error_id === 'INVALID_PIN') {
              console.log('The pin "' + code + '" is not valid')
              return false
            } else if (error.error_id === 'TIMEOUT') {
              console.log('Received a pairing session timeout')
              session.showView('discover')
              session.emit('error', 'pair_timeout')
            } else {
              console.log('Unexpected pairing error 1', JSON.stringify(error))
              return false
            }
          } else {
            session.emit('error', 'An unexpected error occurred while submitting the pincode')
            console.log('Unexpected pairing error 2', JSON.stringify(error))
            return false
          }
        })
    })

    session.setHandler('getDevice', async () => {
      return pairingDevice
    })
  }

  async added (device_data) {
    // run when a device has been added by the user (as of v0.8.33)
    this.log('Philips TV - device added: ' + JSON.stringify(device_data))
    // update devices data array
    this.initDevice(device_data)
    this.log('Philips TV - add done. devices =' + JSON.stringify(devices))

    return true
  }

  async renamed (device_data, new_name) {
    // run when the user has renamed the device in Homey.
    // It is recommended to synchronize a device's name, so the user is not confused
    // when it uses another remote to control that device (e.g. the manufacturer's app).
    this.log('Philips TV - device renamed: ' + JSON.stringify(device_data) + ' new name: ' + new_name)
    // update the devices array we keep
    devices[device_data.id].data.name = new_name
  }

  async deleted (device_data) {
    // run when the user has deleted the device from Homey
    this.log('Philips TV - device deleted: ' + JSON.stringify(device_data))
    // remove from the devices array we keep
    delete devices[device_data.id]
  }

  settings (device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
    // run when the user has changed the device's settings in Homey.
    // changedKeysArr contains an array of keys that have been changed, for your convenience :)

    // always fire the callback, or the settings won't change!
    // if the settings must not be saved for whatever reason:
    // callback( "Your error message", null );
    // else callback( null, true );

    this.log('Philips TV - Settings were changed: ' + JSON.stringify(device_data) + ' / ' + JSON.stringify(newSettingsObj) + ' / old = ' + JSON.stringify(oldSettingsObj) + ' / changedKeysArr = ' + JSON.stringify(changedKeysArr))

    try {
      changedKeysArr.forEach(function (key) {
        switch (key) {
          case 'settingIPAddress':
            this.log('Philips TV - IP address changed to ' + newSettingsObj.settingIPAddress)
            // FIXME: check if IP is valid, otherwise return callback with an error
            break
          case 'settingDeviceNr':
            this.log('Philips TV - Device Nr changed to ' + newSettingsObj.settingDeviceNr)
            break
        }
      })
      callback(null, true)
    } catch (error) {
      callback(error)
    }

  }

  registerFlowCards () {
    this.log('Register flow cards')

    this.applicationOpenedTrigger = this.homey.flow.getDeviceTriggerCard('application_opened')
    this.ambiHueChangedTrigger = this.homey.flow.getDeviceTriggerCard('ambihue_changed')
    this.ambilightChangedTrigger = this.homey.flow.getDeviceTriggerCard('ambilight_changed')
    this.ambilightModeChangedTrigger = this.homey.flow.getDeviceTriggerCard('ambilight_mode_changed')
  }

  triggerApplicationOpenedTrigger (device, args = {}) {
    return this.applicationOpenedTrigger.trigger(device, args)
  }

  triggerAmbiHueChangedTrigger (device, args = {}) {
    return this.ambiHueChangedTrigger.trigger(device, args)
  }

  triggerAmbilightChangedTrigger (device, args = {}) {
    return this.ambilightChangedTrigger.trigger(device, args)
  }

  triggerAmbilightModeChangedTrigger (device, args = {}) {
    return this.ambilightModeChangedTrigger.trigger(device, args)
  }

  getDeviceByDiscoveryResult (discoveryResult) {
    if (typeof discoveryResult.headers === 'undefined'
      || discoveryResult.headers === null
      || typeof discoveryResult.headers.location === 'undefined'
      || discoveryResult.headers.location === null
    ) {
      this.log('Philips TV discovery result does not contain ssdp details location.')
    }

    return this.getDeviceByIp(discoveryResult.address, {
      id: discoveryResult.id,
      name: 'Philips TV',
      data: {
        mac: null,
        credentials: {},
      },
      settings: {
        ipAddress: discoveryResult.address,
        apiVersion: 1,
        secure: false,
        port: 1925,
      },
    })
  }

  async getDeviceByIp (ip, device = null) {
    this.log('getDeviceByIp', ip)
    if (device === null) {
      device = {
        id: ip,
        name: 'Philips TV',
        data: {
          mac: null,
          credentials: {},
        },
        settings: {
          ipAddress: ip,
          apiVersion: 1,
          secure: false,
          port: 1925,
        },
      }
    }

    let pairingClient = new JointspaceClient()

    pairingClient.setConfig(ip)

    return pairingClient
      .getSystem()
      .then(response => {
        device.name = response.name
        device.settings.apiVersion = response.api_version.Major

        let systemFeatures

        // Get system feature to check if http or https should be used
        if (
          typeof response.featuring !== 'undefined'
          || typeof response.featuring.systemfeatures !== 'undefined'
        ) {
          device.settings.secure = response.featuring.systemfeatures.secured_transport === 'true'
        }

        if (response.api_version.Major < 6) {
          device.settings.port = 1925
        } else {
          device.settings.port = 1926
        }

        return device
      })
      .catch(error => {
        console.log(error)
        throw new PairingError('Could not get device by SSDP address')
      })
  }
}

module.exports = PhilipsJointSpaceDriver

module.exports.capabilities = {
  onoff: {
    get: function (device_data, callback) {
      this.log(device_data)
      this.log('Philips TV - getting device on/off status of ' + device_data.id)

    },
    set: function (device_data, onoff, callback) {
      this.log('Philips TV - Setting device_status of ' + device_data.id + ' to ' + onoff)

    }
  }
}
