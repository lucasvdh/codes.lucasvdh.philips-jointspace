'use strict'

const Homey = require('homey')
const {PairingError} = require('../../lib/Errors')
const {PairingStatusEnum} = require('../../lib/Enums')
const JointspaceClient = require('../../lib/Jointspace/Client');

// a list of devices, with their 'id' as key
// it is generally advisable to keep a list of
// paired and active devices in your driver's memory.
var devices = {}

function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1)
    }

    return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4()
}

class PhilipsJointSpaceDriver extends Homey.Driver {

    async init(device_data, callback) {
        devices_data.forEach((device_data) => {
            this.log('Philips TV - init device: ' + JSON.stringify(device_data))
            this.initDevice(device_data)
        })

        callback()
    }

    async onInit() {
        this.log('Philips Jointspace driver has been inited')

        this.registerFlowCards()

        this.jointspaceClient = new JointspaceClient()
        this.jointspaceClient.registerLogListener(this.log)
    }

    onPair(session) {
        let devices = []
        let existingDevices = this.getDevices()
        let pairingIp = null
        const discoveryStrategy = this.getDiscoveryStrategy()

        let pairingDevice = null

        session.setHandler('showView', async (view) => {
            this.log('Show view', view)

            if (view === 'discover') {
                const discoveryResults = discoveryStrategy.getDiscoveryResults()
                let hasDiscoveredDevices = false
                devices = []

                await Promise.all(Object.values(discoveryResults).map(discoveryResult => {
                    return this.getDeviceByDiscoveryResult(discoveryResult)
                })).then((discoveredDevices) => {
                    devices = discoveredDevices.filter(item => {
                        if (item === null) {
                            return false
                        }

                        hasDiscoveredDevices = true

                        return existingDevices.filter(existingDevice => {
                            return item.data.id === existingDevice.getData().id
                        }).length === 0
                    })
                })
                if (devices.length > 0) {
                    await session.showView('list_devices')
                } else {
                    await session.showView('add_by_ip')
                    if (hasDiscoveredDevices) {
                        await session.emit('add_by_ip_hint', this.homey.__('pair.add_by_ip.no_new_devices_hint'))
                    }
                }
            }

            if (view === 'check_ip') {
                devices = []
                if (pairingIp === null || pairingIp === '') {
                    await session.showView('add_by_ip')
                    await session.emit('alert', this.homey.__('error.provide_the_ip_address'))

                    return
                }

                try {
                    let device = await this.getDeviceByIp(pairingIp)
                        .catch()
                    // check if device is already added
                    try {
                        this.getDevice({id: device.data.id})
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
                    await this.handleSystemInfoError(error, session)
                }
            }

            if (view === 'validate') {
                devices = []

                this.log('Validating pairing device', JSON.stringify(pairingDevice))

                if (pairingDevice === null) {
                    await session.showView('discover')

                    return
                }

                if (pairingDevice.data.requiresAuthentication === true) {
                    this.log('Pairing device requires authentication')

                    await session.showView('start_pair')
                } else {
                    this.log('Pairing device does not require authentication')

                    await session.showView('validate_paired_device')
                }
            }

            if (view === 'start_pair') {
                console.log('Starting pair')

                // Update Jointspace client with config
                this.jointspaceClient.setConfig(pairingDevice.settings.ipAddress, pairingDevice.settings.apiVersion, null, null, pairingDevice.settings.secure, pairingDevice.settings.port)

                this.jointspaceClient.getSystem()
                    .then(async (response) => {
                        let pairingType = this.getPairingTypeBySystemInfo(response)

                        this.log('Pairing type: ' + pairingType);

                        if (pairingType === 'digest_auth_pairing') {
                            // We've got an android tv which required pairing
                            this.jointspaceClient.startPair().then(async (response) => {
                                this.log('Start pairing', JSON.stringify(response))

                                if (response.error_id === PairingStatusEnum.Success) {
                                    await session.showView('authenticate')
                                } else if (response.error_id === PairingStatusEnum.ConcurrentPairing) {
                                    await session.showView('discover')
                                    await session.emit('alert', this.homey.__('error.concurrent_pairing'))
                                } else {
                                    this.error('Unknown pairing response', response.error_id)
                                    await session.showView('discover')
                                    await session.emit('alert', this.homey.__('error.generic'))
                                }
                            }).catch(async (error) => {
                                this.log('Something went wrong with starting the pairing session', error)

                                if (typeof error.statusCode !== 'undefined') {
                                    if (error.statusCode === 404) {
                                        await session.showView('add_by_ip')
                                        await session.emit('alert', this.homey.__('error.pairing_not_found'))
                                    } else {
                                        await session.showView('discover')
                                        await session.emit('alert', this.homey.__('error.generic'))
                                    }
                                } else if (typeof error.code !== 'undefined') {
                                    if (error.code === 'ECONNRESET') {
                                        await session.showView('discover')
                                        await session.emit('alert', this.homey.__('error.host_unreachable'))
                                    } else {
                                        await session.showView('discover')
                                        await session.emit('alert', this.homey.__('error.generic'))
                                    }
                                } else {
                                    await session.showView('discover')
                                    await session.emit('alert', this.homey.__('error.generic'))
                                }
                            })
                        } else if (pairingType === 'none') {
                            await session.showView('validate_paired_device')
                        } else {
                            await session.showView('discover')
                            await session.emit('alert', this.homey.__('error.unknown_pairing_type', {pairingType}))
                        }
                    })
                    .catch(this.handleSystemInfoError.bind(this))
            }
        })

        session.setHandler('list_devices_selection', async (devices) => {
            this.log('list_devices_selection');
            pairingDevice = devices.pop()
        })

        session.setHandler('getTvIp', async () => {
            return pairingIp
        })

        session.setHandler('setTvIp', async (ip) => {
            pairingIp = ip
        })

        session.setHandler('list_devices', async (data) => {
            this.log('list_devices');
            return devices
        })

        session.setHandler('pincode', async (code) => {
            this.log('Pincode submitted', code.join(''))

            return this.jointspaceClient.confirmPair(code.join(''))
                .then(async (credentials) => {
                    pairingDevice.data.credentials = credentials

                    this.log('Successfully paired device, credentials: ', JSON.stringify(pairingDevice))

                    return true
                }).catch(async (error) => {
                    this.log('Something went wrong submitting the pincode', JSON.stringify(error))

                    if (typeof error.error_id !== 'undefined') {
                        if (error.error_id === PairingStatusEnum.InvalidPin) {
                            return false
                        } else if (error.error_id === PairingStatusEnum.Timeout) {
                            await session.showView('start_pair')
                            return false
                        } else {
                            await session.showView('discover')
                            await session.emit('alert', this.homey.__('error.generic'))
                        }
                    } else {
                        await session.showView('discover')
                        await session.emit('alert', this.homey.__('error.generic'))
                    }

                    return false
                });
        })

        session.setHandler('getDevice', async () => {
            console.log('session.setHandler(\'getDevice\')', pairingDevice);
            return pairingDevice
        })
    }

    async added(device_data) {
        // run when a device has been added by the user (as of v0.8.33)
        this.log('Philips TV - device added: ' + JSON.stringify(device_data))
        // update devices data array
        this.initDevice(device_data)

        this.log('Philips TV - add done. devices =' + JSON.stringify(devices))

        return true
    }

    async renamed(device_data, new_name) {
        // run when the user has renamed the device in Homey.
        // It is recommended to synchronize a device's name, so the user is not confused
        // when it uses another remote to control that device (e.g. the manufacturer's app).
        this.log('Philips TV - device renamed: ' + JSON.stringify(device_data) + ' new name: ' + new_name)
        // update the devices array we keep
        devices[device_data.id].data.name = new_name
    }

    async deleted(device_data) {
        // run when the user has deleted the device from Homey
        this.log('Philips TV - device deleted: ' + JSON.stringify(device_data))
        // remove from the devices array we keep
        delete devices[device_data.id]
    }

    async handleSystemInfoError(error, session) {
        this.log('Something went wrong getting the system info from the device or during' +
            ' pairing', JSON.stringify(error), error)

        if (typeof error !== 'undefined' && error !== null) {
            if (typeof error.statusCode !== 'undefined') {
                if (error.statusCode === 404) {
                    await session.showView('add_by_ip')
                    await session.emit('alert', this.homey.__('error.endpoint_not_found'))
                } else {
                    await session.showView('discover')
                    await session.emit('alert', this.homey.__('error.generic'))
                }
            } else if (typeof error.code !== 'undefined') {
                if (error.code === 'EHOSTUNREACH' || error.code === 'ECONNRESET') {
                    await session.showView('discover')
                    await session.emit('alert', this.homey.__('error.host_unreachable'))
                } else if (error.code === 'ETIMEDOUT') {
                    await session.showView('discover')
                    await session.emit('alert', this.homey.__('error.connection_timed_out'))
                } else {
                    await session.showView('discover')
                    await session.emit('alert', this.homey.__('error.generic'))
                }
            } else {
                await session.showView('discover')
                await session.emit('alert', this.homey.__('error.generic'))
            }
        } else {
            await session.showView('discover')
            await session.emit('alert', this.homey.__('error.generic'))
        }
    }

    settings(device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
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

    registerFlowCards() {
        this.log('Register flow cards')

        this.applicationOpenedTrigger = this.homey.flow.getDeviceTriggerCard('application_opened')
        this.ambiHueChangedTrigger = this.homey.flow.getDeviceTriggerCard('ambihue_changed')
        this.ambilightChangedTrigger = this.homey.flow.getDeviceTriggerCard('ambilight_changed')
        this.ambilightModeChangedTrigger = this.homey.flow.getDeviceTriggerCard('ambilight_mode_changed')
    }

    triggerApplicationOpenedTrigger(device, args = {}) {
        return this.applicationOpenedTrigger.trigger(device, args)
    }

    triggerAmbiHueChangedTrigger(device, args = {}) {
        return this.ambiHueChangedTrigger.trigger(device, args)
    }

    triggerAmbilightChangedTrigger(device, args = {}) {
        return this.ambilightChangedTrigger.trigger(device, args)
    }

    triggerAmbilightModeChangedTrigger(device, args = {}) {
        return this.ambilightModeChangedTrigger.trigger(device, args)
    }

    getDeviceByDiscoveryResult(discoveryResult) {
        if (typeof discoveryResult.headers === 'undefined'
            || discoveryResult.headers === null
            || typeof discoveryResult.headers.location === 'undefined'
            || discoveryResult.headers.location === null
        ) {
            this.log('Philips TV discovery result does not contain ssdp details location.')
        }

        return this.getDeviceByIp(discoveryResult.address, {
            name: 'Philips TV',
            data: {
                id: discoveryResult.id,
                mac: null,
                credentials: {},
                requiresAuthentication: false,
            },
            settings: {
                ipAddress: discoveryResult.address,
                apiVersion: 1,
                secure: false,
                port: 1925,
            },
        })
    }

    async getDeviceByIp(ip, device = null) {
        this.log('getDeviceByIp', ip)

        if (device === null) {
            device = {
                name: 'Philips TV',
                data: {
                    id: ip,
                    mac: null,
                    credentials: {},
                    requiresAuthentication: false,
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

                device.data.requiresAuthentication = this.getPairingTypeBySystemInfo(response) !== 'none'

                if (device.settings.secure === false) {
                    device.settings.port = 1925
                } else {
                    device.settings.port = 1926
                }

                return device
            })
    }

    getPairingTypeBySystemInfo(systemInfo) {
        let pairingType = 'none'

        // Get system feature to check if http or https should be used
        if (
            typeof systemInfo.featuring !== 'undefined'
            && typeof systemInfo.featuring.systemfeatures !== 'undefined'
            && typeof systemInfo.featuring.systemfeatures.pairing_type !== 'undefined'
        ) {
            pairingType = systemInfo.featuring.systemfeatures.pairing_type
        } else {
            this.log('Could not find pairing type in system features, assuming no pairing required.',
                JSON.stringify(systemInfo))
        }

        return pairingType;
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
