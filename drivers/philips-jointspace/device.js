"use strict";

const Homey = require('homey');
const JointspaceClient = require('../../lib/JointspaceClient.js');
const wol = require('node-wol');

const CAPABILITIES_SET_DEBOUNCE = 100;

const capabilities = {
    'onoff': 'on'
};

class PhilipsTV extends Homey.Device {

    onInit() {
        this._data = this.getData();
        this._settings = this.getSettings();

        this.client = new JointspaceClient(this.getCredentials().user);

        if (this.hasCredentials()) {
            this.client.setConfig(this.getIPAddress(), this.getAPIVersion(), this.getCredentials().user, this.getCredentials().pass);
        } else {
            this.client.setConfig(this.getIPAddress(), this.getAPIVersion());
        }

        this.log('PhilipsTV Device [' + this.getCredentials().user + '] initialized');

        this._onCapabilitiesSet = this._onCapabilitiesSet.bind(this);
        // this._getCapabilityValue = this._getCapabilityValue.bind(this);

        // this.registerMultipleCapabilityListener(this.getCapabilities(), this._onCapabilitiesSet, CAPABILITIES_SET_DEBOUNCE);

        this.registerCapabilityListener('onoff', (value) => {
            if (value === true) {
                return new Promise((resolve, reject) => {
                    this.client.setPowerState('On').then((response) => {
                        resolve(response);
                    }).catch((error) => {
                        if (error) {
                            console.log(error);
                        } else {
                            wol.wake(this.getMACAddress(), {
                                address: this.getIPAddress()
                            }, function (error) {
                                if (error) {
                                    // handle error
                                    reject(error);
                                }

                                setTimeout(() => {
                                    this.client.setPowerState('On').then(resolve).catch(reject);
                                }, 10000);
                            });
                        }
                    });
                });
            } else {
                return this.client.setPowerState('Standby');
            }
        });

        this.ready(() => {
            this.updateDevice();
        });
    }

    getMACAddress() {
        return this._data.mac;
    }

    getIPAddress() {
        return this._settings.ipAddress;
    }

    getAPIVersion() {
        return this._settings.apiVersion;
    }

    getCredentials() {
        return this._data.credentials;
    }

    hasCredentials() {
        return this._data.credentials !== null
            && (typeof this._data.credentials.user !== "undefined")
            && this._data.credentials.user !== null;
    }

    updateDevice() {
        this.client.getInfo().then((response) => {
            this.setCapabilityValue('onoff', (response.powerstate.powerstate === 'On'))
                .catch(this.error);
        }).catch(this.error);

        this.client.getAudioData().then((response) => {
            let percentileVolume = (response.current === 0 ? 0 : response.current / (response.max / 100));

            this.setCapabilityValue('volume_set', percentileVolume)
                .catch(this.error);
            this.setCapabilityValue('volume_mute', (response.muted === true))
                .catch(this.error);
        }).catch(this.error);
    }

    // _getCapabilityValue(capabilityId) {
    //     console.log('capabilityId', capabilityId);
    //
    //     switch (capabilityId) {
    //         case 'onoff':
    //             return false;
    //     }
    // }

    _onCapabilitiesSet(valueObj, optsObj) {
        console.log(valueObj, optsObj);

        // if (valueObj.)
    }

    _getDevice() {
        let device = null;

        return device;
    }

    _onSync() {
        for (let capabilityId in capabilities) {
            if (!this.hasCapability(capabilityId)) continue;

            let capabilityValue = this._getCapabilityValue(capabilityId);

            this.setCapabilityValue(capabilityId, capabilityValue)
                .catch(err => {
                    this.error(err, 'capabilityId:', capabilityId, 'convertedValue:', capabilityValue);
                });
        }
    }
}

module.exports = PhilipsTV;