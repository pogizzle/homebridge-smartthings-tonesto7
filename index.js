const globals = require('./constants');

const pluginName = globals.pluginName;
const platformName = globals.platformName;
const knownCapabilities = globals.knownCapabilities;

const MyPlatform = require("./MyPlatform");
console.log('platformName: ' + platformName);
console.log('pluginName: ' + pluginName);

module.exports = function(homebridge) {
    console.log("Homebridge Version: " + homebridge.version);
    homebridge.registerPlatform(pluginName, platformName, MyPlatform, true);
};