"use strict"

const JointspaceClient = require('../lib/Jointspace/Client');
const inquirer = require('inquirer');
const fs = require('fs');
const request = require("request");

let questions = [{
        type: 'input',
        name: 'ipAddress',
        message: "What\'s your TV\'s IP?",
    }],
    deviceId = 'testing',
    client = new JointspaceClient(deviceId),
    pairingVariations = [
        {
            port: 1926,
            secure: true
        },
        {
            port: 1926,
            secure: false
        },
        {
            port: 1925,
            secure: true
        },
        {
            port: 1925,
            secure: false
        }
    ],
    logger = (...data) => {
        console.log(...data);

        if (typeof data === 'object') {
            data = data.join(', ');
        }

        fs.appendFileSync('log.txt', data + '\r\n', 'utf8');
    };

client.registerLogListener(logger);
client.debug = true;

inquirer.prompt(questions).then(answers => {
    logger('Updating _client config');

    let apiVersions = [1, 5, 6],
        host = answers.ipAddress;

    apiVersions.forEach(apiVersion => {
        let path = "/" + apiVersion + "/system",
            uri = "http://" + host + ":1925" + path;

        console.log(uri);

        let options = {
            url: uri,
            method: 'GET',
            json: true,
            strictSSL: false,
            debug: false,
            timeout: 5000
        };
        request(options, (error, response, data) => {
            console.log(uri, response.statusCode);
        });
    });


    // this.request("system", "GET", {}, {}, 1925, false).then(response => {
    //     const encryptedAttributes = [
    //         'serialnumber',
    //         'softwareversion',
    //         'model',
    //         'deviceid',
    //     ];
    //
    //     encryptedAttributes.forEach((attribute) => {
    //         if (typeof response[attribute + '_encrypted'] !== "undefined") {
    //             try {
    //                 response[attribute] = AES.decrypt(decryptionKeyBase64, ivBase64, response[attribute + '_encrypted'].trim());
    //             } catch (e) {
    //             }
    //         }
    //     });
    //
    //     return response;
    // });
    return;

    // client.setConfig(answers.ipAddress, answers.apiVersion);
    // client.setSecure(false);
    // client.setPort(answers.port);
    //

    let onResolvePair = (response) => {
        if (response.error_id === 'SUCCESS') {
            logger('Successfully started pairing process');

            inquirer.prompt([{
                'type': 'input',
                'name': 'pin',
                'message': 'What\'s the pin code displayed on the tv?'
            }]).then(answers => {
                logger('Sending pin verification:', answers.pin);

                client.confirmPair(answers.pin).then((credentials) => {
                    logger('Pairing process completed successfully!');
                    logger('Your tv is now accessible with the following digest credentials', credentials);
                }).catch((error) => {
                    if (typeof error.error_id !== "undefined") {
                        if (error.error_id === 'INVALID_PIN') {
                            logger('The pin "' + answers.pin + '" is not valid');
                        } else if (error.error_id === 'TIMEOUT') {
                            logger('Received a pairing session timeout');
                        } else if (error.error_id === 'ECONNRESET') {
                            logger('The connection was reset during pairing, this shouldn\'t happen');
                        } else {
                            logger('Unexpected pairing error', JSON.stringify(error));
                        }
                    } else {
                        logger('Unexpected pairing error', JSON.stringify(error));
                    }
                });
            });
        } else {
            logger('Concurrent pairing in progress');
        }
    };

    let onRejectPair = (error) => {
        if (typeof error.statusCode !== "undefined") {
            if (error.statusCode === 404) {
                logger('Could not find api endpoint, got 404. Incorrect api version?');
            } else {
                logger('Unexpected error\n', JSON.stringify(error));
            }
        } else if (typeof error.code !== "undefined") {
            if (error.code === 'ECONNRESET') {
                logger('Could not reach api endpoint, connection was reset. Incorrect port number?');
            } else {
                logger('Unexpected error\n', JSON.stringify(error));
            }
        } else {
            logger('Unexpected error\n', JSON.stringify(error));
        }
    };

    let onResolveSystem = (response) => {
        let apiVersion = response.api_version.Major,
            systemFeatures = response.featuring.systemfeatures;

        logger('API version as returned by TV:', apiVersion);

        if (typeof systemFeatures.pairing_type !== "undefined") {
            let pairingType = systemFeatures.pairing_type;

            client.setSecure(systemFeatures.secured_transport === 'true');

            if (pairingType === "digest_auth_pairing") {
                logger('Starting pairing process');

                client.startPair().then(onResolvePair).catch(error => {
                    logger('Starting pair failed, trying different variations');

                    let pairingVariation = pairingVariations.pop();

                    onPairingVariation(pairingVariation);
                });
            } else {
                logger('Unexpected pairing type\n', JSON.stringify(response));
            }
        } else {
            logger('Could not find a pairing type, it might be that this tv does not require pairing.');
            logger('Sending test call for audio data now');

            client.setSecure(false);
            client.getAudioData().then((response) => {
                logger('Got response\n', JSON.stringify(response));
            }).catch((error) => {
                logger('Something went wrong\n', JSON.stringify(error));
            })
        }
    };

    let onRejectSystem = (error) => {
        if (typeof error !== "undefined" && error !== null) {
            if (typeof error.statusCode !== "undefined") {
                if (error.statusCode === 404) {
                    logger('TV found but API endpoint return 404, try a different api version.');
                } else {
                    logger('Unexpected error', JSON.stringify(error));
                }
            } else if (typeof error.code !== 'undefined') {
                if (error.code === 'EHOSTUNREACH') {
                    logger('Could not reach TV, got EHOSTUNREACH');
                } else if (error.code === 'ETIMEDOUT') {
                    logger('Could not connect to TV, got ETIMEDOUT');
                } else if (error.code === 'ECONNREFUSED') {
                    logger('Could not connect to port, got ECONNREFUSED');
                } else {
                    logger('Unexpected error\n', JSON.stringify(error));
                }
            }
        } else {
            logger('Unexpected error\n', JSON.stringify(error));
        }
    };

    let onPairingVariation = (pairingVariation) => {
        client.setPort(pairingVariation.port);
        client.setSecure(pairingVariation.secure);

        logger('Retrying pair on port ' + pairingVariation.port + ' with ' + (pairingVariation.secure ? 'https' : 'http'));

        client.startPair().then(result => {
            onResolvePair(result);
        }).catch(error => {
            logger('Failed starting pair on port ' + pairingVariation.port + ' with ' + (pairingVariation.secure ? 'https' : 'http'));

            if (pairingVariations.length > 0) {
                onPairingVariation(pairingVariations.pop());
            } else {
                onRejectPair(error);
            }
        });
    };

    logger('Sending system info call');
    client.getSystem().then(onResolveSystem).catch(onRejectSystem);
});
