import test from "node:test";
import assert from "node:assert/strict";
import { activateHotspot, sceneGraph, validateSceneGraph } from "../scene-graph.js";

test("scene graph is internally valid", () => {
  assert.deepEqual(validateSceneGraph(), []);
});

test("all scenes are reachable from the entrance", () => {
  const visited = new Set(["entrance"]);
  const queue = ["entrance"];
  while (queue.length) {
    const current = queue.shift();
    for (const hotspot of sceneGraph[current].hotspots) {
      if (!visited.has(hotspot.to)) {
        visited.add(hotspot.to);
        queue.push(hotspot.to);
      }
    }
  }
  assert.deepEqual([...visited].sort(), Object.keys(sceneGraph).sort());
});

test("hotspot activation returns auditable transition data", () => {
  const result = activateHotspot("entrance", "hatch");
  assert.equal(result.from, "entrance");
  assert.equal(result.to, "understory");
  assert.equal(result.hotspot.label, "Open the brass hatch");
});
