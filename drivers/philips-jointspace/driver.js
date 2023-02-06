'use strict'

const Homey = require('homey')
const JointspaceClient = require('../../lib/JointspaceClient')
const DigestRequest = require('../../lib/DigestRequest')
const { XMLMinifier } = require('../../lib/XMLMinifier')
const minifier = XMLMinifier()
const http = require('http.min')

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

  init (device_data, callback) {
    devices_data.forEach((device_data) => {
      Homey.log('Philips TV - init device: ' + JSON.stringify(device_data))
      this.initDevice(device_data)
    })

    callback()
  }

  onInit () {
    this.log('Philips Jointspace driver has been inited')

    this.registerFlowCards()

    this.jointspaceClient = new JointspaceClient()
  }

  // a helper method to add a device to the devices list
  initDevice (device_data) {
    devices[device_data.id] = {}
    devices[device_data.id].state = { onoff: true }
    devices[device_data.id].data = device_data
  }

  onPair (session) {
    const discoveryStrategy = this.getDiscoveryStrategy()

    let pairingDevice = null

    // let defaultDevice = {
    //   id: discoveryResult.id,
    //   name: 'Philips TV',
    //   data: {
    //     mac: null,
    //     credentials: {},
    //   },
    //   settings: {
    //     ipAddress: '192.168.1.50',
    //     apiVersion: 6,
    //     secure: false,
    //     port: 1926,
    //   },
    // }

    session.on('list_devices', (data, callback) => {
      console.log('list_devices', data, callback)

      if (pairingDevice !== null) {
        callback(null, [pairingDevice])
      } else {
        const discoveryResults = discoveryStrategy.getDiscoveryResults()

        let existingDevices = this.getDevices()

        Promise.all(Object.values(discoveryResults).map(discoveryResult => {
          return this.getDeviceByDiscoveryResult(discoveryResult)
        })).then((devices) => {
          devices = devices.filter(item => {
            return item !== null && existingDevices.filter(existingDevice => {
              return item.id === existingDevice.getData().id
            }).length === 0
          })

          if (devices.length === 0) {
            session.showView('search_device')
          } else {
            console.log('session.on(list_devices) callback', callback(null, devices))
          }
        }).catch(error => {
          console.log(error)
          callback(error)
        })
      }
    })

    session.on('select_device', (device, callback) => {
      console.log('select_device')
      console.log('is secure', device.settings.secure)
      Homey.showView('verify')

      if (device.settings.secure) {
        session.emit('start_pair', device)
        session.showView('authenticate')
      } else {
        session.showView('verify')
      }

      callback()
    })

    session.on('pincode', (code, callback) => {
      this.jointspaceClient.confirmPair(code).then((credentials) => {
        pairingDevice.data.credentials = credentials
        callback(null, true)
      }).catch((error) => {
        if (typeof error.error_id !== 'undefined') {
          if (error.error_id === 'INVALID_PIN') {
            console.log('The pin "' + code + '" is not valid')
            callback(null, false)
          } else if (error.error_id === 'TIMEOUT') {
            console.log('Received a pairing session timeout')
            session.showView('start')
            session.emit('error', 'pair_timeout')
          } else {
            console.log('Unexpected pairing error 1', JSON.stringify(error))
            callback(null, false)
          }
        } else {
          console.log('Unexpected pairing error 2', JSON.stringify(error))
          callback(null, false)
        }
      })
    })

    session.on('start_pair', (pairingDevice, callback) => {
      console.log('Philips TV - starting pair')

      // Update Jointspace _client with config
      this.jointspaceClient.setConfig(pairingDevice.settings.ipAddress, pairingDevice.settings.apiVersion, null, null, pairingDevice.settings.secure, pairingDevice.settings.port)

      // Continue to next view
      session.showView('validate')

      this.jointspaceClient.getSystem().then((response) => {
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
          this.jointspaceClient.startPair().then((response) => {
            if (response.error_id === 'SUCCESS') {
              session.showView('authenticate')
            } else {
              session.showView('start')
              session.emit('error', 'concurrent_pairing')
            }
          }).catch((error) => {
            session.showView('start')

            console.log(error)

            if (typeof error.statusCode !== 'undefined') {
              if (error.statusCode === 404) {
                session.emit('error', 'not_found')
              } else {
                session.emit('error', JSON.stringify(error))
              }
            } else if (typeof error.code !== 'undefined') {
              if (error.code === 'ECONNRESET') {
                session.emit('error', 'host_unreachable')
              } else {
                session.emit('error', JSON.stringify(error))
              }
            } else {
              session.emit('error', JSON.stringify(error))
            }
          })
        } else if (pairingType === 'none') {
          session.showView('verify')
        } else {
          session.showView('start')
          session.emit('error', 'unknown_pairing_type', pairingType)
        }
      }).catch((error) => {
        session.showView('start')

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
    })

    session.on('verify_wol', (data, callback) => {
      this.jointspaceClient.getNetworkDevices().then((networkDevices) => {
        console.log('Checking WOL, got network devices:', networkDevices)

        if (Array.isArray(networkDevices)) {
          for (let i in networkDevices) {
            let networkDevice = networkDevices[i]

            if (typeof networkDevice['wake-on-lan'] !== 'undefined' && networkDevice['wake-on-lan'] === 'Enabled') {
              pairingDevice.data.mac = networkDevice['mac']
              callback(null, true)
              break
            }
          }
        } else {
          console.log('Could not get mac address from tv', JSON.stringify(networkDevices))
          callback(null, false)
        }
      }).catch((error) => {
        callback(null, false)
        this.error(error)
      })
    })

    session.on('almost_done', (data, callback) => {
      // TODO: maybe this should be based on MAC address
      pairingDevice.data.id = DigestRequest.md5(pairingDevice.settings.ipAddress)
      console.log('device', pairingDevice)
      callback(null, pairingDevice)
    })

    session.on('get_device', (data, callback) => {
      callback(null, pairingDevice)
    })
  }

  added (device_data, callback) {
    // run when a device has been added by the user (as of v0.8.33)
    Homey.log('Philips TV - device added: ' + JSON.stringify(device_data))
    // update devices data array
    initDevice(device_data)
    Homey.log('Philips TV - add done. devices =' + JSON.stringify(devices))
    callback(null, true)
  }

  renamed (device_data, new_name) {
    // run when the user has renamed the device in Homey.
    // It is recommended to synchronize a device's name, so the user is not confused
    // when it uses another remote to control that device (e.g. the manufacturer's app).
    Homey.log('Philips TV - device renamed: ' + JSON.stringify(device_data) + ' new name: ' + new_name)
    // update the devices array we keep
    devices[device_data.id].data.name = new_name
  }

  deleted (device_data) {
    // run when the user has deleted the device from Homey
    Homey.log('Philips TV - device deleted: ' + JSON.stringify(device_data))
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

    Homey.log('Philips TV - Settings were changed: ' + JSON.stringify(device_data) + ' / ' + JSON.stringify(newSettingsObj) + ' / old = ' + JSON.stringify(oldSettingsObj) + ' / changedKeysArr = ' + JSON.stringify(changedKeysArr))

    try {
      changedKeysArr.forEach(function (key) {
        switch (key) {
          case 'settingIPAddress':
            Homey.log('Philips TV - IP address changed to ' + newSettingsObj.settingIPAddress)
            // FIXME: check if IP is valid, otherwise return callback with an error
            break
          case 'settingDeviceNr':
            Homey.log('Philips TV - Device Nr changed to ' + newSettingsObj.settingDeviceNr)
            break
        }
      })
      callback(null, true)
    } catch (error) {
      callback(error)
    }

  }

  registerFlowCards () {
    this.applicationOpenedTrigger = new Homey.FlowCardTriggerDevice('application_opened')
      .register()
    this.ambiHueChangedTrigger = new Homey.FlowCardTriggerDevice('ambihue_changed')
      .register()
    this.ambilightChangedTrigger = new Homey.FlowCardTriggerDevice('ambilight_changed')
      .register()
  }

  triggerApplicationOpenedTrigger (device, args = {}) {
    return this.triggerFlowCard(device, this.applicationOpenedTrigger, args)
  }

  triggerAmbiHueChangedTrigger (device, args = {}) {
    return this.triggerFlowCard(device, this.ambiHueChangedTrigger, args)
  }

  triggerAmbilightChangedTrigger (device, args = {}) {
    return this.triggerFlowCard(device, this.ambilightChangedTrigger, args)
  }

  triggerFlowCard (device, flowCardObject, args = {}) {
    return new Promise((resolve, reject) => {
      flowCardObject.trigger(device, args).then(resolve).catch(error => {
        console.log(error)
        reject(error)
      })
    })
  }

  getDeviceByDiscoveryResult (discoveryResult) {
    console.log(
      'ssdp',
      'Found discovery result',
      {
        discoveryResult: discoveryResult
      }
    )

    if (typeof discoveryResult.headers === 'undefined'
      || discoveryResult.headers === null
      || typeof discoveryResult.headers.location === 'undefined'
      || discoveryResult.headers.location === null
    ) {
      console.log('Philips TV discovery result does not contain ssdp details location.')
    }

    let defaultDevice = {
      id: discoveryResult.id,
      name: 'Philips TV',
      data: {
        mac: null,
        credentials: {},
      },
      settings: {
        ipAddress: '192.168.1.50',
        apiVersion: 6,
        secure: false,
        port: 1926,
      },
    }

    return this.getDeviceBySSDPAddress(discoveryResult.address, defaultDevice)
  }

  getDeviceBySSDPAddress (ssdpAddress, device) {
    let pairingClient = new JointspaceClient()

    pairingClient.setConfig(ssdpAddress)

    return new Promise((resolve, reject) => {
      pairingClient
        .getSystem()
        .then(response => {
          console.log('System response', response)

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
          }
          resolve(device)
        })
        .catch(error => {
          console.log(error)
          reject('Could not get device by SSDP address')
        })
    })
  }
}

module.exports = PhilipsJointSpaceDriver

module.exports.capabilities = {
  onoff: {
    get: function (device_data, callback) {
      Homey.log(device_data)
      Homey.log('Philips TV - getting device on/off status of ' + device_data.id)

    },
    set: function (device_data, onoff, callback) {
      Homey.log('Philips TV - Setting device_status of ' + device_data.id + ' to ' + onoff)

    }
  }
}

// end capabilities

// start flow action handlers

// Homey.manager('flow').on('action.set_channel', function (callback, args) {
//     // console.log("flow set channel", args);
//     // Set channel
//     var tempIP = args.tv.id;
//     var tempDeviceNr = args.tv.devicenr;
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/channels/current';
//     var channel = {id: args.channel.id};
//     post(url, channel);
//     callback(null, true); // we've fired successfully
// });
//
// Homey.manager('flow').on('action.set_channel.channel.autocomplete', function (callback, args) {
//     if (args.args.tv == '') return callback("Select a TV");
//     for (var device_data in devices) {
//         if (devices[device_data].data.name == args.args.tv.name) {
//             var tempIP = devices[device_data].data.id;
//             var tempDeviceNr = devices[device_data].data.devicenr;
//         }
//     }
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/channels';
//     var channels = [];
//     var data = [];
//     // Collect TV channels from, IP " + tempIP)
//     request.get({url: url}, function (error, response, body) {
//         if (!error && response.statusCode == 200) {
//             data = JSON.parse(body)
//             for (var obj in data) {
//                 // Fill aray with possible channels
//                 channels.push({id: obj, name: data[obj].name});
//             }
//             callback(null, channels);
//         } else {
//             console.log(" Command to Philips TV, gives an error in response:", error, response)
//             callback("TV is Offline");
//         }
//     });
// });
//
// Homey.manager('flow').on('action.input_key', function (callback, args) {
//     //console.log("flow input key", args);
//     var tempIP = args.tv.id;
//     var tempDeviceNr = args.tv.devicenr;
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/input/key';
//     var key = {"key": args.key.id};
//     post(url, key);
//     callback(null, true); // we've fired successfully
// });
//
// Homey.manager('flow').on('action.input_key.key.autocomplete', function (callback, args) {
//     if (args.args.tv == '') return callback("Select a TV");
//     var inputs = [];
//     var data = allPossibleInputs;
//     for (var obj in data) {
//         // Fill aray with possible inputs
//         inputs.push({id: data[obj].inputname, name: data[obj].friendlyName});
//     }
//     callback(null, inputs);
// });
//
// Homey.manager('flow').on('action.set_volume', function (callback, args) {
//     // console.log("flow set volume", args);
//     // Set Volume
//     var tempIP = args.tv.id;
//     var tempDeviceNr = args.tv.devicenr;
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/audio/volume';
//     var volume = {
//         "muted": false,
//         "current": args.volume
//     };
//     post(url, volume);
//     callback(null, true); // we've fired successfully
// });
//
// Homey.manager('flow').on('action.set_source', function (callback, args) {
//     // console.log("flow set source", args);
//     // Set Source
//     var tempIP = args.tv.id;
//     var tempDeviceNr = args.tv.devicenr;
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/sources/current';
//     var source = {id: args.source.id};
//     post(url, source);
//     callback(null, true); // we've fired successfully
// });
//
//
// Homey.manager('flow').on('action.set_source.source.autocomplete', function (callback, args) {
//     // console.log("flow select sources", args);
//     if (args.args.tv == '') return callback("Select a TV");
//     for (var device_data in devices) {
//         if (devices[device_data].data.name == args.args.tv.name) {
//             var tempIP = devices[device_data].data.id;
//             var tempDeviceNr = devices[device_data].data.devicenr;
//         }
//     }
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/sources';
//     var sources = [];
//     var data = [];
//     // Collect sources from, IP " + tempIP)
//     request.get({url: url}, function (error, response, body) {
//         if (!error && response.statusCode == 200) {
//             data = JSON.parse(body)
//             for (var obj in data) {
//                 // Fill aray with possible sources
//                 sources.push({id: obj, name: data[obj].name});
//             }
//             // console.log(sources);
//             callback(null, sources)
//         } else {
//             console.log(" Command to Philips TV, gives an error in response:", error, response)
//             callback("TV is Offline");
//         }
//     });
// });
//
// Homey.manager('flow').on('action.set_mute_true', function (callback, args) {
//     // console.log("flow set mute", args);
//     // Mute
//     var tempIP = args.tv.id;
//     var tempDeviceNr = args.tv.devicenr;
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/audio/volume';
//     var mute = {"muted": true};
//     post(url, mute);
//     callback(null, true); // we've fired successfully
// });
//
// Homey.manager('flow').on('action.set_mute_false', function (callback, args) {
//     // console.log("flow unset mute", args);
//     // UnMute
//     var tempIP = args.tv.id;
//     var tempDeviceNr = args.tv.devicenr;
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/audio/volume'
//     var mute = {"muted": false};
//     post(url, mute);
//     callback(null, true); // we've fired successfully
// });
//
// Homey.manager('flow').on('action.standby', function (callback, args) {
//     // console.log("flow set standby", args);
//     // Standby
//     var tempIP = args.tv.id;
//     var tempDeviceNr = args.tv.devicenr;
//     var url = 'http://' + tempIP + ':1925/' + tempDeviceNr + '/input/key'
//     var key = {"key": "Standby"};
//     post(url, key);
//     callback(null, true); // we've fired successfully
// });

// a helper method to get a device from the devices list by it's device_data object
function getDeviceByData (device_data) {
  var device = devices[device_data.id]
  if (typeof device === 'undefined') {
    return new Error('invalid_device')
  } else {
    return device
  }
}
