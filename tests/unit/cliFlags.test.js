"use strict";

const { parseCliFlags } = require("../../src/main/cliFlags");

describe("parseCliFlags", () => {
  test("detects --headless anywhere in argv", () => {
    expect(parseCliFlags(["electron", ".", "--headless"]).headless).toBe(true);
    expect(parseCliFlags(["/usr/bin/AxiForge", "--headless", "--foo"]).headless).toBe(true);
  });

  test("headless is false when flag absent", () => {
    expect(parseCliFlags(["electron", "."]).headless).toBe(false);
    expect(parseCliFlags([]).headless).toBe(false);
  });

  test("tolerates non-array input", () => {
    expect(parseCliFlags(undefined).headless).toBe(false);
    expect(parseCliFlags(null).headless).toBe(false);
  });
});
