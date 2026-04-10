"use strict";

const TYPE_ALIASES = {
  Distance: "Radius",
  PrefixedBuff: "Buff",
  ApplyBuffCondition: "Buff",
};

function normalizeFactType(type) {
  return TYPE_ALIASES[type] || type;
}

function stripGw2Markup(text) {
  if (!text) return text;
  return text.replace(/<c[^>]*>(.*?)<\/c>/g, "$1");
}

function stripWikiMarkup(text) {
  if (!text) return text;
  let result = text.replace(/\{\{fraction\|([^}]+)\}\}/g, "$1");
  result = result.replace(/\{\{[^}]*\}\}/g, "");
  result = result.replace(/\[\[[^\]]*\|([^\]]+)\]\]/g, "$1");
  result = result.replace(/\[\[([^\]|]+)\]\]/g, "$1");
  return result;
}

module.exports = { normalizeFactType, stripGw2Markup, stripWikiMarkup };
