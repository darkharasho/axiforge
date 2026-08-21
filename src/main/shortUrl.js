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

// Links must point at the account the item was actually published under, not
// whatever the current user's publishing target is (a teammate's build is on
// the teammate's Pages site).
function publishedOwnerFor(record, fallbackOwner) {
  return (record && record.publishedOwner) || fallbackOwner;
}

module.exports = { shortUrl, publishedOwnerFor };
