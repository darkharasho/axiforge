"use strict";

// Parses CLI flags from an argv array. Used both for process.argv at startup
// and for the argv delivered by the "second-instance" event.
function parseCliFlags(argv) {
  const args = Array.isArray(argv) ? argv : [];
  return {
    headless: args.includes("--headless"),
  };
}

module.exports = { parseCliFlags };
