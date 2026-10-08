const { createPagesLive } = require("../../src/main/pagesLive");

function setup(liveUrls = []) {
  const live = new Set(liveUrls);
  const polls = [];
  const pollUrlLive = jest.fn(async (url, opts) => { polls.push({ url, opts }); return live.has(url); });
  return { pagesLive: createPagesLive({ pollUrlLive, timeoutMs: 1000 }), polls, live };
}

test("waits for every page, in parallel, with the Pages timeout", async () => {
  const { pagesLive, polls } = setup(["https://a/r/1", "https://a/r/2"]);
  await expect(pagesLive.waitLive(["https://a/r/1", "https://a/r/2"])).resolves.toBe(true);
  expect(polls).toEqual([
    { url: "https://a/r/1", opts: { timeoutMs: 1000 } },
    { url: "https://a/r/2", opts: { timeoutMs: 1000 } },
  ]);
});

test("a page seen live is not polled again", async () => {
  const { pagesLive, polls } = setup(["https://a/r/1"]);
  await pagesLive.waitLive(["https://a/r/1"]);
  await pagesLive.waitLive(["https://a/r/1", "https://a/r/1"]);
  expect(polls).toHaveLength(1);
});

test("one page that never goes live fails the wait, and is polled again next time", async () => {
  const { pagesLive, polls, live } = setup(["https://a/r/1"]);
  await expect(pagesLive.waitLive(["https://a/r/1", "https://a/r/2"])).resolves.toBe(false);
  live.add("https://a/r/2");
  await expect(pagesLive.waitLive(["https://a/r/2"])).resolves.toBe(true);
  expect(polls.map((p) => p.url)).toEqual(["https://a/r/1", "https://a/r/2", "https://a/r/2"]);
});

test("no pages, or only empty urls, is live", async () => {
  const { pagesLive, polls } = setup();
  await expect(pagesLive.waitLive([null, "", undefined])).resolves.toBe(true);
  expect(polls).toHaveLength(0);
});
