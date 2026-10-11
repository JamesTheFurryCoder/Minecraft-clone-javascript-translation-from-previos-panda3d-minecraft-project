import {
  ArcRotateCamera,
  Color3,
  Engine,
  HemisphericLight,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { ChunkManager } from "./chunkmanager.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

scene.clearColor = new Color3(0.12, 0.16, 0.2);

const camera = new ArcRotateCamera(
  "camera",
  -Math.PI / 3,
  Math.PI / 3,
  28,
  new Vector3(8, 8, 2),
  scene
);
camera.upVector = new Vector3(0, 0, 1);
camera.lowerRadiusLimit = 10;
camera.attachControl(canvas, true);

const light = new HemisphericLight("light", new Vector3(-0.5, -1, 2), scene);
light.intensity = 1.1;

// this is a 3D array representing the block IDs in the chunk. 0 represents air, and 1 represents a solid block.
const sizeX = 1024;
const sizeY = 1024;
const sizeZ = 128;
const blockIDs = new Uint8Array(sizeX * sizeY * sizeZ);

for (let x = 0; x < sizeX; x += 1) {
  for (let y = 0; y < sizeY; y += 1) {
    const height = 25 + Math.floor(
      (Math.sin(x * 0.5) + Math.cos(y * 0.45) + 2) * 0.75
    );

    for (let z = 0; z < height; z += 1) {
      blockIDs[x * sizeY * sizeZ + y * sizeZ + z] = 1;
    }
  }
}

// Uncomment to make every entry in blockIDs equal to 1:
blockIDs.fill(1);

// end of the 3D array representing the block IDs in the chunk.


const chunkMaterial = new StandardMaterial("chunkMaterial", scene);
chunkMaterial.diffuseColor = new Color3(0.32, 0.58, 0.3);
chunkMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
const chunkDimensions = [sizeX, sizeY, sizeZ];
const chunkManager = new ChunkManager({
  scene,
  engine,
  camera,
  blockIDs,
  dimensions: chunkDimensions,
  material: chunkMaterial,
});

// fps display
const divFps = document.getElementById("fps");
let lastFpsUpdate = 0;

engine.runRenderLoop(() => {
  scene.render();

  const now = performance.now();
  if (now - lastFpsUpdate >= 250) {
    const fps = engine.getFps();
    if (Number.isFinite(fps)) {
      divFps.textContent = `${fps.toFixed(0)} fps`;
    }
    lastFpsUpdate = now;
  }
});

// end of fps display

window.addEventListener("keydown", (event) => {
  console.log(`Key pressed: ${event.key} | Physical code: ${event.code}`);
  // stress test: pressing "b" rebuilds all currently targeted chunks
  if (event.key === "b") {
    chunkManager.refreshVisibleChunks();
  }
});

window.addEventListener("resize", () => {
  engine.resize();
});