const { platformName } = require("../constants");
const http = (platformName === 'SmartThings') ? require('https') : require('http');
const reqPromise = require('request-promise');
const url = require('url');
var app_host, app_port, app_path, access_token, localHubIp, useLocalCmds;

module.exports = class myClientApi {
    constructor({ config, log }) {
        this.config = config;
        this.log = log;
        useLocalCmds = (this.config.local_commands === true);
        localHubIp = this.config.local_hub_ip;
        var appURL = url.parse(this.config.app_url);
        if (platformName === 'SmartThings') {
            app_host = appURL.hostname || "graph.api.smartthings.com";
            app_port = appURL.port || 443;
            app_path = (appURL.path || "/api/smartapps/installations/") + this.config.app_id + "/";
        } else {
            app_host = appURL.hostname;
            app_port = appURL.port || 80;
            app_path = appURL.path;
        }
        access_token = this.config.access_token;
    }
    init(inURL, inAppID, inAccess_Token, hubIp, useLocal = false) {
        useLocalCmds = (useLocal === true);
        localHubIp = hubIp;
        var appURL = url.parse(inURL);
        if (platformName === 'SmartThings') {
            app_host = appURL.hostname || "graph.api.smartthings.com";
            app_port = appURL.port || 443;
            app_path = (appURL.path || "/api/smartapps/installations/") + inAppID + "/";
        } else {
            app_host = appURL.hostname;
            app_port = appURL.port || 80;
            app_path = appURL.path;
        }
        access_token = inAccess_Token;
    }
    updateGlobals(hubIp, useLocal = false) {
        localHubIp = hubIp;
        useLocalCmds = (useLocal === true);
    }
    getDevices(callback) {
        this.GET({
            debug: false,
            path: 'devices'
        }, function(data) {
            if (callback) {
                callback(data);
                callback = undefined;
            };
        });
    }
    getDevice(deviceid, callback) {
        this.GET({
            debug: false,
            path: deviceid + '/query'
        }, function(data) {
            if (data) {
                if (callback) {
                    callback(data);
                    callback = undefined;
                };
            } else {
                if (callback) {
                    callback();
                    callback = undefined;
                };
            }
        });
    }
    getUpdates(callback) {
        this.GET({
            debug: false,
            path: 'getUpdates'
        }, function(data) {
            if (callback) {
                callback(data);
                callback = undefined;
            };
        });
    }
    runCommand(callback, deviceid, command, values) {
        console.log("[" + platformName + " Plugin Action] Command: " + command + " | Value: " + (values !== undefined ? JSON.stringify(values) : "Nothing") + " | DeviceID: (" + deviceid + ") | local_cmd: " + useLocalCmds);
        let useLocal = (useLocalCmds === true && localHubIp !== undefined);
        let config = {};
        if (useLocal === true) {
            config = {
                debug: true,
                uri: 'http://' + localHubIp + ':39500/event',
                body: {
                    deviceid: deviceid,
                    command: command,
                    values: values
                },
                headers: {
                    evtSource: 'Homebridge_tonesto7',
                    evtType: 'hkCommand'
                },
                useLocal: true
            };
        } else {
            config = {
                debug: false,
                path: deviceid + '/command/' + command,
                data: values
            };
        }
        this.POST(config, function() {
            if (callback) {
                callback();
                callback = undefined;
            };
        });
    }
    startDirect(callback, myIP, myPort) {
        let useLocal = (useLocalCmds === true && localHubIp !== undefined);
        if (useLocal) {
            this.POST({
                debug: true,
                uri: 'http://' + localHubIp + ':39500/event',
                body: {
                    ip: myIP,
                    port: myPort
                },
                headers: {
                    evtSource: 'Homebridge_tonesto7',
                    evtType: 'enableDirect'
                },
                useLocal: true
            }, function() {
                if (callback) {
                    callback();
                    callback = undefined;
                };
            });
        } else {
            this.GET({
                debug: false,
                path: 'startDirect/' + myIP + '/' + myPort
            }, function() {
                if (callback) {
                    callback();
                    callback = undefined;
                };
            });
        }
    }
    getSubscriptionService(callback) {
        this.GET({
            debug: false,
            path: 'getSubcriptionService'
        }, function(data) {
            if (callback) {
                callback(data);
                callback = undefined;
            };
        });
    }

    _http(data, callback) {
        //console.log("Calling " + platformName);
        var options = {
            hostname: app_host,
            port: app_port,
            path: app_path + data.path + "?access_token=" + access_token,
            method: data.method,
            headers: {}
        };
        if (data.data) {
            data.data = JSON.stringify(data.data);
            options.headers['Content-Length'] = Buffer.byteLength(data.data);
            options.headers['Content-Type'] = "application/json";
        }
        if (data.debug) {
            console.log('_http options: ', JSON.stringify(options));
        }
        var str = '';
        var req = http.request(options, function(response) {
            response.on('data', function(chunk) {
                str += chunk;
            });

            response.on('end', function() {
                if (data.debug) {
                    console.log("response in http:", str);
                }
                try {
                    str = JSON.parse(str);
                } catch (e) {
                    if (data.debug) {
                        console.log(e.stack);
                        console.log("raw message", str);
                    }
                    str = undefined;
                }

                if (callback) {
                    callback(str);
                    callback = undefined;
                };
            });
        });

        if (data.data) {
            req.write(data.data);
        }

        req.end();

        req.on('error', function(e) {
            console.log("error at req: ", e.message);
            if (callback) {
                callback();
                callback = undefined;
            };
        });
    }

    _httpLocalPost(data, callback) {
        let options = {
            method: data.method,
            uri: data.uri,
            headers: data.headers || {},
            body: data.body || {},
            json: true
        };
        reqPromise(options)
            .then(function(body) {
                if (callback) {
                    callback(body);
                    callback = undefined;
                };
            })
            .catch(function(err) {
                console.log("reqPromise Error: ", err.message);
                if (callback) {
                    callback();
                    callback = undefined;
                };
            });
    }

    POST(data, callback) {
        data.method = "POST";
        if (data.useLocal === true) {
            this._httpLocalPost(data, callback);
        } else {
            this._http(data, callback);
        }
    }

    GET(data, callback) {
        data.method = "GET";
        this._http(data, callback);
    }

};