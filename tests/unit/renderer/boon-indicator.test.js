"use strict";

const { meterValue } = require("../../../src/renderer/modules/comps/boon-indicator.js");

describe("meterValue", () => {
  it("clamps to 0..100 and formats as a percentage", () => {
    expect(meterValue(0)).toBe("0%");
    expect(meterValue(63)).toBe("63%");
    expect(meterValue(100)).toBe("100%");
  });

  it("clamps out-of-range input rather than emitting it", () => {
    // A width over 100% on a flex fill overflows its track and paints over
    // the outline, so the bar reads as full AND broken.
    expect(meterValue(140)).toBe("100%");
    expect(meterValue(-10)).toBe("0%");
  });

  it("never emits NaN, which renders as a full bar in some engines", () => {
    for (const v of [NaN, undefined, null, "", "abc", {}]) {
      expect(meterValue(v)).toBe("0%");
    }
  });
});
