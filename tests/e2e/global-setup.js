const mockServer = require("./mock-server/server");

module.exports = async function globalSetup() {
  await mockServer.start();
  globalThis.__MOCK_SERVER__ = mockServer;
};
