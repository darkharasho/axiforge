"use strict";

class BitWriter {
  constructor() {
    this._bytes = [];
    this._currentByte = 0;
    this._bitPos = 7; // MSB first, counts down from 7 to 0
  }

  write(value, numBits) {
    for (let i = numBits - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      this._currentByte |= bit << this._bitPos;
      this._bitPos--;
      if (this._bitPos < 0) {
        this._bytes.push(this._currentByte);
        this._currentByte = 0;
        this._bitPos = 7;
      }
    }
  }

  toBytes() {
    const out = [...this._bytes];
    if (this._bitPos < 7) out.push(this._currentByte); // flush partial byte
    return new Uint8Array(out);
  }

  toPaddedBytes(alignment) {
    const bytes = this.toBytes();
    const remainder = bytes.length % alignment;
    if (remainder === 0) return bytes;
    const padded = new Uint8Array(bytes.length + (alignment - remainder));
    padded.set(bytes);
    return padded;
  }
}

class BitReader {
  constructor(buffer) {
    this._buffer = buffer;
    this._bytePos = 0;
    this._bitPos = 7;
  }

  read(numBits) {
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      if (this._bytePos >= this._buffer.length) {
        throw new Error("Read past end of buffer");
      }
      const bit = (this._buffer[this._bytePos] >> this._bitPos) & 1;
      value = (value << 1) | bit;
      this._bitPos--;
      if (this._bitPos < 0) {
        this._bytePos++;
        this._bitPos = 7;
      }
    }
    return value;
  }

  bitsRemaining() {
    const totalBits = this._buffer.length * 8;
    const consumed = this._bytePos * 8 + (7 - this._bitPos);
    return totalBits - consumed;
  }
}

module.exports = { BitWriter, BitReader };
