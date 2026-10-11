import { Mesh, Vector3, VertexData } from "@babylonjs/core";

export class Chunk {
  constructor(scene, engine,xChunkPos,yChunkPos,zChunkPos) {  // Constructor
    this.scene = scene;
    this.engine = engine;
    this.xChunkPos = xChunkPos;
    this.yChunkPos = yChunkPos;
    this.zChunkPos = zChunkPos;

    this.chunkSize = 64;
    this.chunkHeight = 64;
    this.vertices = [];
    this.indices = [];
    this.uvs = [];
    this.normals = [];
    this.colors = [];
    this.mesh = null;
    this.nextUpdateId = 0;
    this.pendingUpdates = new Map();
    this.worker = null;
  }

  _ensureWorker() {
    if (this.worker) {
      return this.worker;
    }

    this.worker = new Worker(new URL("./chunk.worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => {
      const pending = this.pendingUpdates.get(data.updateId);
      if (!pending) {
        return;
      }

      this.pendingUpdates.delete(data.updateId);
      this.vertices = data.vertices;
      this.indices = data.indices;
      this.uvs = data.uvs;
      this.normals = data.normals;
      this.colors = data.colors;
      pending.resolve();
    };
    this.worker.onerror = (error) => {
      for (const pending of this.pendingUpdates.values()) {
        pending.reject(error);
      }
      this.pendingUpdates.clear();
    };
    return this.worker;
  }

  disposeWorker() {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pendingUpdates.values()) {
      pending.reject(new Error("Chunk worker was disposed before the build completed"));
    }
    this.pendingUpdates.clear();
  }

  getProperPositionForChunkBuilding() {
    return new Vector3(...this._getProperChunkCoordinate());
  }

  _getProperChunkCoordinate() {
    return [
      this.xChunkPos * this.chunkSize,
      this.yChunkPos * this.chunkSize,
      this.zChunkPos * this.chunkHeight,
    ];
  }

  _resetGeometryData() {
    this.vertices.length = 0;
    this.indices.length = 0;
    this.uvs.length = 0;
    this.normals.length = 0;
    this.colors.length = 0;
  }

  coordinateBlockOutOfBoundsOrAir(x, y, z, blockIDs) {
    const xSize = blockIDs.length;
    const ySize = blockIDs[0]?.length ?? 0;
    const zSize = blockIDs[0]?.[0]?.length ?? 0;

    const outOfBounds = !(
      x >= 0 && x < xSize &&
      y >= 0 && y < ySize &&
      z >= 0 && z < zSize
    );

    if (outOfBounds || !Array.isArray(blockIDs[x]?.[y])) {
      return true;
    }

    return blockIDs[x][y][z] === 0 || blockIDs[x][y][z] === undefined;
  }

  updateData(blockIDs, dimensions, sourceOrigin = [0, 0, 0], transferOwnership = false) {
    let xSize;
    let ySize;
    let zSize;
    let transferableBlocks;

    if (ArrayBuffer.isView(blockIDs)) {
      [xSize, ySize, zSize] = dimensions ?? [this.chunkSize, this.chunkSize, this.chunkHeight];
      if (blockIDs.length !== xSize * ySize * zSize) {
        throw new TypeError("blockIDs length must match its dimensions");
      }
      transferableBlocks = blockIDs instanceof Uint8Array
        ? transferOwnership ? blockIDs : blockIDs.slice()
        : Uint8Array.from(blockIDs, (blockId) => blockId === 0 ? 0 : 1);
    } else {
      const isThreeDimensionalArray = Array.isArray(blockIDs) && blockIDs.every(
        (xSlice) => Array.isArray(xSlice) && xSlice.every(Array.isArray)
      );
      if (!isThreeDimensionalArray) {
        throw new TypeError("blockIDs must be a 3D array or typed array");
      }

      [xSize, ySize, zSize] = [
        blockIDs.length,
        blockIDs[0]?.length ?? 0,
        blockIDs[0]?.[0]?.length ?? 0,
      ];
      const isRectangular = blockIDs.every(
        (xSlice) => xSlice.length === ySize &&
          xSlice.every((ySlice) => ySlice.length === zSize)
      );
      if (!isRectangular || (dimensions && dimensions.some((size, index) => size !== [xSize, ySize, zSize][index]))) {
        throw new TypeError("blockIDs must be a rectangular 3D array matching its dimensions");
      }

      dimensions = [xSize, ySize, zSize];
      transferableBlocks = new Uint8Array(xSize * ySize * zSize);
      for (let x = 0; x < xSize; x += 1) {
        for (let y = 0; y < ySize; y += 1) {
          for (let z = 0; z < zSize; z += 1) {
            transferableBlocks[x * ySize * zSize + y * zSize + z] = blockIDs[x][y][z] === 0 ? 0 : 1;
          }
        }
      }
    }

    const updateId = this.nextUpdateId++;
    return new Promise((resolve, reject) => {
      this.pendingUpdates.set(updateId, { resolve, reject });
      try {
        this._ensureWorker().postMessage({
          updateId,
          blocks: transferableBlocks,
          dimensions,
          sourceOrigin,
          chunkPosition: this._getProperChunkCoordinate(),
          chunkSize: this.chunkSize,
          chunkHeight: this.chunkHeight,
        }, [transferableBlocks.buffer]);
      } catch (error) {
        this.pendingUpdates.delete(updateId);
        reject(error);
      }
    });
  }

  async loadChunk(blockIDs, dimensions, material, sourceOrigin, transferOwnership = false) {
    await this.updateData(blockIDs, dimensions, sourceOrigin, transferOwnership);
    const mesh = this.displayGeometry();
    if (mesh && material) {
      mesh.material = material;
    }
    return mesh;
  }

  displayGeometry() {
    if (this.vertices.length === 0) {
      this.mesh?.dispose();
      this.mesh = null;
      return null;
    }

    if (!this.mesh || this.mesh.isDisposed()) {
      this.mesh = new Mesh(
        `chunk-${this.xChunkPos}-${this.yChunkPos}-${this.zChunkPos}`,
        this.scene
      );
    }

    const vertexData = new VertexData();
    vertexData.positions = this.vertices;
    vertexData.indices = this.indices;
    vertexData.uvs = this.uvs;
    vertexData.normals = this.normals;
    vertexData.colors = this.colors;
    vertexData.applyToMesh(this.mesh, true);
    this.mesh.position = this.getProperPositionForChunkBuilding();

    return this.mesh;
  }
}