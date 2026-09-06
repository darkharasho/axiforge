const http = require("http");
const { handleRequest } = require("./routes");

// Stateless: every route is a read of fixture data, so all workers share one.
const PORT = 9877;
let server;

function start() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const result = handleRequest(req.method, req.url);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (result === null) {
        res.writeHead(404);
        res.end(JSON.stringify({ text: "not found" }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });

    server.listen(PORT, () => {
      console.log(`Mock GW2 API server listening on http://localhost:${PORT}`);
      resolve();
    });
    server.on("error", reject);
  });
}

function stop() {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

module.exports = { start, stop, PORT };
