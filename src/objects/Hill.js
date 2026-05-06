import { MeshBuilder, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";

function applyWaterMaterial(mesh, feature, scene) {
  const waterMat = new StandardMaterial(`waterMat_${feature.centerX}_${feature.centerZ}`, scene);
  waterMat.diffuseColor = new Color3(0.08, 0.28, 0.82);
  waterMat.emissiveColor = new Color3(0.02, 0.08, 0.22);
  waterMat.specularColor = new Color3(0.8, 0.9, 1.0);
  waterMat.specularPower = 64;
  waterMat.alpha = 0.82;
  waterMat.backFaceCulling = false;
  mesh.material = waterMat;
}

function createRoundHillWater(feature, scene, baseCy) {
  const waterMesh = MeshBuilder.CreateDisc(
    `water_${feature.centerX}_${feature.centerZ}`,
    { radius: feature.radius, tessellation: 48, sideOrientation: 2 },
    scene
  );

  waterMesh.position = new Vector3(feature.centerX, baseCy + 2, feature.centerZ);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.isPickable = false;
  applyWaterMaterial(waterMesh, feature, scene);
  return waterMesh;
}

function createSquareHillWater(feature, scene, baseCy) {
  const height = feature.depth ?? feature.width;
  const waterMesh = MeshBuilder.CreateGround(
    `water_${feature.centerX}_${feature.centerZ}`,
    { width: feature.width * 2, height: height * 2, subdivisions: 1 },
    scene
  );

  waterMesh.position = new Vector3(feature.centerX, baseCy + 1, feature.centerZ);
  waterMesh.rotation.y = -((feature.angle ?? 0) * Math.PI) / 180;
  waterMesh.isPickable = false;
  applyWaterMaterial(waterMesh, feature, scene);
  return waterMesh;
}

/**
 * Create the hill visuals for hill and squareHill features.
 * Water is only added when the hill is negative and the terrain type is water.
 *
 * @param {object} feature
 * @param {import('../track.js').Track} currentTrack
 * @param {BABYLON.Scene} scene
 * @returns {BABYLON.Mesh|null}
 */
export function createHill(feature, currentTrack, scene) {
  if (feature.type !== 'hill' && feature.type !== 'squareHill') return null;

  const isNegativeHill = feature.type === 'hill' && feature.height < 0;
  const isNegativeSquareHill = feature.type === 'squareHill' && (
    feature.height < 0 ||
    (feature.heightAtMin !== undefined && feature.heightAtMin < 0 && feature.heightAtMax < 0)
  );
  if (!isNegativeHill && !isNegativeSquareHill) return null;

  const terrainType = currentTrack.getTerrainTypeAt(feature.centerX, feature.centerZ);
  if (!(terrainType === 'water' || terrainType?.name === 'water')) return null;

  const baseCy = currentTrack.getHeightAt(feature.centerX, feature.centerZ);
  return feature.type === 'hill'
    ? createRoundHillWater(feature, scene, baseCy)
    : createSquareHillWater(feature, scene, baseCy);
}