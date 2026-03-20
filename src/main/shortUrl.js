"use strict";

const https = require("node:https");

const AXI_LINK_API = "https://axi.link/api/register";
const AXI_LINK_BASE = "https://axi.link/r/";

/**
 * Register a short redirect URL at axi.link.
 * @param {string} id — unique identifier (e.g., build fileId)
 * @param {string} target — full URL to redirect to
 * @returns {Promise<string|null>} short URL on success, null on failure
 */
async function registerShortUrl(id, target) {
  try {
    const data = JSON.stringify({ id, target });
    const res = await new Promise((resolve, reject) => {
      const url = new URL(AXI_LINK_API);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on("error", (err) => reject(err));
      req.write(data);
      req.end();
    });

    if (res.status === 200) {
      const parsed = JSON.parse(res.body);
      return parsed.short || `${AXI_LINK_BASE}${id}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the short URL for an id without registering (for when it's already registered).
 */
function shortUrl(id) {
  return `${AXI_LINK_BASE}${id}`;
}

module.exports = { registerShortUrl, shortUrl };
