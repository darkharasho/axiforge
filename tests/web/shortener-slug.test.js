const { computeSlug } = require("../../workers/share-shortener/src/slug.js");

const CODE = "AxiForge-share-code-sample";

test("computeSlug is deterministic for the same code+name", async () => {
  const a = await computeSlug(CODE, "My Build");
  const b = await computeSlug(CODE, "My Build");
  expect(a).toBe(b);
});

test("computeSlug is 7 chars of base62 by default", async () => {
  const slug = await computeSlug(CODE, "My Build");
  expect(slug).toMatch(/^[0-9A-Za-z]{7}$/);
});

test("computeSlug honors an explicit length (collision extension)", async () => {
  const slug = await computeSlug(CODE, "My Build", 9);
  expect(slug).toMatch(/^[0-9A-Za-z]{9}$/);
  // The shorter slug is a prefix of the longer one (same hash, more chars).
  const short = await computeSlug(CODE, "My Build", 7);
  expect(slug.startsWith(short)).toBe(true);
});

test("computeSlug differs when the name differs (content-addressed on code+name)", async () => {
  const a = await computeSlug(CODE, "Build A");
  const b = await computeSlug(CODE, "Build B");
  expect(a).not.toBe(b);
});

test("computeSlug differs when the code differs", async () => {
  const a = await computeSlug(CODE, "same");
  const b = await computeSlug(CODE + "x", "same");
  expect(a).not.toBe(b);
});

test("computeSlug treats missing name the same as empty name", async () => {
  const a = await computeSlug(CODE);
  const b = await computeSlug(CODE, "");
  expect(a).toBe(b);
});
