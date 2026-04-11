// src/main/compCodec.js
"use strict";

// Re-export comp codec from @axiapps/code package.
// The app uses encodeComp/decodeComp names; the package uses encodeCompCode/decodeCompCode.
const { encodeCompCode, decodeCompCode, isValidCompCode } = require("@axiapps/code");

module.exports = {
  isValidCompCode,
  encodeComp: encodeCompCode,
  decodeComp: decodeCompCode,
};
