"use strict";
const { z85Encode, z85Decode } = require("../../src/main/z85");

describe("z85Encode / z85Decode", () => {
  test("round-trip 4 bytes", () => {
    const input = Buffer.from([0x86, 0x4F, 0xD2, 0x6F]);
    const encoded = z85Encode(input);
    expect(encoded.length).toBe(5); // 4 bytes → 5 chars
    expect(z85Decode(encoded)).toEqual(input);
  });

  test("round-trip 8 bytes", () => {
    const input = Buffer.from([0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B]);
    const encoded = z85Encode(input);
    expect(encoded.length).toBe(10);
    expect(z85Decode(encoded)).toEqual(input);
  });

  test("encodes RFC 32 test vector", () => {
    // RFC 32 example: binary frame → "HelloWorld"
    const input = Buffer.from([0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B]);
    expect(z85Encode(input)).toBe("HelloWorld");
  });

  test("rejects input not multiple of 4 bytes", () => {
    expect(() => z85Encode(Buffer.from([1, 2, 3]))).toThrow();
  });

  test("rejects encoded string not multiple of 5 chars", () => {
    expect(() => z85Decode("Hell")).toThrow();
  });

  test("round-trip all zeros", () => {
    const input = Buffer.alloc(8, 0);
    expect(z85Decode(z85Encode(input))).toEqual(input);
  });

  test("round-trip all 0xFF", () => {
    const input = Buffer.alloc(8, 0xFF);
    expect(z85Decode(z85Encode(input))).toEqual(input);
  });
});
