const { gzipSync, gunzipSync } = require("../../src/web/shims/zlib.js");

test("round-trips through gzip/gunzip", () => {
  const original = Buffer.from(JSON.stringify({ hello: "world", n: 42 }), "utf-8");
  const out = gunzipSync(gzipSync(original));
  expect(out.toString("utf-8")).toBe(original.toString("utf-8"));
});

test("gunzips real node-zlib output", () => {
  const zlib = require("zlib");
  const gz = zlib.gzipSync(Buffer.from("axicode-payload"));
  expect(gunzipSync(gz).toString("utf-8")).toBe("axicode-payload");
});
