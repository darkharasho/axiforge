"use strict";

const { meterValue, tickRun } = require("../../../src/renderer/modules/comps/boon-indicator.js");

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

describe("tickRun", () => {
  it("emits one mark per event, inked for the true ones", () => {
    const html = tickRun([true, false, true]);
    expect(html.match(/axi-ticks__tick(?!--)/g)).toHaveLength(3);
    expect(html.match(/axi-ticks__tick--on/g)).toHaveLength(2);
  });

  it("renders an empty run as an empty strip, not as nothing", () => {
    // A row whose ticks cell collapses is a row that changes width, and a
    // table of them jitters as data loads.
    expect(tickRun([])).toContain("axi-ticks");
    expect(tickRun([])).not.toContain("axi-ticks__tick");
  });

  it("caps a long run and says it capped", () => {
    // Marks are a fixed width and never flex, so forty of them push the
    // column open rather than compressing.
    const html = tickRun(new Array(40).fill(true));
    expect(html.match(/axi-ticks__tick(?!--)/g).length).toBeLessThanOrEqual(20);
    expect(html).toContain("+20");
  });
});
