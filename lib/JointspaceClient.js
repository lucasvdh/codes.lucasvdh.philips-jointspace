'use strict';

const crypto = require('crypto');
const http = require('http.min');
const DigestRequest = require('./DigestRequest');

const allPossibleInputs = require('/assets/json/allPossibleInputs.json');

const secretKey = 'ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==';

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
        protocol = secure ? 'https' : 'http';

        // Set port giving function param precedence
        if (port === null && this.port !== null) {
            port = this.port;
        } else if (port === null) {
            port = JointspaceClient.getPortByApiVersion(this.apiVersion);
        }

        method = method.toLowerCase();

        let host = this.ipAddress,
            path = '/' + (prefixPathWithApiVersion ? (this.apiVersion + '/' + route) : route);

		let options = {
			protocol: protocol+':',
			hostname: host,
			port: port,
			path: path,
			rejectUnauthorized: false,
			json: data
		};

        if (this.debug) {
            this.log(method + ' [' + uri + ']', 'with:', data, 'requested securely?', this.secure);
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
                        ? 'using digest _client'
                        : 'user regular _client'
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

    setAmbiHue(power) {
        return this.request('HueLamp/power', 'POST', {
            power: power ? "On" : "Off"
        });
    }

    getAmbiHue() {
        return this.request('HueLamp/power', 'GET');
    }

    getAudioData() {
        return this.request('audio/volume', 'GET');
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
        return this.request('audio/volume', 'POST', {
            current: volume,
            muted: mute
        });
    }

    getNetworkDevices() {
        return this.request('network/devices', 'GET');
    }

    getPowerState() {
        return this.request('powerstate', 'GET');
    }

    setPowerState(state) {
        return state
            ? this.request('apps/ChromeCast', 'POST', {}, {}, 8008, false, false)
            : this.request('powerstate', 'POST', {powerstate: "Standby"});
    }

    getPossibleKeys() {
        return allPossibleInputs;
    }

    setSetting(setting) {
        return this.request('menuitems/settings/update', 'POST', setting);
    }

    notifyChange(lastState) {
		if(!lastState || !lastState.powerstate) {
			lastState = require('/assets/json/notifyChange.json');
			lastState.notification.companionlauncher.device_id = this.deviceId;
		} else {
			lastState = {"notification": lastState}
		}
        return this.request('notifychange', 'POST', lastState);
    }
}

module.exports = JointspaceClient;