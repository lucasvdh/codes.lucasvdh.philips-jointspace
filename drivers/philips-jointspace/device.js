"use strict";

const Homey = require('homey');
const JointspaceClient = require('../../lib/JointspaceClient.js');
const wol = require('wol');

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

class PhilipsTV extends Homey.Device {

    onInit() {
        this._data = this.getData();
        this._settings = this.getSettings();
        this._driver = this.getDriver();
        this._applications = null;

        this.fixCapabilities();

		// Try getting device status for three seconds, otherwise, consider it off
		let initStateTimeout = setTimeout(this.setCapabilityValue.bind(this, 'onoff', false), 3000);
		this.getJointspaceClient().getPowerState().then((ps) => {
			clearTimeout(initStateTimeout);
			this.setCapabilityValue('onoff', ps.powerstate === 'On');	
		}).catch(error => {
			this.setCapabilityValue('onoff', false);
		});

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

	onDeleted() {
		clearTimeout(this.monitorTimeout);
	}

    fixCapabilities() {
        let newCapabilities = [
            'current_application',
        ];

        for (let i in newCapabilities) {
            let newCapability = newCapabilities[i];

            if (!this.hasCapability(newCapability)) {
                this.addCapability(newCapability);
            }
        }
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

            // Just resolve, it takes way too long to wait for a response
            return Promise.resolve();
        });

        this.registerCapabilityListener('volume_up', value => {
            return this.sendKey('VolumeUp');
        });
        this.registerCapabilityListener('volume_down', value => {
            return this.sendKey('VolumeDown');
        });
        this.registerCapabilityListener('volume_mute', value => {
            // Get the current volume of the TV and default to half of max volume
            let currentVolume = this.getCapabilityValue('volume_set') || Math.round(this._settings.volumeMax / 2);

            return this.getJointspaceClient().setVolume(currentVolume, value);
        });
        this.registerCapabilityListener('volume_set', value => {
            value = value.toFixed(0);
            if (value > this._settings.volumeMax) {
                value = this._settings.volumeMax;
            }
            return this.setVolume(value);
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
        this.monitorTimeout = setTimeout(() => {
            try {
                new Promise(((resolve, reject) => this.updateDevice(resolve, reject)))
                    .then(() => {
                        this.deviceLog('monitor updated device values');
                    })
                    .catch(error => {
                        console.error('Monitor failed with: ', error);
                    })
                    .finally(() => {
                        this.initMonitor();
                    });
            } catch (error) {
                console.error('Monitor failed completely', error);
                this.initMonitor();
            }
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

    getApplications() {
        return new Promise((resolve, reject) => {
            if (this._applications === null) {
                this.getJointspaceClient().getApplications().then(response => {
                    return response.applications.map(application => {
                        return {
                            "id": application.id,
                            "name": application.label,
                            "intent": application.intent
                        }
                    });
                }).catch(reject).then(applications => {
                    this._applications = applications;

                    resolve(applications);
                });
            } else {
                resolve(this._applications);
            }
        });
    }

    openApplication(application) {
        return this.getJointspaceClient().launchActivity(application.intent).then(() => {
            return this._driver.triggerApplicationOpenedTrigger(this, {
                app: application.name
            }).catch(this.error);
        })
    }

    sendGoogleAssistantSearch(query) {
        let searchIntent = {
            "extras": {"query": query},
            "action": "Intent {  act=android.intent.action.ASSIST cmp=com.google.android.katniss/com.google.android.apps.tvsearch.app.launch.trampoline.SearchActivityTrampoline flg=0x10200000 }",
            "component": {
                "packageName": "com.google.android.katniss",
                "className": "com.google.android.apps.tvsearch.app.launch.trampoline.SearchActivityTrampoline"
            }
        };

        return this.getJointspaceClient().launchActivity(searchIntent);
    }

    setAmbiHue(state) {
        return this.getJointspaceClient().setAmbiHue(state).then(() => {
            return this._driver.triggerAmbiHueChangedTrigger(this, {
                enabled: state
            }).catch(this.error);
        })
    }

    setAmbilight(state) {
        let ambilight;

        if (state === true) {
            ambilight = {"styleName": "FOLLOW_VIDEO", "isExpert": false, "menuSetting": "RELAX"};
        } else {
            ambilight = {"styleName": "OFF", "isExpert": false, "menuSetting": "RELAX"};
        }

        return this.getJointspaceClient().setAmbilight(ambilight).then(() => {
            return this._driver.triggerAmbilightChangedTrigger(this, {
                enabled: state
            }).catch(this.error);
        })
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

                if (typeof response['activities/current'].component !== "undefined") {
                    let activeComponent = response['activities/current'].component;

                    this.getApplications().then(applications => {
                        let currentApplication = applications.filter(
                            application =>
                                application.intent.component.packageName === activeComponent.packageName
                                && application.intent.component.className === activeComponent.className
                        ).pop();

                        let currentDeviceApplication = this.getCapabilityValue('current_application');

                        if (typeof currentApplication !== "undefined") {
                            this.setCapabilityValue('current_application', currentApplication.name)
                                .catch(this.error);

                            if (currentDeviceApplication !== currentApplication.name) {
                                this._driver.triggerApplicationOpenedTrigger(this, {
                                    app: currentApplication.name
                                });
                            }
                        } else {
                            this.setCapabilityValue('current_application', null)
                                .catch(this.error);

                            if (currentDeviceApplication !== null) {
                                this._driver.triggerApplicationOpenedTrigger(this, {
                                    app: null
                                });
                            }
                        }
                    });
                }
            }).catch(error => {
                this.setCapabilityValue('onoff', false)
                    .catch(this.error);
            }),
            this.getJointspaceClient().getAudioData().then((response) => {
                let muted = (response.muted === true);

                this.setCapabilityValue('volume_mute', muted)
                    .catch(this.error);

                // We only want to update the current volume on our device if the TV is not muted. When muted, the TV
                // returns the current volume as zero. We don't set this zero value because we
                // need to provide the current volume whilst unmuting the TV.
                if (!muted) {
                    this.setCapabilityValue('volume_set', response.current)
                        .catch(this.error);
                }
            }),
            this.getJointspaceClient().getAmbiHue().then(response => {
                let currentAmbiHueState = this.getCapabilityValue('ambihue_onoff'),
                    ambiHueState = (response.power === 'On');

                if (currentAmbiHueState !== ambiHueState) {
                    this._driver.triggerAmbiHueChangedTrigger(this, {
                        enabled: ambiHueState
                    });
                    this.setCapabilityValue('ambihue_onoff', ambiHueState);
                }
            }),
            this.getJointspaceClient().getAmbilight().then(response => {
                let currentAmbilightState = this.getCapabilityValue('ambilight_onoff'),
                    ambilightState = (response.styleName !== 'OFF');

                if (currentAmbilightState !== ambilightState) {
                    this._driver.triggerAmbilightChangedTrigger(this, {
                        enabled: ambilightState
                    });
                    this.setCapabilityValue('ambilight_onoff', ambilightState);
                }
            })
        ]).then(resolve).catch(reject);
    }

    _onCapabilityOnOffSet(value) {
        this.deviceLog(`powering ${value ? 'on' : 'off'} device`);

		// Always try sending a magic packet
		if(value && this.getMACAddress()) {
			wol.wake(this.getMACAddress());

			// Send twice in case the first one got lost in transit
			setTimeout(wol.wake, 1000, this.getMACAddress());
		}
		
		return this.getJointspaceClient().setPowerState(value).then(() => {
            this.deviceLog(`successfully sent power ${value ? 'on' : 'off'}`);
        }).catch(error => {
            console.log(error);
        });
    }

    _onCapabilityAmbilightOnOffSet(value) {
        return this.setAmbilight(value);
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

    async setVolume(volume, mute = false) {
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