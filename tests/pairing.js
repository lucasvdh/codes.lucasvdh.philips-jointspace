"use strict"

const JointspaceClient = require('../lib/JointspaceClient');
const inquirer = require('inquirer');

let questions = [{
        type: 'input',
        name: 'ipAddress',
        message: "What\'s your TV\'s IP?",
    }, {
        type: 'number',
        name: 'apiVersion',
        message: "What\'s your API version? (1 to 6)",
    }, {
        type: 'number',
        name: 'port',
        message: "What port number should be used? Either 1925 or 1926",
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
    ];

inquirer.prompt(questions).then(answers => {
    console.log('Updating _client config');
    client.setConfig(answers.ipAddress, answers.apiVersion);
    client.setSecure(false);
    client.setPort(answers.port);

    let onResolvePair = (response) => {
        if (response.error_id === 'SUCCESS') {
            console.log('Successfully started pairing process');

            inquirer.prompt([{
                'type': 'input',
                'name': 'pin',
                'message': 'What\'s the pin code displayed on the tv?'
            }]).then(answers => {
                console.log('Sending pin verification:', answers.pin);

                client.confirmPair(answers.pin).then((credentials) => {
                    console.log('Pairing process completed successfully!');
                    console.log('Your tv is now accessible with the following digest credentials', credentials);
                }).catch((error) => {
                    if (typeof error.error_id !== "undefined") {
                        if (error.error_id === 'INVALID_PIN') {
                            console.log('The pin "' + answers.pin + '" is not valid');
                        } else if (error.error_id === 'TIMEOUT') {
                            console.log('Received a pairing session timeout');
                        } else if (error.error_id === 'ECONNRESET') {
                            console.log('The connection was reset during pairing, this shouldn\'t happen');
                        } else {
                            console.log('Unexpected pairing error', JSON.stringify(error));
                        }
                    } else {
                        console.log('Unexpected pairing error', JSON.stringify(error));
                    }
                });
            });
        } else {
            console.log('Concurrent pairing in progress');
        }
    };

    let onRejectPair = (error) => {
        if (typeof error.statusCode !== "undefined") {
            if (error.statusCode === 404) {
                console.log('Could not find api endpoint, got 404. Incorrect api version?');
            } else {
                console.log('Unexpected error\n', JSON.stringify(error));
            }
        } else if (typeof error.code !== "undefined") {
            if (error.code === 'ECONNRESET') {
                console.log('Could not reach api endpoint, connection was reset. Incorrect port number?');
            } else {
                console.log('Unexpected error\n', JSON.stringify(error));
            }
        } else {
            console.log('Unexpected error\n', JSON.stringify(error));
        }
    };

    let onResolveSystem = (response) => {
        let apiVersion = response.api_version.Major,
            systemFeatures = response.featuring.systemfeatures;

        console.log('API version as returned by TV:', apiVersion);

        if (typeof systemFeatures.pairing_type !== "undefined") {
            let pairingType = systemFeatures.pairing_type;

            client.setSecure(systemFeatures.secured_transport === 'true');

            if (pairingType === "digest_auth_pairing") {
                console.log('Starting pairing process');

                client.startPair().then(onResolvePair).catch(error => {
                    console.log('Starting pair failed, trying different variations');

                    let pairingVariation = pairingVariations.pop();

                    onPairingVariation(pairingVariation);
                });
            } else {
                console.log('Unexpected pairing type\n', JSON.stringify(response));
            }
        } else {
            console.log('Could not find a pairing type, it might be that this tv does not require pairing.');
            console.log('Sending test call for audio data now');

            client.setSecure(false);
            client.getAudioData().then((response) => {
                console.log('Got response\n', JSON.stringify(response));
            }).catch((error) => {
                console.log('Something went wrong\n', JSON.stringify(error));
            })
        }
    };

    let onRejectSystem = (error) => {
        if (typeof error !== "undefined" && error !== null) {
            if (typeof error.statusCode !== "undefined") {
                if (error.statusCode === 404) {
                    console.log('TV found but API endpoint return 404, try a different api version.');
                } else {
                    console.log('Unexpected error', JSON.stringify(error));
                }
            } else if (typeof error.code !== 'undefined') {
                if (error.code === 'EHOSTUNREACH') {
                    console.log('Could not reach TV, got EHOSTUNREACH');
                } else if (error.code === 'ETIMEDOUT') {
                    console.log('Could not connect to TV, got ETIMEDOUT');
                } else if (error.code === 'ECONNREFUSED') {
                    console.log('Could not connect to port, got ECONNREFUSED');
                } else {
                    console.log('Unexpected error\n', JSON.stringify(error));
                }
            }
        } else {
            console.log('Unexpected error\n', JSON.stringify(error));
        }
    };

    let onPairingVariation = (pairingVariation) => {
        client.setPort(pairingVariation.port);
        client.setSecure(pairingVariation.secure);

        console.log('Retrying pair on port ' + pairingVariation.port + ' with ' + (pairingVariation.secure ? 'https' : 'http'));

        client.startPair().then(result => {
            onResolvePair(result);
        }).catch(error => {
            console.log('Failed starting pair on port ' + pairingVariation.port + ' with ' + (pairingVariation.secure ? 'https' : 'http'));

            if (pairingVariations.length > 0) {
                onPairingVariation(pairingVariations.pop());
            } else {
                onRejectPair(error);
            }
        });
    };

    console.log('Sending system info call');
    client.getSystem().then(onResolveSystem).catch(onRejectSystem);
});