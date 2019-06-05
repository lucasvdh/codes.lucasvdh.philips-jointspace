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
        message: "What\'s your API version? (1-6)",
    }],
    deviceId = 'testing',
    client = new JointspaceClient(deviceId);

inquirer.prompt(questions).then(answers => {
    console.log('Updating client config');
    client.setConfig(answers.ipAddress, answers.apiVersion);
    client.setSecure(false);

    console.log('Sending system info call');
    client.getSystem().then((response) => {
        let apiVersion = response.api_version.Major,
            systemFeatures = response.featuring.systemfeatures;

        console.log('API version as returned by TV:', apiVersion);

        if (typeof systemFeatures.pairing_type !== "undefined") {
            let pairingType = systemFeatures.pairing_type;

            client.setSecure(systemFeatures.secured_transport);

            if (pairingType === "digest_auth_pairing") {
                console.log('Starting pairing process');

                client.startPair().then((response) => {
                    if (response.error_id === 'SUCCESS') {
                        console.log('Successfully started pairing process');

                        inquirer.prompt([{
                            'type': 'input',
                            'name': 'pin',
                            'message': 'What\'s the pin code displayed on the tv?'
                        }]).then(answers => {
                            console.log('Sending ping:', answers.pin);

                            client.confirmPair(answers.pin).then((credentials) => {
                                console.log('Pairing process completed succesfully!');
                                console.log('Your tv is now accessible with the following credentials', credentials);
                            }).catch((error) => {
                                if (typeof error.statusCode !== "undefined" && error.statusCode === 401) {
                                    console.log('The pin was incorrect or an HMAC signing issue occured\n\n', JSON.stringify(error));
                                }
                                console.log('An error occurred when trying to confirm the pairing process\n\n', JSON.stringify(error));
                            });
                        });
                    } else {
                        console.log('Concurrent pairing in progress');
                    }
                }).catch((error) => {
                    if (typeof error.statusCode !== "undefined") {
                        if (error.statusCode === 404) {
                            console.log('Could not find api endpoint, got 404. Incorrect api version?');
                        } else {
                            console.log('Unexpected error\n', JSON.stringify(error));
                        }
                    } else {
                        console.log('Unexpected error\n', JSON.stringify(error));
                    }
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
    }).catch((error) => {
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
    });
});