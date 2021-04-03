"use strict";

const Homey = require('homey');
const JointspaceClient = require('../../lib/JointspaceClient.js');
const wol = require('node-wol');

const CAPABILITIES_SET_DEBOUNCE = 100;
const UPDATE_INTERVAL = 5000;

const capabilities = {
    'onoff': 'on'
};

const keyCapabilities = [
    "key_stop",
    "key_play",
    "key_pause",
    "key_play_pause",
    "key_online",
    "key_record",
    "key_rewind",
    "key_fast_forward",
    "key_toggle_ambilight",
    "key_source",
    "key_toggle_subtitles",
    "key_teletext",
    "key_viewmode",
    "key_watch_tv",
    "key_confirm",
    "key_previous",
    "key_next",
    "key_adjust",
    "key_cursor_left",
    "key_cursor_up",
    "key_cursor_right",
    "key_cursor_down",
    "key_info",
    "key_digit_1",
    "key_digit_2",
    "key_digit_3",
    "key_digit_4",
    "key_digit_5",
    "key_digit_6",
    "key_digit_7",
    "key_digit_8",
    "key_digit_9",
    "key_digit_0",
    "key_dot",
    "key_options",
    "key_back",
    "key_info",
    "key_home",
    "key_find",
    "key_red",
    "key_green",
    "key_yellow",
    "key_blue"
];

// Used for storing last volume before muting by mute button to set it back
var lastNonNullVolume = 0;

class PhilipsTV extends Homey.Device {

    onInit() {
        this._data = this.getData();
        this._settings = this.getSettings();
        this.poweringOnOrOff = false;

        this.setCapabilityValue('onoff', true);

        this.deviceLog('registering listeners');
        this.registerListeners();

        this.setSettingsVolumeSlider();

        this.deviceLog('flow card conditions temporarily disabled');
        // this.deviceLog('registering flow card conditions');
        // this.registerFlowCardConditions();

        this.ready(() => {
            this.deviceLog('initializing monitor');
            this.initMonitor(0);

            this.deviceLog('initialized');
        });
    }

    registerListeners() {
        this._onCapabilitiesSet = this._onCapabilitiesSet.bind(this);
        // this._getCapabilityValue = this._getCapabilityValue.bind(this);

        this.registerMultipleCapabilityListener(keyCapabilities, (capability, options) => {
            return this._onCapabilitiesKeySet(capability, options);
        }, CAPABILITIES_SET_DEBOUNCE);

        this.registerCapabilityListener('onoff', value => {
            return this._onCapabilityOnOffSet(value);
        });

        this.registerCapabilityListener('ambilight_onoff', value => {
            return this._onCapabilityAmbilightOnOffSet(value);
        });

        this.registerCapabilityListener('ambihue_onoff', value => {
            return this._onCapabilityAmbihueOnOffSet(value);
        });

        this.registerCapabilityListener('speaker_next', () => {
            return this.sendKey('Next');
        });

        this.registerCapabilityListener('speaker_prev', () => {
            return this.sendKey('Previous');
        });

        this.registerCapabilityListener('speaker_playing', value => {
            if (value) {
                this.sendKey('Play');
            } else {
                this.sendKey('Pause');
            }

            // Just return true, it takes way too long to wait for a response
            return true;
        });

        this.registerCapabilityListener('volume_up', value => {
            this.sendKey('VolumeUp');
            return Promise.resolve();
        });
        this.registerCapabilityListener('volume_down', value => {
            this.sendKey('VolumeDown');
            return Promise.resolve();
        });
        this.registerCapabilityListener('volume_mute', value => {
            // @todo volume has to be set - fixed value for now; later use function to get live
            // ;
            let volume = this.getCapabilityValue('volume_set');
            if (volume == 0) {
                // if volume is 0, it was already updated and use last non null value
                volume = lastNonNullVolume;
            } else if (volume < this._settings.volumeMax) {
                // if volume is >0 and <max, update last volume
                lastNonNullVolume = volume;
            } else {
                // if somehow current volume is bigger than max, set volume to half the max
                volume = (this._settings.volumeMax / 2).toFixed(0);
            }
            if (value) {
                // mute true
                this.setVolume(volume, true);
                // update volume_set cap value so it matches "mute"
                this.setCapabilityValue('volume_set', 0);
            } else {
                this.setVolume(volume, false);
            }            
            return Promise.resolve();
        });
        this.registerCapabilityListener('volume_set', value => {
            value = value.toFixed(0);
            if (value > this._settings.volumeMax) {
                value = this._settings.volumeMax;
            }
            this.setVolume(value);
            return Promise.resolve();
        });

    }

    registerFlowCardConditions() {
        let ambilightOnCondition = new Homey.FlowCardCondition('is_ambilight_on');

        ambilightOnCondition
            .register()
            .registerRunListener((args, state) => {
                return Promise.resolve(this.getCapabilityValue('ambilight_onoff'));

            })
    }

    initMonitor(initialTimeout = 10000) {
        setTimeout(() => {
            try {
                if (this.getCapabilityValue('onoff') === true) {
                    initialTimeout = 500;
                }

                new Promise((resolve, reject) => {
                    this.updateDevice(initialTimeout, resolve, reject);
                }).then(() => {
                    this.deviceLog('monitor updated device values');
                }).catch(error => {
                    console.error('Monitor failed with: ', error);
                });
            } catch (error) {
                console.error('Monitor failed with: ', error);
            }
            this.initMonitor();
        }, initialTimeout);
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

    getSecure() {
        return this._settings.secure !== false;
    }

    getPort() {
        return this._settings.port;
    }

    getCredentials() {
        return this._data.credentials;
    }

    hasCredentials() {
        return this._data.credentials !== null
            && (typeof this._data.credentials.user !== "undefined")
            && this._data.credentials.user !== null;
    }

    updateDevice(resolve, reject) {
        Promise.all([
            this.getJointspaceClient().getInfo().then((response) => {
                this.setCapabilityValue('onoff', (response.powerstate.powerstate === 'On'))
                    .catch(this.error);
            }).catch(error => {
                this.setCapabilityValue('onoff', false)
                    .catch(this.error);
            }),
            this.getJointspaceClient().getAudioData().then((response) => {
                    if (response.current > 0 && response.current <= this._settings.volumeMax) {
                        lastNonNullVolume = response.current;
                    }
                    this.setCapabilityValue('volume_set', response.current)
                        .catch(this.error);
                    this.setCapabilityValue('volume_mute', (response.muted === true))
                        .catch(this.error);
                })
            ]).then(results => {
                resolve();
        }).catch(reject);
    }

    powerOnDevice(resolve, reject, tries = 15) {
        tries--;

        if (tries < 0) {
            reject('Failed to wake up device');
            return;
        }

        this.deviceLog('powering on device, number of tries left: ' + tries);

        this.getJointspaceClient().setPowerState('On').then((response) => {
            this.deviceLog('successfully sent power on');
            resolve(response);
        }).catch((error) => {
            this.deviceLog('couldn\'t reach device, sending WOL and trying again');

            // Add callback to last WOL
            wol.wake(this.getMACAddress(), (error) => {
                if (error) {
                    // handle error
                    reject(error);
                }

                this.deviceLog('sent WOL to ' + this.getMACAddress() + ', retrying power on in 5 seconds');

                setTimeout(() => {
                    this.powerOnDevice(resolve, reject, tries);
                }, 5000);
            });
        });
    }

    // _getCapabilityValue(capabilityId) {
    //     console.log('capabilityId', capabilityId);
    //
    //     switch (capabilityId) {
    //         case 'onoff':
    //             return false;
    //     }
    // }

    _onCapabilityOnOffSet(value) {
        if (this.poweringOnOrOff === false) {
            this.poweringOnOrOff = true;
            if (value === true) {
                this.deviceLog('turning on device');

                return (new Promise((resolve, reject) => {
                    this.powerOnDevice(resolve, reject);
                })).then((response) => {
                    this.poweringOnOrOff = false;
                    this.deviceLog('Powered on', response);
                    return response;
                }).catch(() => {
                    this.poweringOnOrOff = false;
                });
            } else {
                return this.getJointspaceClient().setPowerState('Standby').then(() => {
                    this.poweringOnOrOff = false;
                }).catch(() => {
                    this.poweringOnOrOff = false;
                });
            }
        } else {
            console.log('Still powering on or off');
            return Promise.reject('Still powering on or off');
        }
    }

    _onCapabilityAmbilightOnOffSet(value) {
        let ambilight;

        if (value === true) {
            ambilight = {"styleName": "FOLLOW_VIDEO", "isExpert": false, "menuSetting": "RELAX"};
        } else {
            ambilight = {"styleName": "OFF", "isExpert": false, "menuSetting": "RELAX"};
        }

        return this.getJointspaceClient().setAmbilight(ambilight);
    }

    _onCapabilityAmbihueOnOffSet(value) {
        let setting = {
            "values": [
                {
                    "value": {
                        "Nodeid": 2131230774,
                        "Controllable": "true",
                        "Available": "true",
                        "data": {
                            "value": (value ? "true" : "false"),
                        }
                    }
                }
            ]
        };

        return this.getJointspaceClient().setSetting(setting);
    }

    _onCapabilitiesSet(valueObj, optsObj) {
        console.log(valueObj, optsObj);

        return true;
    }

    
    async setSettingsVolumeSlider() {
        // Adjust slider to max volume available on TV. Also set step to 1 not to send decimals
        this.setCapabilityOptions('volume_set', {
            min: 0,
            max: this._settings.volumeMax,
            step: 1.0
        });
    }

    async sendKey(key) {
        return await this.getJointspaceClient().sendKey(key).catch(this.error);
    }

    async setVolume(volume, mute) {
        return await this.getJointspaceClient().setVolume(volume, mute).catch(this.error);
    }

    deviceLog(message) {
        this.log('PhilipsTV Device [' + this._data.id + '] ' + message);
    }

    getJointspaceClient() {
        if (typeof this._client === "undefined" || this._client === null) {
            this._client = new JointspaceClient(this.getCredentials().user);

            if (this.hasCredentials()) {
                this._client.setConfig(
                    this.getIPAddress(),
                    this.getAPIVersion(),
                    this.getCredentials().user,
                    this.getCredentials().pass,
                    this.getSecure(),
                    this.getPort()
                );
            } else {
                this._client.setConfig(
                    this.getIPAddress(),
                    this.getAPIVersion(),
                    null,
                    null,
                    this.getSecure(),
                    this.getPort()
                );
            }
        }

        return this._client;
    }

    _onCapabilitiesKeySet(capability, options) {
        console.log(capability, options);

        if (typeof capability.key_stop !== "undefined") {
            return this.sendKey('Stop');
        } else if (typeof capability.key_play !== "undefined") {
            return this.sendKey('Play');
        } else if (typeof capability.key_back !== "undefined") {
            return this.sendKey('Back');
        } else if (typeof capability.key_play_pause !== "undefined") {
            return this.sendKey('PlayPause');
        } else if (typeof capability.key_online !== "undefined") {
            return this.sendKey('Online');
        } else if (typeof capability.key_record !== "undefined") {
            return this.sendKey('Record');
        } else if (typeof capability.key_rewind !== "undefined") {
            return this.sendKey('Rewind');
        } else if (typeof capability.key_fast_forward !== "undefined") {
            return this.sendKey('FastForward');
        } else if (typeof capability.key_toggle_ambilight !== "undefined") {
            return this.sendKey('AmbilightOnOff');
        } else if (typeof capability.key_source !== "undefined") {
            return this.sendKey('Source');
        } else if (typeof capability.key_toggle_subtitles !== "undefined") {
            return this.sendKey('SubtitlesOnOff');
        } else if (typeof capability.key_teletext !== "undefined") {
            return this.sendKey('Teletext');
        } else if (typeof capability.key_viewmode !== "undefined") {
            return this.sendKey('Viewmode');
        } else if (typeof capability.key_watch_tv !== "undefined") {
            return this.sendKey('WatchTV');
        } else if (typeof capability.key_confirm !== "undefined") {
            return this.sendKey('Confirm');
        } else if (typeof capability.key_previous !== "undefined") {
            return this.sendKey('Previous');
        } else if (typeof capability.key_next !== "undefined") {
            return this.sendKey('Next');
        } else if (typeof capability.key_adjust !== "undefined") {
            return this.sendKey('Adjust');
        } else if (typeof capability.key_cursor_left !== "undefined") {
            return this.sendKey('CursorLeft');
        } else if (typeof capability.key_cursor_up !== "undefined") {
            return this.sendKey('CursorUp');
        } else if (typeof capability.key_cursor_right !== "undefined") {
            return this.sendKey('CursorRight');
        } else if (typeof capability.key_cursor_down !== "undefined") {
            return this.sendKey('CursorDown');
        } else if (typeof capability.key_info !== "undefined") {
            return this.sendKey('Info');
        } else if (typeof capability.key_digit_0 !== "undefined") {
            return this.sendKey('Digit0');
        } else if (typeof capability.key_digit_1 !== "undefined") {
            return this.sendKey('Digit1');
        } else if (typeof capability.key_digit_2 !== "undefined") {
            return this.sendKey('Digit2');
        } else if (typeof capability.key_digit_3 !== "undefined") {
            return this.sendKey('Digit3');
        } else if (typeof capability.key_digit_4 !== "undefined") {
            return this.sendKey('Digit4');
        } else if (typeof capability.key_digit_5 !== "undefined") {
            return this.sendKey('Digit5');
        } else if (typeof capability.key_digit_6 !== "undefined") {
            return this.sendKey('Digit6');
        } else if (typeof capability.key_digit_7 !== "undefined") {
            return this.sendKey('Digit7');
        } else if (typeof capability.key_digit_8 !== "undefined") {
            return this.sendKey('Digit8');
        } else if (typeof capability.key_digit_9 !== "undefined") {
            return this.sendKey('Digit9');
        } else if (typeof capability.key_dot !== "undefined") {
            return this.sendKey('Dot');
        } else if (typeof capability.key_options !== "undefined") {
            return this.sendKey('Options');
        } else if (typeof capability.key_back !== "undefined") {
            return this.sendKey('Back');
        } else if (typeof capability.key_info !== "undefined") {
            return this.sendKey('Info');
        } else if (typeof capability.key_home !== "undefined") {
            return this.sendKey('Home');
        } else if (typeof capability.key_find !== "undefined") {
            return this.sendKey('Find');
        } else if (typeof capability.key_red !== "undefined") {
            return this.sendKey('RedColour');
        } else if (typeof capability.key_yellow !== "undefined") {
            return this.sendKey('YellowColour');
        } else if (typeof capability.key_green !== "undefined") {
            return this.sendKey('GreenColour');
        } else if (typeof capability.key_blue !== "undefined") {
            return this.sendKey('BlueColour');
        }
    }
}

module.exports = PhilipsTV;