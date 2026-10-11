import {
  Color3,
  Engine,
  HemisphericLight,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { ChunkManager, createBlockIDGrid } from "./chunkmanager.js";
import { NoclipCameraPlayer } from "./noclipCameraPlayer.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

scene.clearColor = new Color3(0.12, 0.16, 0.2);

const noclipCameraPlayer = new NoclipCameraPlayer(scene, canvas);

const light = new HemisphericLight("light", new Vector3(-0.5, -1, 2), scene);
light.intensity = 1.1;

// this is a 3D array representing the block IDs in the chunk. 0 represents air, and 1 represents a solid block.
const sizeX = 1024;
const sizeY = 1024;
const sizeZ = 192;
const blockIDs = createBlockIDGrid([sizeX, sizeY, sizeZ]);

// Uncomment to make every entry in blockIDs equal to 1:
blockIDs.flatData.fill(1);
console.log(blockIDs[0][0][0]);
blockIDs[0][0][127] = 0; // set the top block to air for testing purposes

blockIDs[0][0][124] = 0; // set the top block to air for testing purposes
blockIDs[1][1][122] = 0; // set the top block to air for testing purposes

// end of the 3D array representing the block IDs in the chunk.


const chunkMaterial = new StandardMaterial("chunkMaterial", scene);
chunkMaterial.diffuseColor = new Color3(0.32, 0.58, 0.3);
chunkMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
const chunkDimensions = [sizeX, sizeY, sizeZ];
const chunkManager = new ChunkManager({
  scene,
  engine,
  camera: noclipCameraPlayer.camera,
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