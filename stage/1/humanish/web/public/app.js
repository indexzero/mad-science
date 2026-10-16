import { activateHotspot, initialScene, sceneGraph } from "/scene-graph.js";

const sceneNode = document.querySelector("#scene");
const titleNode = document.querySelector("#scene-title");
const descriptionNode = document.querySelector("#scene-description");
const statusNode = document.querySelector("#status");
const params = new URLSearchParams(location.search);
const sessionID = params.get("session") ?? crypto.randomUUID();
const condition = params.get("condition") ?? "unspecified";
let sceneID = initialScene;
let sequence = 0;
let lastMove = -Infinity;

function envelope(type, data = {}) {
  return {
    schemaVersion: 1,
    sessionID,
    condition,
    sequence: sequence++,
    type,
    sceneID,
    performanceTimeOrigin: performance.timeOrigin,
    performanceNow: performance.now(),
    wallTime: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    ...data
  };
}

function record(type, data) {
  const body = JSON.stringify(envelope(type, data));
  fetch("/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true })
    .catch(() => navigator.sendBeacon("/events", body));
}

function render() {
  const scene = sceneGraph[sceneID];
  titleNode.textContent = scene.title;
  descriptionNode.textContent = scene.description;
  sceneNode.dataset.theme = scene.theme;
  sceneNode.replaceChildren(...scene.hotspots.map(hotspot => {
    const button = document.createElement("button");
    button.className = "hotspot";
    button.dataset.hotspot = hotspot.id;
    button.dataset.glyph = hotspot.glyph;
    button.setAttribute("aria-label", hotspot.label);
    button.style.left = `${hotspot.x}%`;
    button.style.top = `${hotspot.y}%`;
    button.style.width = `${hotspot.width}%`;
    button.style.height = `${hotspot.height}%`;
    button.addEventListener("click", event => {
      event.stopPropagation();
      const transition = activateHotspot(sceneID, hotspot.id);
      const rect = button.getBoundingClientRect();
      record("hotspot-activated", {
        hotspotID: hotspot.id,
        label: hotspot.label,
        targetRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointer: { x: event.clientX, y: event.clientY },
        effect: hotspot.effect ?? null,
        toSceneID: transition.to
      });
      if (hotspot.effect === "ring") statusNode.textContent = "The bell answers from far away.";
      if (hotspot.effect === "complete") {
        statusNode.textContent = "The paper moon unfolds. Trial goal reached.";
        record("goal-completed", { hotspotID: hotspot.id });
      }
      if (transition.to !== sceneID) {
        const fromSceneID = sceneID;
        sceneID = transition.to;
        record("scene-transition", { fromSceneID, toSceneID: sceneID, hotspotID: hotspot.id });
        render();
      }
    });
    return button;
  }));
  record("scene-rendered", { hotspotCount: scene.hotspots.length, title: scene.title });
}

sceneNode.addEventListener("pointerdown", event => record("pointer-down", { x: event.clientX, y: event.clientY, button: event.button }));
sceneNode.addEventListener("pointerup", event => record("pointer-up", { x: event.clientX, y: event.clientY, button: event.button }));
sceneNode.addEventListener("pointermove", event => {
  if (performance.now() - lastMove < 16) return;
  lastMove = performance.now();
  record("pointer-move", { x: event.clientX, y: event.clientY, buttons: event.buttons });
});
sceneNode.addEventListener("click", event => record("miss", { x: event.clientX, y: event.clientY }));
document.addEventListener("visibilitychange", () => record("visibility", { state: document.visibilityState }));
window.addEventListener("focus", () => record("window-focus"));
window.addEventListener("blur", () => record("window-blur"));
window.addEventListener("resize", () => record("viewport-resize"));

record("session-start", { userAgent: navigator.userAgent, initialScene });
render();
