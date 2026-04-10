"use strict";

const { buildInteractionGraph } = require("../../src/engine/graph");

describe("buildInteractionGraph", () => {
  test("builds graph from relations data", () => {
    const relations = new Map([
      [1444, { skills: [5489, 5507], traits: [] }],
      [1449, { skills: [], traits: [1444] }],
    ]);
    const graph = buildInteractionGraph(new Set([1444, 1449]), relations);
    expect(graph.get(1444).relatedSkills).toEqual(new Set([5489, 5507]));
    expect(graph.get(1449).relatedTraits).toEqual(new Set([1444]));
  });

  test("returns empty sets for traits with no relations", () => {
    const relations = new Map();
    const graph = buildInteractionGraph(new Set([100]), relations);
    expect(graph.get(100).relatedSkills.size).toBe(0);
    expect(graph.get(100).relatedTraits.size).toBe(0);
  });

  test("ignores traits not in activeTraitIds", () => {
    const relations = new Map([
      [999, { skills: [100], traits: [] }],
    ]);
    const graph = buildInteractionGraph(new Set([1444]), relations);
    expect(graph.has(999)).toBe(false);
  });
});
