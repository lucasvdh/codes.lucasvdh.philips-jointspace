"use strict";

<<<<<<< Updated upstream:lib/JointspaceClient.js
const crypto = require('crypto');
const http = require('http.min');
const DigestRequest = require('./DigestRequest');

const allPossibleInputs = require('/assets/json/allPossibleInputs.json');
=======
const crypto = require("crypto");
const request = require("request");
const DigestRequest = require("./DigestRequest");
const HMAC = require("./HMAC");
const AES = require("./AES");

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
>>>>>>> Stashed changes:lib/JointSpace/Client.js

const secretKeyBase64 = "ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==",
    decryptionKeyBase64 = 'ZmVay1EQVFOaZhwQ4Kv81w==',
    ivBase64 = 'AcynMwikMkW4c7+mHtwtfw==';

class JointspaceClient {

    constructor(deviceId) {
        this.authKey = null;
        this.timestamp = null;
        this.timeout = null;
        this.digestClients = [];
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
        return apiVersion >= 6 ? "https" : "http";
    }

    static getPortByApiVersion(apiVersion) {
        return apiVersion >= 6 ? 1926 : 1925;
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
                    this.error("startPair() error", error);
                }
                reject(error);
            });
        })
    }

    confirmPair(pin) {
        const authTimestamp = this.timestamp + pin,
            signature = HMAC.sign(secretKeyBase64, authTimestamp),
            authData = {
                "device": this.device,
                "auth": {
                    "auth_AppId": "1",
                    "pin": pin,
                    "auth_timestamp": this.timestamp,
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
     * @returns {DigestRequest}
     */
    getDigestClient() {
        if (!this.digestClients[this.ipaddress]) {
            this.digestClients[this.ipaddress] = new DigestRequest(this.user, this.pass);
        }
        return this.digestClients[this.ipaddress];
    }

    /**
     * @param route
     * @param method
     * @param data
     * @param port
     * @param headers
     * @param secure
     * @param prefixPathWithApiVersion
     * @returns {Promise}
     */
    request(route, method, data = {}, headers = {}, port = null, secure = null, prefixPathWithApiVersion = true) {
        let protocol;

        if (secure === null && this.secure !== null) {
            secure = this.secure;
        } else if (secure === null) {
            secure = true;
        }

        // Set protocol giving function param precedence
        protocol = secure ? "https" : "http";

        // Set port giving function param precedence
        if (port === null && this.port !== null) {
            port = this.port;
        } else if (port === null) {
            port = JointspaceClient.getPortByApiVersion(this.apiVersion);
        }

        method = method.toLowerCase();

        let host = this.ipAddress,
<<<<<<< Updated upstream:lib/JointspaceClient.js
            path = '/' + (prefixPathWithApiVersion ? (this.apiVersion + '/' + route) : route);

		let options = {
			protocol: protocol+':',
			hostname: host,
			port: port,
			path: path,
			rejectUnauthorized: false,
			json: data
		};
=======
            path = "/" + (prefixPathWithApiVersion ? (this.apiVersion + "/" + route) : route),
            uri = protocol + "://" + host + ":" + port + path;

        let options = {
            url: uri,
            method: method,
            body: data,
            json: true,
            strictSSL: false,
            debug: false,
        };
>>>>>>> Stashed changes:lib/JointSpace/Client.js

        if (this.debug) {
            this.log(method + " [" + uri + "]", "with:", data, "requested securely?", this.secure);
        }

        return new Promise((resolve, reject) => {
            let callback = (error, response, data) => {
                if (!error && (response.statusCode === 200 || response.statusCode === 201)) {
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
                    (this.user !== null && secure)
                        ? "using digest _client"
                        : "user regular _client"
                );
            }

            if (this.user !== null && secure) {
                this.getDigestClient().request(host, port, path, method, data, callback);
            } else {
                http[method](options).then((response) => {
					callback(null, response.response, response.data);
				}).catch(error => {
					console.log('HTTP call error:', path, error);
					callback(error);
				});
            }
        });
    }

    getSystem() {
        // It's required to access the system endpoint on port 1925 because
        // some newer models which use port 1926 still only listen
        // on port 1925 for the system endpoint
        return this.request("system", "GET", {}, {}, 1925, false).then(response => {
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
        });
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

    setAmbilight(ambilight) {
        return this.request("ambilight/currentconfiguration", "POST", ambilight);
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

<<<<<<< Updated upstream:lib/JointspaceClient.js
    notifyChange(lastState) {
		if(!lastState || !lastState.powerstate) {
			lastState = require('/assets/json/notifyChange.json');
			lastState.notification.companionlauncher.device_id = this.deviceId;
		} else {
			lastState = {"notification": lastState}
		}
        return this.request('notifychange', 'POST', lastState);
=======
    getInfo() {
        return this.request("notifychange", "POST", {
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
>>>>>>> Stashed changes:lib/JointSpace/Client.js
    }
}

module.exports = JointspaceClient;