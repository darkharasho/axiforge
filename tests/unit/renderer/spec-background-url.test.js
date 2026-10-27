/**
 * Spec panel art must come from the GW2 API's render CDN (spec.background), not
 * a hotlink to wiki.guildwars2.com. While the wiki was down for maintenance it
 * answered every Special:FilePath URL with an HTML page (HTTP 200), the browser
 * blocked it as an image (ERR_BLOCKED_BY_ORB), and every spec line on the
 * published SPA rendered without its background.
 */

const { specBackgroundUrl } = require("../../../src/renderer/modules/specializations.js");

test("uses the API background when the spec carries one", () => {
  const bg = "https://render.guildwars2.com/file/DDF39DBD61CCC1BCDD03B271080869251D097041/1012073.png";
  expect(specBackgroundUrl({ name: "Spite", background: bg })).toBe(bg);
});

test("falls back to the wiki file only when no API background exists", () => {
  expect(specBackgroundUrl({ name: "Death Magic" })).toBe(
    "https://wiki.guildwars2.com/wiki/Special:FilePath/Death%20Magic%20specialization.png"
  );
});
