"use strict";

/**
 * Tests for _applyRechargeOverride — the curated per-mode recharge safety net
 * (KNOWN_SKILL_RECHARGE_OVERRIDES). Used only when the resolver can't derive a
 * WvW/PvP cooldown split from the wiki infobox or version history.
 */

const { _applyRechargeOverride } = require("../../src/main/gw2Data/catalog");

describe("_applyRechargeOverride", () => {
  test("no-op when entity has no override entry", () => {
    const entity = { id: 1, recharge: { pve: 10, wvw: 10, pvp: 10 } };
    _applyRechargeOverride(entity, new Map());
    expect(entity.recharge).toEqual({ pve: 10, wvw: 10, pvp: 10 });
  });

  test("no-op when override map is undefined", () => {
    const entity = { id: 1, recharge: { pve: 10, wvw: 10, pvp: 10 } };
    _applyRechargeOverride(entity, undefined);
    expect(entity.recharge).toEqual({ pve: 10, wvw: 10, pvp: 10 });
  });

  test("overrides wvw/pvp while preserving pve from existing recharge", () => {
    const entity = { id: 6159, recharge: { pve: 15, wvw: 15, pvp: 15 } };
    _applyRechargeOverride(entity, new Map([[6159, { wvw: 25, pvp: 25 }]]));
    expect(entity.recharge).toEqual({ pve: 15, wvw: 25, pvp: 25 });
  });

  test("omitted modes fall back to pve when entity has no recharge object", () => {
    const entity = { id: 6159, recharge: { pve: 15, wvw: 15, pvp: 15 } };
    _applyRechargeOverride(entity, new Map([[6159, { wvw: 25 }]]));
    // pvp not overridden -> keeps existing 15
    expect(entity.recharge).toEqual({ pve: 15, wvw: 25, pvp: 15 });
  });

  test("synthesizes recharge object from override when entity has none", () => {
    const entity = { id: 6159 };
    _applyRechargeOverride(entity, new Map([[6159, { pve: 12, wvw: 20 }]]));
    expect(entity.recharge).toEqual({ pve: 12, wvw: 20, pvp: 12 });
  });
});
