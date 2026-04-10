"use strict";

const raw = require("../../data/overrides.json");

function loadOverrides() {
  return new Map(Object.entries(raw));
}

function getOverride(overrides, key) {
  return overrides.get(key) || null;
}

module.exports = { loadOverrides, getOverride };
