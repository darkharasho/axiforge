"use strict";
const crypto = require("node:crypto");
const zlib = require("node:zlib");

function slugifyBuildName(name) {
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "build";
}

function generateFileId() { return crypto.randomBytes(4).toString("hex"); }

function generateEncryptionKey() { return crypto.randomBytes(32).toString("base64url"); }

function encryptBuild(buildData, base64urlKey) {
  const key = Buffer.from(base64urlKey, "base64url");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(buildData), "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64");
}

function decryptBuild(base64Payload, base64urlKey) {
  const key = Buffer.from(base64urlKey, "base64url");
  const combined = Buffer.from(base64Payload, "base64");
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(combined.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return JSON.parse(Buffer.concat([decipher.update(combined.subarray(12, combined.length - 16)), decipher.final()]).toString("utf8"));
}

// v2 envelope: 4-byte header, then IV | AES-256-GCM(gzip(JSON)) | tag, as raw
// bytes. The header sits outside the cipher so a reader knows the format before
// decrypting. A v1 file is base64 text, whose first byte can never be 0x00.
const PAYLOAD_MAGIC = [0x00, 0x41, 0x58]; // "\0AX"
const PAYLOAD_VERSION = 2;

class PayloadVersionError extends Error {
  constructor(version) {
    super(`Unsupported payload version ${version}`);
    this.name = "PayloadVersionError";
    this.version = version;
  }
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

function payloadVersion(input) {
  if (typeof input === "string") return 1;
  const b = toBuffer(input);
  if (b.length >= 4 && b[0] === PAYLOAD_MAGIC[0] && b[1] === PAYLOAD_MAGIC[1] && b[2] === PAYLOAD_MAGIC[2]) return b[3];
  return 1;
}

function encryptPayload(data, base64urlKey) {
  const key = Buffer.from(base64urlKey, "base64url");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(data), "utf8"), { level: 9 });
  const encrypted = Buffer.concat([cipher.update(packed), cipher.final()]);
  return Buffer.concat([Buffer.from([...PAYLOAD_MAGIC, PAYLOAD_VERSION]), iv, encrypted, cipher.getAuthTag()]);
}

function decryptPayload(input, base64urlKey) {
  const version = payloadVersion(input);
  if (version === 1) {
    const text = typeof input === "string" ? input : toBuffer(input).toString("utf8");
    return decryptBuild(text.trim(), base64urlKey);
  }
  if (version !== PAYLOAD_VERSION) throw new PayloadVersionError(version);
  const b = toBuffer(input);
  const key = Buffer.from(base64urlKey, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(4, 16));
  decipher.setAuthTag(b.subarray(b.length - 16));
  const packed = Buffer.concat([decipher.update(b.subarray(16, b.length - 16)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(packed).toString("utf8"));
}

function getDefaultBuildName(specializations, profession) {
  const elite = (specializations || []).find((s) => s?.elite);
  if (elite?.name) return elite.name;
  if (profession) return `Core ${profession}`;
  return "Build";
}

module.exports = { slugifyBuildName, generateFileId, generateEncryptionKey, encryptBuild, decryptBuild, getDefaultBuildName, encryptPayload, decryptPayload, payloadVersion, PayloadVersionError, PAYLOAD_VERSION };
