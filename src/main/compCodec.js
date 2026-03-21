// src/main/compCodec.js
"use strict";

// Re-export comp codec from @mks.haro/axicode package.
// The app uses encodeComp/decodeComp names; the package uses encodeCompCode/decodeCompCode.
const { encodeCompCode, decodeCompCode, isValidCompCode } = require("@mks.haro/axicode");

module.exports = {
  isValidCompCode,
  encodeComp: encodeCompCode,
  decodeComp: decodeCompCode,
};
