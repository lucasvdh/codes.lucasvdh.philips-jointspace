"use strict";

const crypto = require('crypto');

module.exports = {
    sign(base64EncodedKey, code) {
        const key = Buffer.from(base64EncodedKey, 'base64'),
            hmac = crypto.createHmac('sha1', key);

        hmac.write(code);
        hmac.end();

        return hmac.read('binary').toString('base64');
    }
};