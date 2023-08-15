"use strict";

const crypto = require('crypto');

module.exports = {
    getAlgorithm(keyBase64) {
        var key = Buffer.from(keyBase64, 'base64');
        switch (key.length) {
            case 16:
                return 'aes-128-cbc';
            case 32:
                return 'aes-256-cbc';
        }
        throw new Error('Invalid key length: ' + key.length);
    },
    encrypt(keyBase64, ivBase64, data) {
        const key = Buffer.from(keyBase64, 'base64');
        const iv = Buffer.from(ivBase64, 'base64');
        const cipher = crypto.createCipheriv(this.getAlgorithm(keyBase64), key, iv);
        let encrypted = cipher.update(data, 'utf8', 'base64')
        encrypted += cipher.final('base64');
        return encrypted;
    },
    decrypt(keyBase64, ivBase64, encryptedDataBase64, throwError = false) {
        try {
            const key = Buffer.from(keyBase64, 'base64');
            const iv = Buffer.from(ivBase64, 'base64');
            const decipher = crypto.createDecipheriv(this.getAlgorithm(keyBase64), key, iv);
            decipher.update(encryptedDataBase64, 'base64');
            return decipher.final().toString('utf8');
        } catch (e) {
            if (throwError) {
                throw e;
            }
        }
        return null;
    }
};
