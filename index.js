const globals = require('./constants');

const pluginName = globals.pluginName;
const platformName = globals.platformName;
const knownCapabilities = globals.knownCapabilities;

const MyPlatform = require("./myPlatform");

module.exports = function(homebridge) {
    console.log("Homebridge Version: " + homebridge.version);
    homebridge.registerPlatform(pluginName, platformName, MyPlatform, true);
};