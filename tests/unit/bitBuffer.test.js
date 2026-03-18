"use strict";
const { BitWriter, BitReader } = require("../../src/main/bitBuffer");

describe("BitWriter", () => {
  test("writes and reads back single bits", () => {
    const w = new BitWriter();
    w.write(1, 1); // 1
    w.write(0, 1); // 0
    w.write(1, 1); // 1
    const r = new BitReader(w.toBytes());
    expect(r.read(1)).toBe(1);
    expect(r.read(1)).toBe(0);
    expect(r.read(1)).toBe(1);
  });

  test("writes multi-bit values", () => {
    const w = new BitWriter();
    w.write(5, 4);   // 0101 in 4 bits
    w.write(255, 8);  // 11111111
    w.write(0, 3);    // 000
    const r = new BitReader(w.toBytes());
    expect(r.read(4)).toBe(5);
    expect(r.read(8)).toBe(255);
    expect(r.read(3)).toBe(0);
  });

  test("handles 17-bit skill IDs", () => {
    const w = new BitWriter();
    w.write(80000, 17);
    w.write(12345, 17);
    w.write(0, 17);
    const r = new BitReader(w.toBytes());
    expect(r.read(17)).toBe(80000);
    expect(r.read(17)).toBe(12345);
    expect(r.read(17)).toBe(0);
  });

  test("toBytes pads to byte boundary", () => {
    const w = new BitWriter();
    w.write(7, 3); // 3 bits → should pad to 1 byte
    const bytes = w.toBytes();
    expect(bytes.length).toBe(1);
  });

  test("toPaddedBytes pads to 4-byte boundary", () => {
    const w = new BitWriter();
    w.write(1, 1); // 1 bit → pad to 4 bytes
    const bytes = w.toPaddedBytes(4);
    expect(bytes.length).toBe(4);
  });
});

describe("BitReader", () => {
  test("throws on read past end", () => {
    const r = new BitReader(Buffer.from([0xFF]));
    r.read(8);
    expect(() => r.read(1)).toThrow();
  });

  test("bitsRemaining reports correctly", () => {
    const r = new BitReader(Buffer.from([0xFF, 0xFF]));
    expect(r.bitsRemaining()).toBe(16);
    r.read(5);
    expect(r.bitsRemaining()).toBe(11);
  });
});
