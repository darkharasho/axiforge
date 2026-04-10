"use strict";

function parseRelatedItems(html) {
  if (!html) return [];
  const items = [];
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liPattern.exec(html)) !== null) {
    const content = liMatch[1];
    const linkPattern = /<a[^>]*title="([^"]+)"[^>]*>/g;
    let name = null;
    let linkMatch;
    while ((linkMatch = linkPattern.exec(content)) !== null) {
      name = linkMatch[1];
    }
    if (!name) continue;
    let icon = null;
    const imgMatch = content.match(/src="([^"]+)"/);
    if (imgMatch) {
      icon = imgMatch[1];
      if (icon.startsWith("//")) icon = `https:${icon}`;
    }
    let context = null;
    const dashIdx = content.indexOf("\u2014");
    if (dashIdx >= 0) {
      context = content.slice(dashIdx + 1).replace(/<[^>]+>/g, "").trim();
    }
    items.push({ name, ...(icon && { icon }), ...(context && { context }) });
  }
  return items;
}

function parseRelatedGroups(html) {
  if (!html) return [];
  const parts = html.split(/<h4[^>]*>/i);
  if (parts.length <= 1) {
    const items = parseRelatedItems(html);
    return items.length ? [{ groupName: "", items }] : [];
  }
  const groups = [];
  for (let i = 1; i < parts.length; i++) {
    const headingEnd = parts[i].indexOf("</h4>");
    const groupName = headingEnd >= 0
      ? parts[i].slice(0, headingEnd).replace(/<[^>]+>/g, "").trim()
      : "";
    const body = headingEnd >= 0 ? parts[i].slice(headingEnd + 5) : parts[i];
    const items = parseRelatedItems(body);
    if (items.length) {
      groups.push({ groupName, items });
    }
  }
  return groups;
}

module.exports = { parseRelatedItems, parseRelatedGroups };
