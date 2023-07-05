"use strict";

const request = require("request");
const AES = require("./AES");

const decryptionKeyBase64 = 'ZmVay1EQVFOaZhwQ4Kv81w==',
    ivBase64 = 'AcynMwikMkW4c7+mHtwtfw==';

class DeviceResolver {

    constructor(ipAddress) {
        this.ipAddress = ipAddress;
        this.apiVersions = [1, 5, 6];
    }

    resolve(ipAddress = null) {
        if (ipAddress !== null) {
            this.ipAddress = ipAddress;
        }

        let requests = [];

        this.apiVersions.forEach(apiVersion => {
            requests.push(this.resolveApiVersion(this.ipAddress, apiVersion));
        })

        return new Promise((resolve, reject) => {
            Promise.all(requests).then(responses => {
                if (responses.filter(item => item !== null).length) {
                    // TODO: check that highest available api version is returned
                    resolve(responses
                        .filter(item => item !== null)
                        .sort((a, b) => {
                            return a.apiVersion > b.apiVersion;
                        })
                        .pop());
                } else {
                    reject(new Error('Could not resolve device settings'))
                }
            });
        });
    }

    resolveApiVersion(ipAddress, apiVersion) {
        let path = "/" + apiVersion + "/system",
            uri = "http://" + ipAddress + ":1925" + path;

        let options = {
            url: uri,
            method: 'GET',
            json: true,
            strictSSL: false,
            debug: false,
            timeout: 5000
        };

        return new Promise(resolve => {
            request(options, (error, response, data) => {
                if (error !== null) {
                    resolve(null);
                } else if (typeof response !== "undefined" && response.statusCode === 200) {
                    resolve({
                        ipAddress,
                        apiVersion,
                        secure: this.getAttribute(data, 'featuring.systemfeatures.secured_transport') === 'true',
                        pairType: this.getAttribute(data, 'featuring.systemfeatures.pairing_type'),
                        name: this.getAttribute(data, 'name'),
                        serial: AES.decrypt(decryptionKeyBase64, ivBase64, this.getAttribute(data, 'serialnumber_encrypted')),
                        softwareVersion: AES.decrypt(decryptionKeyBase64, ivBase64, this.getAttribute(data, 'softwareversion_encrypted')),
                        model: AES.decrypt(decryptionKeyBase64, ivBase64, this.getAttribute(data, 'model_encrypted')),
                        deviceId: AES.decrypt(decryptionKeyBase64, ivBase64, this.getAttribute(data, 'deviceid_encrypted')),
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    getAttribute(object, path, defaultValue = null) {
        path.split('.').forEach(attr => {
            if (typeof object[attr] === "undefined") {
                return;
            }

            object = object[attr];
        });

        return object || defaultValue;
    }
}

module.exports = DeviceResolver;