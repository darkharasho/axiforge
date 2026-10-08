"use strict";

// Node's web globals, made explicit so the test doesn't depend on which ones
// Jest's node environment happens to expose.
const web = require("node:stream/web");
globalThis.DecompressionStream ??= web.DecompressionStream;
globalThis.crypto ??= require("node:crypto").webcrypto;

const { encryptPayload, encryptBuild, generateEncryptionKey } = require("../../../src/main/buildEncryption");
const { decodePayload, fetchPayload, payloadVersion, PayloadVersionError, assertCompFormat, loadErrorMessage, NEWER_FORMAT_MESSAGE } = require("../../../src/site/payload.js");

const key = generateEncryptionKey();
const data = { title: "Firebrand", catalogSkills: [{ id: 1, name: "Mantra" }] };
const asArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

describe("viewer payload decode", () => {
  test("decodes a v2 file written by the desktop", async () => {
    await expect(decodePayload(asArrayBuffer(encryptPayload(data, key)), key)).resolves.toEqual(data);
  });

  test("decodes a v1 base64 file, including a trailing newline", async () => {
    const v1 = Buffer.from(`${encryptBuild(data, key)}\n`, "utf8");
    expect(payloadVersion(new Uint8Array(v1))).toBe(1);
    await expect(decodePayload(asArrayBuffer(v1), key)).resolves.toEqual(data);
  });

  test("an unknown version throws PayloadVersionError", async () => {
    const bytes = encryptPayload(data, key);
    bytes[3] = 0x03;
    await expect(decodePayload(asArrayBuffer(bytes), key)).rejects.toBeInstanceOf(PayloadVersionError);
  });

  test("fetchPayload reads bytes and surfaces HTTP status", async () => {
    const ok = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(encryptPayload(data, key)) }));
    await expect(fetchPayload("https://x/builds/a.enc", key, ok)).resolves.toEqual(data);
    expect(ok).toHaveBeenCalledWith("https://x/builds/a.enc", { cache: "no-store" });

    const missing = jest.fn(async () => ({ ok: false, status: 404 }));
    await expect(fetchPayload("https://x/builds/b.enc", key, missing)).rejects.toMatchObject({ status: 404 });
  });
});

describe("comp format version", () => {
  test("the viewer reads up to the format the desktop writes", () => {
    const site = require("../../../src/site/payload.js");
    expect(site.COMP_FORMAT_VERSION).toBe(require("../../../src/main/compPublish").COMP_FORMAT_VERSION);
  });

  test("v1 (no v) and v2 comps are readable", () => {
    expect(() => assertCompFormat({ name: "Old" })).not.toThrow();
    expect(() => assertCompFormat({ v: 2, members: {} })).not.toThrow();
  });

  test("a comp newer than v2 throws PayloadVersionError, which the page shows as NEWER_FORMAT_MESSAGE", () => {
    expect(() => assertCompFormat({ v: 3 })).toThrow(PayloadVersionError);
    let err;
    try { assertCompFormat({ v: 3 }); } catch (e) { err = e; }
    expect(loadErrorMessage(err, "Comp")).toBe(NEWER_FORMAT_MESSAGE);
  });

  test("loadErrorMessage keeps HTTP and plain errors", () => {
    expect(loadErrorMessage({ status: 404 }, "Comp")).toBe("Comp not found (HTTP 404)");
    expect(loadErrorMessage(new Error("boom"), "Build")).toBe("boom");
  });
});
