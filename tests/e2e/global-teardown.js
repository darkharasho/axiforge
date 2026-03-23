module.exports = async function globalTeardown() {
  if (globalThis.__MOCK_SERVER__) {
    await globalThis.__MOCK_SERVER__.stop();
  }
};
