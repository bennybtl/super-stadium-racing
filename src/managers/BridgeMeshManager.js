import { BridgeMesh } from "../objects/BridgeMesh.js";

const AUTO_ENDPOINT_LINK_MAX_DISTANCE = 30;
const AUTO_TERRAIN_LINK_MAX_VERTICAL_DELTA = 0.75;
const AUTO_TERRAIN_PROJECTION_MAX_VERTICAL_DELTA = 1.5;

/**
 * BridgeMeshManager — creates and manages BridgeMesh objects from track features.
 */
export class BridgeMeshManager {
  constructor(scene, track, shadows = null, driveSurfaceManager = null) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this.driveSurfaceManager = driveSurfaceManager;
    this.surfaceTopologyGraph = scene?.metadata?.surfaceTopologyGraph ?? null;
    this._meshes = [];
  }

  create(feature) {
    const bm = new BridgeMesh(feature, this.track, this.scene, this.shadows, this.driveSurfaceManager);
    this._meshes.push(bm);
    return bm;
  }

  /**
   * Rebuild a specific feature in-place, or all bridgeMesh features when null.
   * @param {object[]} allFeatures  Full features array from the track.
   * @param {object|null} targetFeature
   */
  rebuild(allFeatures, targetFeature = null) {
    this._meshes = this._meshes.filter(bm => {
      if (targetFeature === null || bm.feature === targetFeature) {
        bm.dispose();
        return false;
      }
      return true;
    });

    for (const feature of allFeatures) {
      if (feature.type !== 'bridgeMesh') continue;
      if (targetFeature === null || feature === targetFeature) {
        this.create(feature);
      }
    }

    this.rebuildAutoConnectorLinks();
  }

  rebuildAutoConnectorLinks() {
    const graph = this.surfaceTopologyGraph;
    if (!graph) return;

    graph.removeByOwner?.(this);

    const endpointNodes = graph.getAllNodes().filter(node => {
      if (node?.kind !== 'bridge-mesh-connector-endpoint') return false;
      const tags = node?.tags ?? {};
      return Number.isFinite(tags.endpointWorldX) && Number.isFinite(tags.endpointWorldZ);
    });
    const terrainNodes = graph.getAllNodes().filter(node => {
      if (node?.connectorType) return false;
      const kind = String(node?.kind ?? '').toLowerCase();
      const surfaceKind = String(node?.tags?.surfaceKind ?? '').toLowerCase();
      const meshSurfaceKind = String(node?.mesh?.metadata?.surfaceKind ?? '').toLowerCase();
      const surfaceType = String(node?.mesh?.metadata?.surfaceType ?? '').toLowerCase();
      return (
        kind.includes('ground') ||
        surfaceKind.includes('ground') ||
        meshSurfaceKind.includes('ground') ||
        surfaceType === 'ground'
      );
    });

    const linkedPairs = new Set();

    for (const sourceNode of endpointNodes) {
      const targetNode = this._findNearestEndpointTarget(sourceNode, endpointNodes);
      if (targetNode) {
        const pairKey = sourceNode.nodeId < targetNode.nodeId
          ? `${sourceNode.nodeId}:${targetNode.nodeId}`
          : `${targetNode.nodeId}:${sourceNode.nodeId}`;
        if (linkedPairs.has(pairKey)) continue;
        linkedPairs.add(pairKey);

        const sourceTags = sourceNode.tags ?? {};
        const targetTags = targetNode.tags ?? {};
        const dx = sourceTags.endpointWorldX - targetTags.endpointWorldX;
        const dz = sourceTags.endpointWorldZ - targetTags.endpointWorldZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const sameLayer = sourceNode.layerId === targetNode.layerId;

        graph.registerConnector(this, {
          fromNodeId: sourceNode.nodeId,
          toNodeId: targetNode.nodeId,
          fromSurfaceId: sourceNode.surfaceId ?? null,
          toSurfaceId: targetNode.surfaceId ?? null,
          type: sameLayer
            ? 'DeckJoin'
            : (sourceNode.layerId < targetNode.layerId ? 'RampUp' : 'RampDown'),
          oneWay: false,
          tags: {
            autoLinked: true,
            autoLinkMode: 'proximity',
            autoLinkDistance: distance,
            sourceBridgeMeshKey: sourceTags.bridgeMeshKey ?? null,
            targetBridgeMeshKey: targetTags.bridgeMeshKey ?? null,
          },
        });
        continue;
      }

      const terrainIntersectionTarget = this._findTerrainIntersectionTarget(sourceNode, terrainNodes);
      const terrainProjectionTarget = terrainIntersectionTarget
        ? null
        : this._findTerrainProjectionTarget(sourceNode, terrainNodes);
      const terrainTarget = terrainIntersectionTarget ?? terrainProjectionTarget;
      if (!terrainTarget) continue;

      graph.registerConnector(this, {
        fromNodeId: sourceNode.nodeId,
        toNodeId: terrainTarget.nodeId,
        fromSurfaceId: sourceNode.surfaceId ?? null,
        toSurfaceId: terrainTarget.surfaceId ?? null,
        type: sourceNode.layerId === terrainTarget.layerId
          ? 'DeckJoin'
          : (sourceNode.layerId < terrainTarget.layerId ? 'RampUp' : 'RampDown'),
        oneWay: false,
        tags: {
          autoLinked: true,
          autoLinkMode: terrainIntersectionTarget
            ? 'terrain-intersection'
            : 'terrain-projection',
          sourceBridgeMeshKey: sourceNode.tags?.bridgeMeshKey ?? null,
        },
      });
    }
  }

  _findTerrainProjectionTarget(sourceNode, terrainNodes) {
    if (!Array.isArray(terrainNodes) || terrainNodes.length === 0) return null;

    const sourceTags = sourceNode?.tags ?? {};
    const sourceX = sourceTags.endpointWorldX;
    const sourceY = sourceTags.endpointWorldY;
    const sourceZ = sourceTags.endpointWorldZ;
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) || !Number.isFinite(sourceZ)) return null;

    const terrainY = this.track?.getHeightAt?.(sourceX, sourceZ);
    if (!Number.isFinite(terrainY)) return null;

    const dy = Math.abs(sourceY - terrainY);
    if (dy > AUTO_TERRAIN_PROJECTION_MAX_VERTICAL_DELTA) return null;

    return terrainNodes[0] ?? null;
  }

  _findNearestEndpointTarget(sourceNode, endpointNodes) {
    const sourceTags = sourceNode?.tags ?? {};
    const sourceX = sourceTags.endpointWorldX;
    const sourceZ = sourceTags.endpointWorldZ;
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceZ)) return null;

    const sourceBridgeMeshKey = sourceTags.bridgeMeshKey ?? null;
    const targetLayerId = Number.isFinite(sourceTags.targetLayerId)
      ? Math.max(0, Math.round(sourceTags.targetLayerId))
      : 0;

    let bestNode = null;
    let bestDistance = Infinity;
    for (const candidateNode of endpointNodes) {
      if (!candidateNode || candidateNode.nodeId === sourceNode.nodeId) continue;

      const candidateTags = candidateNode.tags ?? {};
      if ((candidateTags.bridgeMeshKey ?? null) === sourceBridgeMeshKey) continue;

      if (targetLayerId > 0 && candidateNode.layerId !== targetLayerId) continue;

      const candidateX = candidateTags.endpointWorldX;
      const candidateZ = candidateTags.endpointWorldZ;
      if (!Number.isFinite(candidateX) || !Number.isFinite(candidateZ)) continue;

      const dx = sourceX - candidateX;
      const dz = sourceZ - candidateZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > AUTO_ENDPOINT_LINK_MAX_DISTANCE) continue;
      if (distance >= bestDistance) continue;

      bestDistance = distance;
      bestNode = candidateNode;
    }

    return bestNode;
  }

  _findTerrainIntersectionTarget(sourceNode, terrainNodes) {
    if (!Array.isArray(terrainNodes) || terrainNodes.length === 0) return null;

    const sourceTags = sourceNode?.tags ?? {};
    const sourceX = sourceTags.endpointWorldX;
    const sourceY = sourceTags.endpointWorldY;
    const sourceZ = sourceTags.endpointWorldZ;
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) || !Number.isFinite(sourceZ)) return null;

    const terrainY = this.track?.getHeightAt?.(sourceX, sourceZ);
    if (!Number.isFinite(terrainY)) return null;

    const dy = Math.abs(sourceY - terrainY);
    if (dy > AUTO_TERRAIN_LINK_MAX_VERTICAL_DELTA) return null;

    return terrainNodes[0] ?? null;
  }

  dispose() {
    this.surfaceTopologyGraph?.removeByOwner?.(this);
    for (const bm of this._meshes) bm.dispose();
    this._meshes = [];
  }
}
