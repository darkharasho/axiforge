const { fork } = require("child_process");
const path = require("path");
const mockServer = require("./mock-server/server");
const { SYNC_PORT_BASE } = require("./helpers/ports");

// The GW2 catalog mock is stateless — every route reads fixture data — so one
// instance serves every worker.
//
// The sync mock is NOT: its `db` is module-level singleton state and the
// `resetSync()` hook wipes all of it, so two workers sharing one instance would
// pull each other's teams out from under themselves. Each worker gets its own
// process on SYNC_PORT_BASE + workerIndex, which is what let this suite go
// parallel at all. See tests/e2e/helpers/ports.js for the other half.
module.exports = async function globalSetup(config) {
  await mockServer.start();
  globalThis.__MOCK_SERVER__ = mockServer;

  const workers = Math.max(1, config?.workers || 1);
  const script = path.join(__dirname, "mock-sync-server.js");
  const children = [];
  for (let i = 0; i < workers; i++) {
    const port = SYNC_PORT_BASE + i;
    const child = fork(script, [], { env: { ...process.env, MOCK_SYNC_PORT: String(port) }, stdio: "inherit" });
    children.push(
      new Promise((resolve, reject) => {
        child.once("message", (msg) => (msg?.ready ? resolve(child) : reject(new Error("sync mock did not report ready"))));
        child.once("exit", (code) => reject(new Error(`sync mock on ${port} exited with ${code}`)));
      })
    );
  }
  globalThis.__MOCK_SYNC_CHILDREN__ = await Promise.all(children);
  console.log(`Mock sync servers listening on ${SYNC_PORT_BASE}..${SYNC_PORT_BASE + workers - 1}`);
};
