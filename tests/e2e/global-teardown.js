module.exports = async function globalTeardown() {
  if (globalThis.__MOCK_SERVER__) {
    await globalThis.__MOCK_SERVER__.stop();
  }
  if (globalThis.__MOCK_SYNC_SERVER__) {
    await globalThis.__MOCK_SYNC_SERVER__.stop();
  }
};
