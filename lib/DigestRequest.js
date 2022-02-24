'use strict';

const http = require('http.min'),
    crypto = require('crypto');

class DigestRequest {

    constructor(username, password) {
        this.username = username;
        this.password = password;
		this.servers = [];
    }

    request(host, port, path, method, data = {}, callback, retried = false) {
        let options = {
			protocol: 'https:',
			hostname: host,
			port: port,
			path: path,
			rejectUnauthorized: false,
        };
		
		const authHeader = this.getAuthHeader(path, method);
		if(authHeader) {
			options.headers = {'Authorization': authHeader};
		}

		http[method](options, data).then((res) => {
			let resData = res.data ? res.data : '{}';
			const response = res.response;
            if (typeof response.headers['www-authenticate'] !== "undefined") {
				if(retried) {
					console.log('Authention failed for request', method, path);
					callback(`Authention failed for ${method} request: ${path}`);
					return false;
				}

				// Reset nonceCount
				this.nonceCount = 0;
				this.digestHeader = DigestRequest.parseDigestHeader(response.headers['www-authenticate']);

               this.request(host, port, path, method, data, callback, true);
            } else {
				try {
					resData = JSON.parse(resData)
					callback(null, response, resData);
				} catch(error) {
					console.log('HTTP Digest Request [invalid json]:', path, error, resData);
					callback(error, response, resData);
				}
			}
            
        }).catch((error) => {
			console.log('HTTP Digest Request failed', path, error);
			callback(error);
		});
    }

	getAuthHeader(path, method) {
		 if(!this.digestHeader) {
			return false;
		} 

		const digest = DigestRequest.getDigestParams(
			this.username,
			this.password,
			this.digestHeader.realm,
			path,
			this.digestHeader.domain,
			this.digestHeader.nonce,
			method.toUpperCase(),
			this.generateNC(),
			DigestRequest.generateCNONCE(),
			this.digestHeader.qop
		);

		return this.renderDigest(digest);
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
        return header.substring(7).split(/,\s+/).reduce(function (obj, s) {
            let key = s.substr(0, s.indexOf('=')),
                value = s.substr(s.indexOf('=') + 1);

            obj[key] = value.replace(/"/g, '')
            return obj
        }, {})
    }

    renderDigest(params) {
        var s = Object.keys(params).reduce(function (s1, ii) {
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

    generateNC() {
		return String(++this.nonceCount).padStart(8, '0');
    }
}

module.exports = DigestRequest;