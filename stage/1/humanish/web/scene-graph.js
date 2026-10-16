// Newly authored scenes that preserve a discoverable click-to-travel grammar.
// Coordinates are percentages of the viewport and are the workload ground truth.
export const sceneGraph = {
  entrance: {
    title: "The quiet courtyard",
    description: "A moonlit courtyard holds a brass hatch and a distant arch.",
    theme: "courtyard",
    hotspots: [
      { id: "hatch", label: "Open the brass hatch", x: 42, y: 61, width: 17, height: 21, to: "understory", glyph: "hatch" },
      { id: "arch", label: "Walk through the blue arch", x: 72, y: 29, width: 15, height: 37, to: "gallery", glyph: "arch" }
    ]
  },
  understory: {
    title: "The understory",
    description: "Roots curl around a ladder, a speaking tube, and the way back.",
    theme: "understory",
    hotspots: [
      { id: "ladder", label: "Climb the copper ladder", x: 67, y: 20, width: 13, height: 57, to: "observatory", glyph: "ladder" },
      { id: "tube", label: "Listen at the silver tube", x: 22, y: 38, width: 18, height: 22, to: "echo", glyph: "tube" },
      { id: "return", label: "Return through the brass hatch", x: 43, y: 78, width: 18, height: 15, to: "entrance", glyph: "hatch" }
    ]
  },
  gallery: {
    title: "The gallery of weather",
    description: "Three glass clouds drift above a narrow garden door.",
    theme: "gallery",
    hotspots: [
      { id: "cloud", label: "Touch the rain cloud", x: 24, y: 18, width: 24, height: 20, to: "echo", glyph: "cloud" },
      { id: "garden", label: "Open the green garden door", x: 69, y: 43, width: 15, height: 42, to: "observatory", glyph: "door" },
      { id: "return", label: "Go back through the blue arch", x: 6, y: 40, width: 13, height: 43, to: "entrance", glyph: "arch" }
    ]
  },
  echo: {
    title: "The echo chamber",
    description: "A bell waits over a black pool. Two passages leave the room.",
    theme: "echo",
    hotspots: [
      { id: "bell", label: "Ring the amber bell", x: 42, y: 18, width: 17, height: 25, to: "echo", glyph: "bell", effect: "ring" },
      { id: "roots", label: "Follow the root passage", x: 7, y: 48, width: 18, height: 35, to: "understory", glyph: "arch" },
      { id: "stars", label: "Follow the star passage", x: 76, y: 47, width: 17, height: 36, to: "observatory", glyph: "arch" }
    ]
  },
  observatory: {
    title: "The small observatory",
    description: "A brass telescope points at a paper moon; a ladder descends.",
    theme: "observatory",
    terminal: true,
    hotspots: [
      { id: "moon", label: "Look through the brass telescope", x: 31, y: 27, width: 35, height: 25, to: "observatory", glyph: "telescope", effect: "complete" },
      { id: "ladder", label: "Climb down the copper ladder", x: 72, y: 54, width: 13, height: 38, to: "understory", glyph: "ladder" }
    ]
  }
};

export const initialScene = "entrance";

export function activateHotspot(sceneID, hotspotID) {
  const scene = sceneGraph[sceneID];
  if (!scene) throw new Error(`Unknown scene: ${sceneID}`);
  const hotspot = scene.hotspots.find(candidate => candidate.id === hotspotID);
  if (!hotspot) throw new Error(`Unknown hotspot: ${sceneID}/${hotspotID}`);
  if (!sceneGraph[hotspot.to]) throw new Error(`Broken transition: ${sceneID}/${hotspotID} -> ${hotspot.to}`);
  return { from: sceneID, to: hotspot.to, hotspot };
}

export function validateSceneGraph() {
  const errors = [];
  for (const [sceneID, scene] of Object.entries(sceneGraph)) {
    const ids = new Set();
    for (const hotspot of scene.hotspots) {
      if (ids.has(hotspot.id)) errors.push(`${sceneID}: duplicate hotspot ${hotspot.id}`);
      ids.add(hotspot.id);
      if (!sceneGraph[hotspot.to]) errors.push(`${sceneID}/${hotspot.id}: missing scene ${hotspot.to}`);
      if (hotspot.width <= 0 || hotspot.height <= 0) errors.push(`${sceneID}/${hotspot.id}: empty geometry`);
    }
  }
  return errors;
}
