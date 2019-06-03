'use strict';

const request = require('request'),
    crypto = require('crypto'),
    _ = require('underscore');

class DigestRequest {

    constructor(username, password) {
        this.username = username;
        this.password = password;
    }

    request(host, port, path, method, data = {}, callback) {
        let options = {
            url: 'https://' + host + ':' + port + path,
            method: method,
            body: data,
            json: true,
            strictSSL: false,
            debug: false,
        };

        request(options, (error, response, data) => {
            if (typeof response !== "undefined" && typeof response.headers['www-authenticate'] !== "undefined") {

                let digestHeader = DigestRequest.parseDigestHeader(response.headers['www-authenticate']),
                    nonceCount = DigestRequest.generateNC(),
                    cnonce = DigestRequest.generateCNONCE(),
                    digest = DigestRequest.getDigestParams(
                        this.username,
                        this.password,
                        digestHeader.realm,
                        path,
                        digestHeader.domain,
                        digestHeader.nonce,
                        method,
                        nonceCount,
                        cnonce,
                        digestHeader.qop
                    );

                options.headers = {'Authorization': this.renderDigest(digest)}

                request(options, callback);
            } else {
                callback(error, response, data);
            }
        });
    }

    static getDigestParams(username, password, realm, uri, domain, nonce, method, nonceCount, cnonce, qop) {
        let ha1 = DigestRequest.md5(username + ':' + realm + ':' + password),
            ha2 = DigestRequest.md5(method + ':' + uri),
            response = DigestRequest.md5(ha1 + ':' + nonce + ':' + nonceCount + ':' + cnonce + ':' + qop + ':' + ha2);

        return {
            username: username,
            realm: realm,
            nonce: nonce,
            uri: uri,
            algorithm: "MD5",
            qop: qop,
            nc: nonceCount,
            cnonce: cnonce,
            response: response
        }
    }

    static parseDigestHeader(header) {
        return _(header.substring(7).split(/,\s+/)).reduce(function (obj, s) {
            let key = s.substr(0, s.indexOf('=')),
                value = s.substr(s.indexOf('=') + 1);

            obj[key] = value.replace(/"/g, '')
            return obj
        }, {})
    }

    renderDigest(params) {
        var s = _(_.keys(params)).reduce(function (s1, ii) {
            return s1 + ', ' + ii + '="' + params[ii] + '"'
        }, '')
        return 'Digest ' + s.substring(2);
    }

    static md5(data) {
        return crypto.createHash('md5').update(data).digest("hex");
    }

    static generateCNONCE() {
        return DigestRequest.md5(Math.random().toString(36)).substr(0, 8);
    }

    static generateNC() {
        return '00000001';
    }
}

module.exports = DigestRequest;