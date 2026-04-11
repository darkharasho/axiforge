"use strict";

// Z85 alphabet per ZeroMQ RFC 32
const Z85_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
const Z85_DECODE = new Uint8Array(128);
for (let i = 0; i < 85; i++) Z85_DECODE[Z85_CHARS.charCodeAt(i)] = i;

// Divisors for base-85 encoding of a 32-bit value
const DIVISORS = [85 * 85 * 85 * 85, 85 * 85 * 85, 85 * 85, 85, 1];

function z85Encode(buffer) {
  if (buffer.length % 4 !== 0) {
    throw new Error("Z85 input must be a multiple of 4 bytes");
  }
  let out = "";
  for (let i = 0; i < buffer.length; i += 4) {
    let value = ((buffer[i] << 24) | (buffer[i + 1] << 16) | (buffer[i + 2] << 8) | buffer[i + 3]) >>> 0;
    for (let j = 0; j < 5; j++) {
      const idx = Math.floor(value / DIVISORS[j]) % 85;
      out += Z85_CHARS[idx];
    }
  }
  return out;
}

function z85Decode(str) {
  if (str.length % 5 !== 0) {
    throw new Error("Z85 string must be a multiple of 5 characters");
  }
  const out = new Uint8Array((str.length / 5) * 4);
  for (let i = 0, byteIdx = 0; i < str.length; i += 5, byteIdx += 4) {
    let value = 0;
    for (let j = 0; j < 5; j++) {
      value = value * 85 + Z85_DECODE[str.charCodeAt(i + j)];
    }
    out[byteIdx]     = (value >>> 24) & 0xFF;
    out[byteIdx + 1] = (value >>> 16) & 0xFF;
    out[byteIdx + 2] = (value >>> 8)  & 0xFF;
    out[byteIdx + 3] =  value         & 0xFF;
  }
  return out;
}

module.exports = { z85Encode, z85Decode };
