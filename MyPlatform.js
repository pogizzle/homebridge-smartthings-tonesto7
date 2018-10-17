const {
    pluginName,
    platformName,
    knownCapabilities
} = require("./constants");
const http = require('http');
const os = require('os');
var myClientApi = require('./lib/myClientApi');
var MyAccessory = require('./devices/MyAccessory');

module.exports = class MyPlatform {
    constructor(log, config, api) {
        if (!config) {
            log("Plugin not configured.");
            return;
        }
        this.config = config;
        this.api = api;

        this.log = log;
        this.deviceLookup = {};
        this.firstpoll = true;
        this.attributeLookup = {};

        this.temperature_unit = 'F';

        myClientApi = new myClientApi(this.config, this.log);
        MyAccessory = new MyAccessory(this.api.Accessory, this.api.Service, this.api.Characteristic, this.api.uuid);

        this.app_url = config['app_url'];
        this.app_id = config['app_id'];
        this.access_token = config['access_token'];
        this.excludedCapabilities = config["excluded_capabilities"] || [];

        // This is how often it does a full refresh
        this.polling_seconds = config['polling_seconds'];
        // Get a full refresh every hour.
        if (!this.polling_seconds) {
            this.polling_seconds = 3600;
        }

        // This is how often it polls for subscription data.
        this.update_method = config['update_method'];
        if (!this.update_method) {
            this.update_method = 'direct';
        }

        this.local_commands = false;
        this.local_hub_ip = undefined;

        this.update_seconds = config['update_seconds'];
        // 30 seconds is the new default
        if (!this.update_seconds) {
            this.update_seconds = 30;
        }
        if (this.update_method === 'api' && this.update_seconds < 30) {
            this.log('The setting for update_seconds is lower than the ' + platformName + ' recommended value. Please switch to direct or PubNub using a free subscription for real-time updates.');
        }
        this.direct_port = config['direct_port'];
        if (this.direct_port === undefined || this.direct_port === '') {
            this.direct_port = (platformName === 'SmartThings' ? 8000 : 8005);
        }

        this.direct_ip = config['direct_ip'];
        if (this.direct_ip === undefined || this.direct_ip === '') {
            this.direct_ip = getIPAddress();
        }
    }
    reloadData(callback) {
        var that = this;
        // that.log('config: ', JSON.stringify(this.config));
        var foundAccessories = [];
        that.log.debug('Refreshing All Device Data');
        myClientApi.getDevices(function(myList) {
            that.log.debug('Received All Device Data');
            // success
            if (myList && myList.deviceList && myList.deviceList instanceof Array) {
                var populateDevices = function(devices) {
                    for (var i = 0; i < devices.length; i++) {
                        var device = devices[i];
                        device.excludedCapabilities = that.excludedCapabilities[device.deviceid] || ["None"];
                        var accessory;
                        if (that.deviceLookup[device.deviceid]) {
                            accessory = that.deviceLookup[device.deviceid];
                            accessory.loadData(devices[i]);
                        } else {
                            accessory = new MyAccessory(that, device);
                            // that.log(accessory);
                            if (accessory !== undefined) {
                                if (accessory.services.length <= 1 || accessory.deviceGroup === 'unknown') {
                                    if (that.firstpoll) {
                                        that.log('Device Skipped - Group ' + accessory.deviceGroup + ', Name ' + accessory.name + ', ID ' + accessory.deviceid + ', JSON: ' + JSON.stringify(device));
                                    }
                                } else {
                                    // that.log("Device Added - Group " + accessory.deviceGroup + ", Name " + accessory.name + ", ID " + accessory.deviceid); //+", JSON: "+ JSON.stringify(device));
                                    that.deviceLookup[accessory.deviceid] = accessory;
                                    foundAccessories.push(accessory);
                                }
                            }
                        }
                    }
                };
                if (myList && myList.location) {
                    that.temperature_unit = myList.location.temperature_scale;
                    if (myList.location.hubIP) {
                        that.local_hub_ip = myList.location.hubIP;
                        myClientApi.updateGlobals(that.local_hub_ip, that.local_commands);
                    }
                }
                populateDevices(myList.deviceList);
            } else if (!myList || !myList.error) {
                that.log('Invalid Response from API call');
            } else if (myList.error) {
                that.log('Error received type ' + myList.type + ' - ' + myList.message);
            } else {
                that.log('Invalid Response from API call');
            }
            if (callback) callback(foundAccessories);
            that.firstpoll = false;
        });
    }
    accessories(callback) {
        this.log('Fetching ' + platformName + ' devices.');

        var that = this;
        // var foundAccessories = [];
        this.deviceLookup = [];
        this.unknownCapabilities = [];
        this.knownCapabilities = knownCapabilities;
        if (platformName === 'Hubitat' || platformName === 'hubitat') {
            let newList = [];
            for (const item in this.knownCapabilities) {
                newList.push(this.knownCapabilities[item].replace(/ /g, ''));
            }
            this.knownCapabilities = newList;
        }

        // myClientApi.init(this.app_url, this.app_id, this.access_token, this.local_hub_ip, this.local_commands);
        this.reloadData(function(foundAccessories) {
            that.log('Unknown Capabilities: ' + JSON.stringify(that.unknownCapabilities));
            callback(foundAccessories);
            that.log('update_method: ' + that.update_method);
            setInterval(that.reloadData.bind(that), that.polling_seconds * 1000);
            // Initialize Update Mechanism for realtime-ish updates.
            if (that.update_method === 'api') {
                setInterval(that.doIncrementalUpdate.bind(that), that.update_seconds * 1000);
            } else if (that.update_method === 'direct') {
                // The Hub sends updates to this module using http
                mySetupHTTPServer(that);
                myClientApi.startDirect(null, that.direct_ip, that.direct_port);
            }
        });
    }
    addAttributeUsage(attribute, deviceid, mycharacteristic) {
        if (!this.attributeLookup[attribute]) {
            this.attributeLookup[attribute] = {};
        }
        if (!this.attributeLookup[attribute][deviceid]) {
            this.attributeLookup[attribute][deviceid] = [];
        }
        this.attributeLookup[attribute][deviceid].push(mycharacteristic);
    }

    doIncrementalUpdate() {
        var that = this;
        myClientApi.getUpdates(function(data) {
            that.processIncrementalUpdate(data, that);
        });
    }

    processIncrementalUpdate(data, that) {
        that.log('new data: ' + data);
        if (data && data.attributes && data.attributes instanceof Array) {
            for (var i = 0; i < data.attributes.length; i++) {
                that.processFieldUpdate(data.attributes[i], that);
            }
        }
    }

    processFieldUpdate(attributeSet, that) {
        // that.log("Processing Update");
        // that.log(attributeSet);
        if (!(that.attributeLookup[attributeSet.attribute] && that.attributeLookup[attributeSet.attribute][attributeSet.device])) {
            return;
        }
        var myUsage = that.attributeLookup[attributeSet.attribute][attributeSet.device];
        if (myUsage instanceof Array) {
            for (var j = 0; j < myUsage.length; j++) {
                var accessory = that.deviceLookup[attributeSet.device];
                if (accessory) {
                    accessory.device.attributes[attributeSet.attribute] = attributeSet.value;
                    myUsage[j].getValue();
                }
            }
        }
    }
};

function getIPAddress() {
    var interfaces = os.networkInterfaces();
    for (var devName in interfaces) {
        var iface = interfaces[devName];
        for (var i = 0; i < iface.length; i++) {
            var alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '0.0.0.0';
}

function mySetupHTTPServer(myApi) {
    // Get the IP address that we will send to the SmartApp. This can be overridden in the config file.
    let ip = myApi.direct_ip || getIPAddress();
    // Start the HTTP Server
    const server = http.createServer(function(request, response) {
        myHandleHTTPResponse(request, response, myApi);
    });

    server.listen(myApi.direct_port, err => {
        if (err) {
            myApi.log('something bad happened', err);
            return '';
        }
        myApi.log(`Direct Connect Is Listening On ${ip}:${myApi.direct_port}`);
    });
    return 'good';
}

function myHandleHTTPResponse(request, response, myApi) {
    if (request.url === '/restart') {
        let delay = (10 * 1000);
        myApi.log('Received request from ' + platformName + ' to restart homebridge service in (' + (delay / 1000) + ' seconds) | NOTICE: If you using PM2 or Systemd the Homebridge Service should start back up');
        setTimeout(function() {
            process.exit(1);
        }, parseInt(delay));
    }
    if (request.url === '/updateprefs') {
        myApi.log(platformName + ' Hub Sent Preference Updates');
        let body = [];
        request.on('data', (chunk) => {
            body.push(chunk);
        }).on('end', () => {
            body = Buffer.concat(body).toString();
            let data = JSON.parse(body);
            let sendUpd = false;
            if (platformName === 'SmartThings') {
                if (data.local_commands && myApi.local_commands !== data.local_commands) {
                    sendUpd = true;
                    myApi.log(platformName + ' Updated Local Commands Preference | Before: ' + myApi.local_commands + ' | Now: ' + data.local_commands);
                    myApi.local_commands = data.local_commands;
                }
                if (data.local_hub_ip && myApi.local_hub_ip !== data.local_hub_ip) {
                    sendUpd = true;
                    myApi.log(platformName + ' Updated Hub IP Preference | Before: ' + myApi.local_hub_ip + ' | Now: ' + data.local_hub_ip);
                    myApi.local_hub_ip = data.local_hub_ip;
                }
            }
            if (sendUpd) {
                myApi.updateGlobals(myApi.local_hub_ip, myApi.local_commands);
            }
        });
    }
    if (request.url === '/initial') {
        myApi.log(platformName + ' Hub Communication Established');
    }
    if (request.url === '/update') {
        let body = [];
        request.on('data', (chunk) => {
            body.push(chunk);
        }).on('end', () => {
            body = Buffer.concat(body).toString();
            let data = JSON.parse(body);
            if (Object.keys(data).length > 3) {
                var newChange = {
                    device: data.change_device,
                    attribute: data.change_attribute,
                    value: data.change_value,
                    date: data.change_date
                };
                myApi.log('Change Event:', '(' + data.change_name + ') [' + (data.change_attribute ? data.change_attribute.toUpperCase() : 'unknown') + '] is ' + data.change_value);
                myApi.processFieldUpdate(newChange, myApi);
            }
        });
    }
    response.end('OK');
}