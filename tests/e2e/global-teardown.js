module.exports = async function globalTeardown() {
  if (globalThis.__MOCK_SERVER__) {
    await globalThis.__MOCK_SERVER__.stop();
  }
  for (const child of globalThis.__MOCK_SYNC_CHILDREN__ || []) {
    child.kill();
  }
};
