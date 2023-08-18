"use strict";

const crypto = require("crypto");
const HMAC = require("./HMAC");
const AES = require("./AES");
const needle = require("needle");
const UnauthenticatedError = require("../Errors/UnauthenticatedError");
const initialState = require("../../assets/json/notifyChange.json");

// const digest = require("request-digest");
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

const secretKeyBase64 = "ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==",
    decryptionKeyBase64 = 'ZmVay1EQVFOaZhwQ4Kv81w==',
    ivBase64 = 'AcynMwikMkW4c7+mHtwtfw==';

class Client {

    constructor(deviceId) {
        this.authKey = null;
        this.timestamp = null;
        this.timeout = null;
        this.digestClient = null;
        this.secure = null;
        this.port = null;
        this.host = null;
        this.debug = true;
        this.apiVersion = null;
        this.user = null;
        this.pass = null;
        this.logListener = null;

        if (typeof deviceId === "undefined") {
            this.deviceId = crypto.createHash('md5')
                .update(Math.random().toString(36))
                .digest('hex')
                .substring(0, 8)
        } else {
            this.deviceId = deviceId;
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

    registerLogListener(callback) {
        this.logListener = callback;
    }

  log (...data) {
    if (this.debug && this.logListener !== null) {
      this.logListener(data)
    }
  }

    /**
     * @param {Boolean} secure
     * @returns {String}
     */
    static getProtocol(secure) {
        return secure ? "https" : "http";
    }

    /**
     * @param {Boolean} secure
     * @returns {Number}
     */
    static getPort(secure) {
        return secure ? 1926 : 1925;
    }

    startPair() {
        let data = {"device": this.device, "scope": ["read", "write", "control"]};

        return new Promise((resolve, reject) => {
            this.request("pair/request", "POST", data).then(json => {
                console.log("pair request", json);
                this.authKey = json.auth_key;
                this.timestamp = json.timestamp;
                this.timeout = json.timeout;
                resolve(json);
            }, error => {
                if (this.debug) {
                    this.log("startPair() error", error);
                }

                reject(error);
            });
        })
    }

    /**
     * @param {Array<Number|String>} pin
     * @returns {Promise<Object>}
     */
    confirmPair(pin) {
        console.log('CONFIRM PAIR');
        const authTimestamp = this.timestamp.toString() + pin.toString(),
            signature = HMAC.sign(secretKeyBase64, authTimestamp),
            authData = {
                "device": this.device,
                "auth": {
                    "auth_AppId": "1",
                    "pin": pin.toString(),
                    "auth_timestamp": this.timestamp.toString(),
                    "auth_signature": signature
                }
            };

        this.user = this.deviceId;
        this.pass = this.authKey;

        return new Promise((resolve, reject) => {
            this.request("pair/grant", "POST", authData).then((response) => {
                if (typeof response.error_id === "undefined" || response.error_id !== "SUCCESS") {
                    reject(response);
                } else {
                    resolve({user: this.user, pass: this.pass});
                }
            }).catch((error) => {
                reject(error);
            });
        });
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
    request(path, method, data = {}, headers = {}, port = null, secure = null, prefixPathWithApiVersion = true) {
        this.log('Sending request', ...arguments)

        let protocol

        if (secure === null && this.secure !== null) {
            secure = this.secure
        } else if (secure === null) {
            secure = false
        }

        // Set protocol giving function param precedence
        protocol = Client.getProtocol(secure)
        path = (prefixPathWithApiVersion ? (this.apiVersion + '/' + path) : path)

        // Set port giving function param precedence
        if (port === null && this.port !== null) {
            port = this.port
        } else if (port === null) {
            port = Client.getPort(secure)
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

                return response.body
            })
    }

    /**
     * @return {boolean} - True or False value indicating if the client contains
     */
    isPaired () {
        return !!(this.user && this.pass)
    }

    getSystem() {
        // It's required to access the system endpoint on port 1925 because
        // some newer models which use port 1926 still only listen
        // on port 1925 for the system endpoint
        return this.request("system", "GET", {}, {}, 1925, false, false).then(response => {
                if (response === "") {
                    // system endpoint for some TV models only works on https://<IP>:1926/system (on http://<IP>:1925/system receives HTTP 200 with empty response)
                    return this.request("system", "GET", {}, {}, 1926, true, false).then(r => this.decryptEncryptedAttributesInResponse(r));
                }
                return this.decryptEncryptedAttributesInResponse(response);
            })
    }

    decryptEncryptedAttributesInResponse(response) {
        const encryptedAttributes = [
            'serialnumber',
            'softwareversion',
            'model',
            'deviceid',
        ];

        encryptedAttributes.forEach((attribute) => {
            if (typeof response[attribute + '_encrypted'] !== "undefined") {
                try {
                    response[attribute] = AES.decrypt(decryptionKeyBase64, ivBase64, response[attribute + '_encrypted'].trim());
                } catch (e) {
                }
            }
        });

        return response;
    }

    getApplications() {
        return this.request("applications", "GET")
    }

    sendKey(key) {
        return this.request("input/key", "POST", {
            key: key
        })
    }

    launchActivity(intent) {
        return this.request("activities/launch", "POST", {
            intent: intent,
        });
    }

    getChannels() {
        return this.request("channeldb/tv/channelLists/all", "GET");
    }

    getCurrentActivity() {
        return this.request("activities/current", "GET");
    }

    getSource() {
        return this.request("sources/current", "GET");
    }

    getAmbilight() {
        return this.request("ambilight/currentconfiguration", "GET");
    }

    setAmbilight (state) {
        return this.request('ambilight/power', "POST", {
            power: state ? 'On' : 'Off'
        })
    }

    setAmbilightConfiguration (ambilightConfiguration) {
        return this.request('ambilight/currentconfiguration', "POST", ambilightConfiguration)
    }

    setAmbiHue(power) {
        return this.request("HueLamp/power", "POST", {
            power: power ? "On" : "Off"
        });
    }

    getAmbiHue() {
        return this.request("HueLamp/power", "GET");
    }

    getAudioData() {
        return this.request("audio/volume", "GET");
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
    setVolume(volume, mute = false) {
        return this.request("audio/volume", "POST", {
            current: volume,
            muted: mute
        });
    }

    getNetworkDevices() {
        return this.request("network/devices", "GET");
    }

    getPowerState() {
        return this.request("powerstate", "GET");
    }

    setPowerState(state) {
        return state
            ? this.request("apps/ChromeCast", "POST", {}, {}, 8008, false, false)
            : this.request("powerstate", "POST", {powerstate: "Standby"});
    }

    getPossibleKeys() {
        return allPossibleInputs;
    }

    setSetting(setting) {
        return this.request("menuitems/settings/update", "POST", setting);
    }

    getInfo(lastState) {
        if (!lastState || !lastState.powerstate) {
            lastState = initialState
            lastState.notification.companionlauncher.device_id = this.deviceId
        } else {
            lastState = this.getDefaultState()
        }

        return this.request("notifychange", "POST", lastState);
    }

    getDefaultState() {
        return {
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
        };
    }
}

module.exports = Client;
