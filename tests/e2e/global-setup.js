const mockServer = require("./mock-server/server");
const mockSyncServer = require("./mock-sync-server");

module.exports = async function globalSetup() {
  await mockServer.start();
  globalThis.__MOCK_SERVER__ = mockServer;
  await mockSyncServer.start();
  globalThis.__MOCK_SYNC_SERVER__ = mockSyncServer;
};
