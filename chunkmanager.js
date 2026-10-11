import { Chunk } from "./chunk.js";

const coordinateKey = ([x, y, z]) => `${x},${y},${z}`;

export function createBlockIDGrid(dimensions, data) {
  if (
    !Array.isArray(dimensions) ||
    dimensions.length !== 3 ||
    dimensions.some((size) => !Number.isInteger(size) || size <= 0)
  ) {
    throw new TypeError("Block ID grid dimensions must contain three positive integers");
  }

  const [sizeX, sizeY, sizeZ] = dimensions;
  data ??= new Uint8Array(sizeX * sizeY * sizeZ);
  if (!ArrayBuffer.isView(data) || data.length !== sizeX * sizeY * sizeZ) {
    throw new TypeError("Block ID grid requires three positive dimensions and matching typed data");
  }

  const grid = Array.from({ length: sizeX }, (_, x) => new Proxy(new Array(sizeY), {
    get(rows, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(rows, property, receiver);
      }
      const y = Number(property);
      if (Number.isInteger(y) && y >= 0 && y < sizeY && String(y) === property) {
        const start = (x * sizeY + y) * sizeZ;
        return data.subarray(start, start + sizeZ);
      }
      return Reflect.get(rows, property, receiver);
    },
  }));

  Object.defineProperties(grid, {
    dimensions: { value: dimensions },
    flatData: { value: data },
  });
  return grid;
}

export class ChunkManager {
  constructor({
    scene,
    engine,
    camera,
    blockIDs,
    dimensions,
    material,
    chunkSize = 64,
    chunkHeight = 64,
    renderRadius = 16,
    renderHeight = 16,
    maxChunkLoadsPerFrame = 2,
    maxChunkUnloadsPerFrame = 16,
    maxThreadedChunkBuilds = 8,
    onChunkLoadError = (error, coordinate) => {
      console.error(`Failed to load chunk ${coordinate.join(",")}`, error);
    },
  }) {
    if (!scene || !engine || !camera || !blockIDs || !dimensions || !material) {
      throw new TypeError("ChunkManager requires scene, engine, camera, blockIDs, dimensions, and material");
    }
    if (dimensions.length !== 3 || dimensions.some((size) => !Number.isInteger(size) || size <= 0)) {
      throw new TypeError("dimensions must contain three positive integers");
    }
    const flatBlockIDs = ArrayBuffer.isView(blockIDs) ? blockIDs : blockIDs.flatData;
    if (flatBlockIDs) {
      if (flatBlockIDs.length !== dimensions[0] * dimensions[1] * dimensions[2]) {
        throw new TypeError("blockIDs length must match dimensions");
      }
    } else if (
      !Array.isArray(blockIDs) ||
      blockIDs.length !== dimensions[0] ||
      blockIDs[0]?.length !== dimensions[1] ||
      blockIDs[0]?.[0]?.length !== dimensions[2]
    ) {
      throw new TypeError("blockIDs must be a 3D array or typed grid matching dimensions");
    }

    this.scene = scene;
    this.engine = engine;
    this.camera = camera;
    this.blockIDs = blockIDs;
    this.flatBlockIDs = flatBlockIDs ?? null;
    this.dimensions = dimensions;
    this.material = material;
    this.chunkSize = chunkSize;
    this.chunkHeight = chunkHeight;
    this.renderRadius = renderRadius;
    this.renderHeight = renderHeight;
    this.maxChunkLoadsPerFrame = maxChunkLoadsPerFrame;
    this.maxChunkUnloadsPerFrame = maxChunkUnloadsPerFrame;
    this.maxThreadedChunkBuilds = maxThreadedChunkBuilds;
    this.onChunkLoadError = onChunkLoadError;

    this.chunkLimits = [
      Math.ceil(dimensions[0] / chunkSize),
      Math.ceil(dimensions[1] / chunkSize),
      Math.ceil(dimensions[2] / chunkHeight),
    ];
    this.chunks = new Map();
    this.loadedChunkSet = new Set();
    this.pendingChunkBuilds = new Set();
    this.targetChunkSet = new Set();
    this.chunkLoadQueue = [];
    this.chunkUnloadQueue = [];
    this.cameraChunkPosition = this.getCameraChunkPosition();

    this.updateChunkLoadingTarget(this.cameraChunkPosition);
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  getCameraChunkPosition() {
    const position = this.camera.globalPosition ?? this.camera.position;
    return [
      Math.floor(position.x / this.chunkSize),
      Math.floor(position.y / this.chunkSize),
      Math.floor(position.z / this.chunkHeight),
    ];
  }

  update() {
    const cameraChunkPosition = this.getCameraChunkPosition();
    if (cameraChunkPosition.some((value, axis) => value !== this.cameraChunkPosition[axis])) {
      this.cameraChunkPosition = cameraChunkPosition;
      this.updateChunkLoadingTarget(cameraChunkPosition);
    }

    this.processChunkUnloadQueue();
    this.processChunkLoadQueue();
  }

  chunkCoordinateInBounds([x, y, z]) {
    return x >= 0 && x < this.chunkLimits[0] &&
      y >= 0 && y < this.chunkLimits[1] &&
      z >= 0 && z < this.chunkLimits[2];
  }

  getCylinderChunkCoordinates(center, radius = this.renderRadius, height = this.renderHeight) {
    const [centerX, centerY, centerZ] = center;
    const safeRadius = Math.max(0, Math.floor(radius));
    const safeHeight = Math.max(0, Math.floor(height));
    const radiusSquared = safeRadius * safeRadius;
    const coordinates = [];

    for (let dz = -safeHeight; dz <= safeHeight; dz += 1) {
      for (let dx = -safeRadius; dx <= safeRadius; dx += 1) {
        for (let dy = -safeRadius; dy <= safeRadius; dy += 1) {
          if (dx * dx + dy * dy > radiusSquared) {
            continue;
          }

          const coordinate = [centerX + dx, centerY + dy, centerZ + dz];
          if (this.chunkCoordinateInBounds(coordinate)) {
            coordinates.push({
              coordinate,
              distance: dx * dx + dy * dy + dz * dz,
              verticalDistance: Math.abs(dz),
            });
          }
        }
      }
    }

    coordinates.sort((left, right) =>
      left.distance - right.distance ||
      left.verticalDistance - right.verticalDistance ||
      left.coordinate[0] - right.coordinate[0] ||
      left.coordinate[1] - right.coordinate[1] ||
      left.coordinate[2] - right.coordinate[2]
    );
    return coordinates.map(({ coordinate }) => coordinate);
  }

  updateChunkLoadingTarget(cameraChunkPosition) {
    const targetCoordinates = this.getCylinderChunkCoordinates(cameraChunkPosition);
    this.targetChunkSet = new Set(targetCoordinates.map(coordinateKey));
    this.chunkLoadQueue = targetCoordinates.filter((coordinate) => {
      const key = coordinateKey(coordinate);
      return !this.loadedChunkSet.has(key) && !this.pendingChunkBuilds.has(key);
    });
    this.chunkUnloadQueue = [...this.loadedChunkSet]
      .filter((key) => !this.targetChunkSet.has(key))
      .map((key) => key.split(",").map(Number));
  }

  processChunkLoadQueue() {
    let loadsStarted = 0;

    while (
      this.chunkLoadQueue.length > 0 &&
      loadsStarted < this.maxChunkLoadsPerFrame &&
      this.pendingChunkBuilds.size < this.maxThreadedChunkBuilds
    ) {
      const coordinate = this.chunkLoadQueue.shift();
      const key = coordinateKey(coordinate);
      if (!this.targetChunkSet.has(key) || this.loadedChunkSet.has(key) || this.pendingChunkBuilds.has(key)) {
        continue;
      }

      this.startChunkBuild(coordinate);
      loadsStarted += 1;
    }
  }

  startChunkBuild(coordinate) {
    const key = coordinateKey(coordinate);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(this.scene, this.engine, ...coordinate);
      chunk.chunkSize = this.chunkSize;
      chunk.chunkHeight = this.chunkHeight;
      this.chunks.set(key, chunk);
    }

    this.pendingChunkBuilds.add(key);
    const { blocks, dimensions, sourceOrigin } = this.getChunkBlockRegion(coordinate);
    chunk.loadChunk(blocks, dimensions, this.material, sourceOrigin, true)
      .then(() => {
        if (this.targetChunkSet.has(key)) {
          this.loadedChunkSet.add(key);
        } else {
          chunk.mesh?.dispose();
          chunk.mesh = null;
          this.loadedChunkSet.delete(key);
        }
      })
      .catch((error) => this.onChunkLoadError(error, coordinate))
      .finally(() => {
        chunk.disposeWorker();
        this.pendingChunkBuilds.delete(key);
      });
  }

  getChunkBlockRegion([chunkX, chunkY, chunkZ]) {
    const chunkStart = [
      chunkX * this.chunkSize,
      chunkY * this.chunkSize,
      chunkZ * this.chunkHeight,
    ];
    const chunkSpan = [this.chunkSize, this.chunkSize, this.chunkHeight];
    const sourceOrigin = chunkStart.map((start, axis) => Math.max(0, start - 1));
    const sourceEnd = chunkStart.map((start, axis) =>
      Math.min(this.dimensions[axis], start + chunkSpan[axis] + 1)
    );
    const regionDimensions = sourceOrigin.map((start, axis) => sourceEnd[axis] - start);
    const [regionYSize, regionZSize] = [regionDimensions[1], regionDimensions[2]];
    const blocks = new Uint8Array(regionDimensions[0] * regionYSize * regionZSize);

    for (let x = sourceOrigin[0]; x < sourceEnd[0]; x += 1) {
      for (let y = sourceOrigin[1]; y < sourceEnd[1]; y += 1) {
        const targetIndex = (x - sourceOrigin[0]) * regionYSize * regionZSize +
          (y - sourceOrigin[1]) * regionZSize;
        const blockRow = this.flatBlockIDs
          ? this.flatBlockIDs.subarray(
            (x * this.dimensions[1] + y) * this.dimensions[2] + sourceOrigin[2],
            (x * this.dimensions[1] + y) * this.dimensions[2] + sourceEnd[2]
          )
          : this.blockIDs[x][y].slice(sourceOrigin[2], sourceEnd[2]);
        blocks.set(blockRow, targetIndex);
      }
    }

    return { blocks, dimensions: regionDimensions, sourceOrigin };
  }

  processChunkUnloadQueue() {
    let unloadsCompleted = 0;

    while (this.chunkUnloadQueue.length > 0 && unloadsCompleted < this.maxChunkUnloadsPerFrame) {
      const coordinate = this.chunkUnloadQueue.shift();
      const key = coordinateKey(coordinate);
      if (this.targetChunkSet.has(key)) {
        continue;
      }

      const chunk = this.chunks.get(key);
      chunk?.mesh?.dispose();
      if (chunk) {
        chunk.mesh = null;
      }
      this.loadedChunkSet.delete(key);
      unloadsCompleted += 1;
    }
  }

  refreshVisibleChunks() {
    const coordinates = [...this.targetChunkSet].map((key) => key.split(",").map(Number));
    this.loadedChunkSet.clear();
    this.chunkLoadQueue = coordinates.filter((coordinate) =>
      !this.pendingChunkBuilds.has(coordinateKey(coordinate))
    );
  }

  dispose() {
    this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
    for (const chunk of this.chunks.values()) {
      chunk.mesh?.dispose();
      chunk.disposeWorker();
    }
    this.chunks.clear();
    this.loadedChunkSet.clear();
    this.pendingChunkBuilds.clear();
  }
}