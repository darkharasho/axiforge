"use strict";

const path = require("path");
const fs = require("fs");

function loadOverrides() {
  const filePath = path.join(__dirname, "../../data/overrides.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return new Map(Object.entries(raw));
}

function getOverride(overrides, key) {
  return overrides.get(key) || null;
}

module.exports = { loadOverrides, getOverride };
