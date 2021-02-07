'use strict';

const crypto = require('crypto');
const request = require('request');
const DigestRequest = require('./DigestRequest');

// const digest = require('request-digest');
var allPossibleInputs = [
    {
        inputname: "Standby",
        friendlyName: "Aan/Uit"
    },
    {
        inputname: "Back",
        friendlyName: "Terug"
    },
    {
        inputname: "Find",
        friendlyName: "Zoek"
    },
    {
        inputname: "RedColour",
        friendlyName: "Rood"
    },
    {
        inputname: "GreenColour",
        friendlyName: "Groen"
    },
    {
        inputname: "YellowColour",
        friendlyName: "Geel"
    },
    {
        inputname: "BlueColour",
        friendlyName: "Blauw"
    },
    {
        inputname: "Home",
        friendlyName: "Home"
    },
    {
        inputname: "VolumeUp",
        friendlyName: "Volume Up"
    },
    {
        inputname: "VolumeDown",
        friendlyName: "Volume Down"
    },
    {
        inputname: "Mute",
        friendlyName: "Mute on/off"
    },
    {
        inputname: "Options",
        friendlyName: "Options"
    },
    {
        inputname: "Dot",
        friendlyName: "Punt"
    },
    {
        inputname: "Digit0",
        friendlyName: "Digit 0"
    },
    {
        inputname: "Digit1",
        friendlyName: "Digit 1"
    },
    {
        inputname: "Digit2",
        friendlyName: "Digit 2"
    },
    {
        inputname: "Digit3",
        friendlyName: "Digit 3"
    },
    {
        inputname: "Digit4",
        friendlyName: "Digit 4"
    },
    {
        inputname: "Digit5",
        friendlyName: "Digit 5"
    },
    {
        inputname: "Digit6",
        friendlyName: "Digit 6"
    },
    {
        inputname: "Digit7",
        friendlyName: "Digit 7"
    },
    {
        inputname: "Digit8",
        friendlyName: "Digit 8"
    },
    {
        inputname: "Digit9",
        friendlyName: "Digit 9"
    },
    {
        inputname: "Info",
        friendlyName: "Info"
    },
    {
        inputname: "CursorUp",
        friendlyName: "Cursor Up"
    },
    {
        inputname: "CursorDown",
        friendlyName: "Cursor Down"
    },
    {
        inputname: "CursorLeft",
        friendlyName: "Cursor Left"
    },
    {
        inputname: "CursorRight",
        friendlyName: "Cursor Right"
    },
    {
        inputname: "Confirm",
        friendlyName: "Ok"
    },
    {
        inputname: "Next",
        friendlyName: "Next"
    },
    {
        inputname: "Previous",
        friendlyName: "Previous"
    },
    {
        inputname: "Adjust",
        friendlyName: "Adjust"
    },
    {
        inputname: "WatchTV",
        friendlyName: "Watch TV"
    },
    {
        inputname: "Viewmode",
        friendlyName: "Viewmode"
    },
    {
        inputname: "Teletext",
        friendlyName: "Teletext"
    },
    {
        inputname: "Subtitle",
        friendlyName: "Subtitle on/off"
    },
    {
        inputname: "ChannelStepUp",
        friendlyName: "Channel Up"
    },
    {
        inputname: "ChannelStepDown",
        friendlyName: "Channel Down"
    },
    {
        inputname: "Source",
        friendlyName: "Source"
    },
    {
        inputname: "AmbilightOnOff",
        friendlyName: "Ambilight on/off"
    },
    {
        inputname: "PlayPause",
        friendlyName: "Play / Pause"
    },
    {
        inputname: "Pause",
        friendlyName: "Pause"
    },
    {
        inputname: "FastForward",
        friendlyName: "Fast Forward"
    },
    {
        inputname: "Stop",
        friendlyName: "Stop"
    },
    {
        inputname: "Rewind",
        friendlyName: "Fast Backward"
    },
    {
        inputname: "Record",
        friendlyName: "Record"
    },
    {
        inputname: "Online",
        friendlyName: "Online"
    }
];

const secretKey = 'ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==';

class JointspaceClient {

    constructor(deviceId) {
        this.authKey = null;
        this.timestamp = null;
        this.timeout = null;
        this.digestClient = null;
        this.secure = null;
        this.port = null;
        this.debug = false;
        this.ipAddress = null;
        this.apiVersion = null;
        this.user = null;
        this.pass = null;
        this.logListener = null;

        if (typeof deviceId === "undefined") {
            this.deviceId = DigestRequest.md5(
                Math.random().toString(36)
            ).substr(0, 8)
        } else {
            this.deviceId = deviceId;
        }

        this.device = {
            "app_id": "gapp.id",
            "id": this.deviceId,
            "device_name": "Homey",
            "device_os": "Android",
            "app_name": "Homey Jointspace App",
            "type": "native"
        };
    }

    setConfig(ipAddress, apiVersion, user = null, pass = null, secure = null, port = null) {
        this.ipAddress = ipAddress;
        this.apiVersion = apiVersion;
        this.user = user;
        this.pass = pass;

        this.setSecure(secure);
        this.setPort(port);
    }

    setSecure(secure) {
        this.secure = secure;
    }

    setPort(port) {
        this.port = port;
    }

    registerLogListener(callback) {
        this.logListener = callback;
    }

    log(...data) {
        if (this.logListener !== null) {
            this.logListener(data);
        }

        console.log(data);
    }

    static getProtocolByApiVersion(apiVersion) {
        return apiVersion >= 6 ? 'https' : 'http';
    }

    static getPortByApiVersion(apiVersion) {
        return apiVersion >= 6 ? 1926 : 1925;
    }

    startPair() {
        let data = {"device": this.device, "scope": ["read", "write", "control"]};

        return new Promise((resolve, reject) => {
            this.request('pair/request', 'POST', data).then(json => {
                this.authKey = json.auth_key;
                this.timestamp = json.timestamp;
                this.timeout = json.timeout;
                resolve(json);
            }, error => {
                if (this.debug) {
                    this.error('startPair() error', error);
                }
                reject(error);
            });
        })
    }

    static createSignature(secretKey, secret) {
        let hmac = crypto.createHmac('sha1', secretKey);
        hmac.write(secret);
        hmac.end();
        return hmac.read('binary').toString('base64');
    }

    confirmPair(pin) {
        let decodedSecretKey = Buffer.from(secretKey, 'base64'),
            authTimestamp = this.timestamp + pin,
            signature = JointspaceClient.createSignature(decodedSecretKey, authTimestamp),
            authData = {
                "device": this.device,
                "auth": {
                    "auth_AppId": "1",
                    "pin": pin,
                    "auth_timestamp": this.timestamp,
                    "auth_signature": signature
                }
            };

        let user = this.deviceId,
            pass = this.authKey;

        this.user = user;
        this.pass = pass;

        return new Promise((resolve, reject) => {
            this.request('pair/grant', 'POST', authData).then((response) => {
                if (response.error_id !== 'SUCCESS') {
                    reject(response);
                } else {
                    resolve({user: user, pass: pass});
                }
            }).catch((error) => {
                reject(error);
            });
        });
    }

    /**
     * @returns {DigestRequest}
     */
    getDigestClient() {
        if (this.digestClient === null) {
            this.digestClient = new DigestRequest(this.user, this.pass);
        }
        return this.digestClient;
    }

    /**
     * @param route
     * @param method
     * @param data
     * @param port
     * @param headers
     * @param secure
     * @returns {Promise}
     */
    request(route, method, data = {}, headers = {}, port = null, secure = null) {
        let protocol;

        // Set protocol giving function param precedence
        if (secure !== null) {
            protocol = secure ? 'https' : 'http';
        } else if (secure === null && this.secure !== null) {
            protocol = this.secure ? 'https' : 'http';
        }

        // Set port giving function param precedence
        if (port === null && this.port !== null) {
            port = this.port;
        } else if (port === null) {
            port = JointspaceClient.getPortByApiVersion(this.apiVersion);
        }

        method = method.toUpperCase();

        let host = this.ipAddress,
            path = '/' + this.apiVersion + '/' + route,
            uri = protocol + '://' + host + ':' + port + path;

        let options = {
            url: uri,
            method: method,
            body: data,
            json: true,
            strictSSL: false,
            debug: false,
        };

        if (this.debug) {
            this.log(method + ' [' + uri + ']', 'with:', data, 'requested securely?', this.secure);
        }

        return new Promise((resolve, reject) => {
            let callback = (error, response, data) => {
                if (!error && response.statusCode === 200) {
                    resolve(data);
                } else if (!error && response.statusCode !== 200) {
                    if (this.debug) {
                        this.error("JointspaceClient response error", JSON.stringify(error))
                    }
                    reject(response);
                } else if (error !== null) {
                    if (this.debug) {
                        this.error("JointspaceClient response error", JSON.stringify(error), data)
                    }
                    reject(error);
                } else {
                    if (this.debug) {
                        this.error("JointspaceClient response error", JSON.stringify(response), data)
                    }
                    reject(response);
                }
            };


            if (this.debug) {
                this.log(
                    (this.user !== null && (this.secure === null || this.secure === true))
                        ? 'using digest _client'
                        : 'user regular _client'
                );
            }

            if (this.user !== null && (this.secure === null || this.secure === true)) {
                this.getDigestClient().request(host, port, path, method, data, callback);
            } else {
                request(options, callback);
            }
        });
    }

    getSystem() {
        // It's required to access the system endpoint on port 1925 because
        // some newer models which use port 1926 still only listen
        // on port 1925 for the system endpoint
        return this.request('system', 'GET', {}, {}, 1925, false);
    }

    getApplications() {
        return this.request('applications', 'GET')
    }

    sendKey(key) {
        return this.request('input/key', 'POST', {
            key: key
        })
    }

    launchActivity(intent) {
        return this.request('activities/launch', 'POST', {
            intent: intent,
        });
    }

    getChannels() {
        return this.request('channeldb/tv/channelLists/all', 'GET');
    }

    getCurrentActivity() {
        return this.request('activities/current', 'GET');
    }

    getSource() {
        return this.request('sources/current', 'GET');
    }

    getAmbilight() {
        return this.request('ambilight/currentconfiguration', 'GET');
    }

    setAmbilight(ambilight) {
        return this.request('ambilight/currentconfiguration', 'POST', ambilight);
    }

    getAudioData() {
        return this.request('audio/volume', 'GET');
    }

    setVolume(volume, mute) {
        if (typeof mute === 'undefined') {
            mute = false;
        }
        return this.request('audio/volume', 'POST', {
            current: volume,
            muted: mute
        });
    }

    /* DOES not work on 804 - probably requires current to be set even when muting
    use setVolume function with either static volume or get current first
    mute() {
        return this.request('audio/volume', 'POST', {
            muted: true
        });
    }

    unMute() {
        return this.request('audio/volume', 'POST', {
            muted: false
        });
    }
    */

    getNetworkDevices() {
        return this.request('network/devices', 'GET');
    }

    getPowerState() {
        return this.request('powerstate', 'GET');
    }

    setPowerState(state) {
        return this.request('powerstate', 'POST', {
            powerstate: state
        });
    }

    getPossibleKeys() {
        return allPossibleInputs;
    }

    setSetting(setting) {
        return this.request('menuitems/settings/update', 'POST', setting);
    }

    getInfo() {
        return this.request('notifychange', 'POST', {
            "notification": {
                "context": {
                    "level1": "",
                    "level2": "",
                    "level3": "",
                    "data": ""
                },
                "network/devices": [],
                "input/textentry": {
                    "textentry": "not requested",
                    "initialstring": ""
                },
                "system/epgsource": {},
                "activities/tv": {
                    "channel": {}
                },
                "channeldb/tv": {
                    "channelLists": [
                        {
                            "id": "all",
                            "version": "0"
                        }
                    ],
                    "favoriteLists": [
                        {
                            "id": "1",
                            "version": "2"
                        },
                        {
                            "id": "2",
                            "version": "2"
                        },
                        {
                            "id": "3",
                            "version": "2"
                        },
                        {
                            "id": "4",
                            "version": "2"
                        },
                        {
                            "id": "5",
                            "version": "2"
                        },
                        {
                            "id": "6",
                            "version": "2"
                        },
                        {
                            "id": "7",
                            "version": "2"
                        },
                        {
                            "id": "8",
                            "version": "2"
                        }
                    ]
                },
                "menuitems/settings/version": {
                    "version": "",
                    "nodes": [
                        2131230762,
                        2131230763,
                        2131230764,
                        2131230765,
                        2131230766,
                        2131230776,
                        2131230768,
                        2131230769,
                        2131230770,
                        2131230771,
                        2131230774
                    ]
                },
                "system/nettvversion": "",
                "powerstate": {
                    "powerstate": ""
                },
                "applications/version": "null",
                "activities/current": {},
                "recordings/list": {
                    "version": ""
                },
                "reminder/list": {
                    "version": ""
                },
                "input/pointer": {
                    "status": ""
                },
                "companionlauncher": {
                    "device_id": this.deviceId,
                    "msg_id": ""
                }
            }
        });
    }
}

module.exports = JointspaceClient;