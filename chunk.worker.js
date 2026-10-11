self.onmessage = ({ data }) => {
  const { updateId, blocks, dimensions, chunkPosition, chunkSize, chunkHeight } = data;
  const sourceOrigin = data.sourceOrigin ?? [0, 0, 0];
  const [xSize, ySize, zSize] = dimensions;
  const [chunkX, chunkY, chunkZ] = chunkPosition;
  const [sourceX, sourceY, sourceZ] = sourceOrigin;
  const vertices = [];
  const indices = [];
  const uvs = [];
  const normals = [];
  const colors = [];

  const isAir = (x, y, z) => {
    if (x < 0 || x >= xSize || y < 0 || y >= ySize || z < 0 || z >= zSize) {
      return true;
    }
    return blocks[x * ySize * zSize + y * zSize + z] === 0;
  };

  const addFace = (faceVertices, normal) => {
    const firstVertex = vertices.length / 3;
    for (const vertex of faceVertices) {
      vertices.push(...vertex);
      normals.push(...normal);
      colors.push(1, 1, 1, 1);
    }
    indices.push(firstVertex, firstVertex + 2, firstVertex + 1, firstVertex, firstVertex + 3, firstVertex + 2);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  };

  const startX = Math.max(0, chunkX - sourceX);
  const startY = Math.max(0, chunkY - sourceY);
  const startZ = Math.max(0, chunkZ - sourceZ);
  const endX = Math.min(xSize, chunkX + chunkSize - sourceX);
  const endY = Math.min(ySize, chunkY + chunkSize - sourceY);
  const endZ = Math.min(zSize, chunkZ + chunkHeight - sourceZ);

  for (let x = startX; x < endX; x += 1) {
    for (let y = startY; y < endY; y += 1) {
      for (let z = startZ; z < endZ; z += 1) {
        if (isAir(x, y, z)) {
          continue;
        }

        const localX = sourceX + x - chunkX;
        const localY = sourceY + y - chunkY;
        const localZ = sourceZ + z - chunkZ;

        if (isAir(x - 1, y, z)) {
          addFace([[localX, localY, localZ], [localX, localY, localZ + 1], [localX, localY + 1, localZ + 1], [localX, localY + 1, localZ]], [-1, 0, 0]);
        }
        if (isAir(x + 1, y, z)) {
          addFace([[localX + 1, localY, localZ], [localX + 1, localY + 1, localZ], [localX + 1, localY + 1, localZ + 1], [localX + 1, localY, localZ + 1]], [1, 0, 0]);
        }
        if (isAir(x, y - 1, z)) {
          addFace([[localX, localY, localZ], [localX + 1, localY, localZ], [localX + 1, localY, localZ + 1], [localX, localY, localZ + 1]], [0, -1, 0]);
        }
        if (isAir(x, y + 1, z)) {
          addFace([[localX, localY + 1, localZ], [localX, localY + 1, localZ + 1], [localX + 1, localY + 1, localZ + 1], [localX + 1, localY + 1, localZ]], [0, 1, 0]);
        }
        if (isAir(x, y, z + 1)) {
          addFace([[localX, localY, localZ + 1], [localX + 1, localY, localZ + 1], [localX + 1, localY + 1, localZ + 1], [localX, localY + 1, localZ + 1]], [0, 0, 1]);
        }
        if (isAir(x, y, z - 1)) {
          addFace([[localX, localY, localZ], [localX, localY + 1, localZ], [localX + 1, localY + 1, localZ], [localX + 1, localY, localZ]], [0, 0, -1]);
        }
      }
    }
  }

  const result = {
    updateId,
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
  };
  self.postMessage(result, [
    result.vertices.buffer,
    result.indices.buffer,
    result.uvs.buffer,
    result.normals.buffer,
    result.colors.buffer,
  ]);
};
