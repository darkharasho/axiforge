"use strict";
const crypto = require("node:crypto");

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

function getDefaultBuildName(specializations, profession) {
  const elite = (specializations || []).find((s) => s?.elite);
  if (elite?.name) return elite.name;
  if (profession) return `Core ${profession}`;
  return "Build";
}

module.exports = { slugifyBuildName, generateFileId, generateEncryptionKey, encryptBuild, decryptBuild, getDefaultBuildName };
