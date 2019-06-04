'use strict';

const Homey = require('homey');
const net = require('net');
const request = require('request');
const JointspaceClient = require('../../lib/JointspaceClient');
const DigestRequest = require('../../lib/DigestRequest');
const wol = require('node-wol');

// a list of devices, with their 'id' as key
// it is generally advisable to keep a list of
// paired and active devices in your driver's memory.
var devices = {};

function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }

    return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

class PhilipsJointSpaceDriver extends Homey.Driver {

    init(device_data, callback) {
        devices_data.forEach(function (device_data) {
            Homey.log('Philips TV - init device: ' + JSON.stringify(device_data));
            this.initDevice(device_data);
        });
        callback();
    }

    onInit() {
        this.log('MyDriver has been inited');

        this.jointspaceClient = new JointspaceClient();
    }

    // a helper method to add a device to the devices list
    initDevice(device_data) {
        devices[device_data.id] = {};
        devices[device_data.id].state = {onoff: true};
        devices[device_data.id].data = device_data;
    }

    onPair(socket) {
        let pairingDevice = {
            name: 'Philips TV',
            data: {
                mac: null,
                credentials: null,
            },
            settings: {
                ipAddress: '192.168.1.50',
                apiVersion: 6,
            },
        };

        socket.on('start_pair', (data, callback) => {
            console.log("Philips TV - starting pair");

            // Set passed pair settings in variables
            pairingDevice.settings.ipAddress = data.ipAddress;
            pairingDevice.settings.apiVersion = data.apiVersion;
            pairingDevice.name = data.deviceName;

            // Update Jointspace client with config
            this.jointspaceClient.setConfig(data.ipAddress, data.apiVersion);

            // Continue to next view
            socket.showView('validate');

            this.jointspaceClient.getSystem().then(() => {
                if (pairingDevice.settings.apiVersion >= 6) {
                    this.jointspaceClient.startPair().then((response) => {
                        if (response.error_id === 'SUCCESS') {
                            socket.showView('authenticate');
                        } else {
                            socket.showView('start');
                            socket.emit('error', 'Concurrent pairing process');
                        }
                    }).catch((error) => {
                        socket.showView('start');
                        socket.emit('error', error);
                    });
                } else {
                    socket.showView('done');
                }
            }).catch((error) => {
                if (typeof error.code !== 'undefined' && error.code === 'EHOSTUNREACH') {
                    socket.showView('start');
                    socket.emit('error', 'host_unreachable');
                }
            });
        });

        socket.on('pincode', (pincode, callback) => {
            let code = pincode.join('');

            this.jointspaceClient.confirmPair(code).then((credentials) => {
                pairingDevice.data.credentials = credentials;
                callback(null, true);
            }).catch((error) => {
                console.log('error', error);
                callback(null, false);
            });
        });

        socket.on('verify_wol', (data, callback) => {
            this.jointspaceClient.getInfo().then((response) => {
                if (typeof response['network/devices'] !== "undefined") {
                    for (let i in response['network/devices']) {
                        let networkAdapter = response['network/devices'][i];

                        if (typeof networkAdapter['wake-on-lan'] !== "undefined" && networkAdapter['wake-on-lan'] === 'Enabled') {
                            pairingDevice.data.mac = networkAdapter["mac"];
                            callback(null, true);
                            break;
                        }
                    }
                } else {
                    this.error('Could not get mac address from tv device')
                }

                callback(null, false);
            }).catch((error) => {
                callback(null, true);
                this.error(error);
            });
        });

        socket.on('almost_done', (data, callback) => {
            // TODO: maybe this should be based on MAC address
            pairingDevice.data.id = DigestRequest.md5(pairingDevice.settings.ipAddress);
            console.log('device', pairingDevice);
            callback(null, pairingDevice);
        });
    }

    added(device_data, callback) {
        // run when a device has been added by the user (as of v0.8.33)
        Homey.log("Philips TV - device added: " + JSON.stringify(device_data));
        // update devices data array
        initDevice(device_data);
        Homey.log('Philips TV - add done. devices =' + JSON.stringify(devices));
        callback(null, true);
    }

    renamed(device_data, new_name) {
        // run when the user has renamed the device in Homey.
        // It is recommended to synchronize a device's name, so the user is not confused
        // when it uses another remote to control that device (e.g. the manufacturer's app).
        Homey.log("Philips TV - device renamed: " + JSON.stringify(device_data) + " new name: " + new_name);
        // update the devices array we keep
        devices[device_data.id].data.name = new_name;
    }

    deleted(device_data) {
        // run when the user has deleted the device from Homey
        Homey.log("Philips TV - device deleted: " + JSON.stringify(device_data));
        // remove from the devices array we keep
        delete devices[device_data.id];
    }

    settings(device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
        // run when the user has changed the device's settings in Homey.
        // changedKeysArr contains an array of keys that have been changed, for your convenience :)

        // always fire the callback, or the settings won't change!
        // if the settings must not be saved for whatever reason:
        // callback( "Your error message", null );
        // else callback( null, true );

        Homey.log('Philips TV - Settings were changed: ' + JSON.stringify(device_data) + ' / ' + JSON.stringify(newSettingsObj) + ' / old = ' + JSON.stringify(oldSettingsObj) + ' / changedKeysArr = ' + JSON.stringify(changedKeysArr));

        try {
            changedKeysArr.forEach(function (key) {
                switch (key) {
                    case 'settingIPAddress':
                        Homey.log('Philips TV - IP address changed to ' + newSettingsObj.settingIPAddress);
                        // FIXME: check if IP is valid, otherwise return callback with an error
                        break;
                    case 'settingDeviceNr':
                        Homey.log('Philips TV - Device Nr changed to ' + newSettingsObj.settingDeviceNr);
                        break;
                }
            })
            callback(null, true)
        } catch (error) {
            callback(error)
        }

    }

    post(url, args) {
        // post the command to the TV
        // console.log("Post to tv ", url, args)
        request({
                url: url,
                method: "POST",
                json: args
            }, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    // ready
                } else {
                    console.log(" Command to Philips TV, gives an error in response", error, response)
                    // callback (error);
                }
            }
        );
    };
}

module.exports = PhilipsJointSpaceDriver;

module.exports.capabilities = {
    onoff: {
        get: function (device_data, callback) {
            Homey.log(device_data)
            Homey.log("Philips TV - getting device on/off status of " + device_data.id);

        },
        set: function (device_data, onoff, callback) {
            Homey.log('Philips TV - Setting device_status of ' + device_data.id + ' to ' + onoff);

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
function getDeviceByData(device_data) {
    var device = devices[device_data.id];
    if (typeof device === 'undefined') {
        return new Error("invalid_device");
    } else {
        return device;
    }
}
