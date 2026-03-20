"use strict";

/**
 * Build a short redirect URL using GitHub Pages.
 * @param {string} owner — GitHub username
 * @param {string} repo — repo name
 * @param {string} fileId — build/comp file ID
 * @returns {string}
 */
function shortUrl(owner, repo, fileId) {
  return `https://${owner}.github.io/${repo}/r/${fileId}`;
}

module.exports = { shortUrl };
