const AES = require('../lib/Jointspace/AES.js');

// let aesClient = new AES();

// var keyBase64 = ;

var keyBase64 = Buffer.from("ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA===", 'base64').slice(0, 16).toString('base64');


var ivBase64 = 'AcynMwikMkW4c7+mHtwtfw==';
var plainText = 'FZ5A1823065423';
// var cipherText = AES.encrypt(plainText, keyBase64, ivBase64);
var decryptedCipherText = AES.decrypt(keyBase64, ivBase64, 'ZYT0fgsWA+utY2JykQtzPrLRmHLIPdS6VSDF7Ocajeo=');

console.log('Algorithm: ' + AES.getAlgorithm(keyBase64));
console.log('Plaintext: ' + plainText);
// console.log('Ciphertext: ' + cipherText);
console.log('Decoded Ciphertext: ' + decryptedCipherText);