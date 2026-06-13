import { BridgeMesh } from "../objects/BridgeMesh.js";

const AUTO_ENDPOINT_LINK_MAX_DISTANCE = 30;
const AUTO_TERRAIN_LINK_MAX_VERTICAL_DELTA = 0.75;
const AUTO_TERRAIN_PROJECTION_MAX_VERTICAL_DELTA = 1.5;

/**
 * BridgeMeshManager — creates and manages BridgeMesh objects from track features.
 */
export class BridgeMeshManager {
  constructor(scene, track, shadows = null, driveSurfaceManager = null, terrainBlendConfig = null) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this.driveSurfaceManager = driveSurfaceManager;
    this.terrainBlendConfig = terrainBlendConfig;
    this.surfaceTopologyGraph = scene?.metadata?.surfaceTopologyGraph ?? null;
    this._meshes = [];
  }

  create(feature) {
    const bm = new BridgeMesh(
      feature,
      this.track,
      this.scene,
      this.shadows,
      this.driveSurfaceManager,
      this.terrainBlendConfig
    );
    this._meshes.push(bm);
    return bm;
  }

  /**
   * Rebuild a specific feature in-place, or all bridgeMesh features when null.
   * @param {object[]} allFeatures  Full features array from the track.
   * @param {object|null} targetFeature
   */
  rebuild(allFeatures, targetFeature = null) {
    // Drop the manager's auto-connectors first so they never reference endpoint
    // nodes that bm.dispose() is about to remove below (rebuildAutoConnectorLinks
    // re-creates them once the new meshes and nodes are in place).
    this.surfaceTopologyGraph?.removeByOwner?.(this);

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
    const terrainSeamSidesByBridgeKey = new Map();

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

      const bridgeMeshKey = sourceNode.tags?.bridgeMeshKey ?? null;
      const endpointSide = sourceNode.tags?.endpointSide ?? null;
      if (bridgeMeshKey && typeof endpointSide === 'string') {
        if (!terrainSeamSidesByBridgeKey.has(bridgeMeshKey)) {
          terrainSeamSidesByBridgeKey.set(bridgeMeshKey, new Set());
        }
        terrainSeamSidesByBridgeKey.get(bridgeMeshKey).add(endpointSide);
      }
    }

    for (const bridgeMesh of this._meshes) {
      const seamSides = terrainSeamSidesByBridgeKey.get(bridgeMesh._bridgeMeshKey);
      bridgeMesh.updateTerrainSeamSurfaces(seamSides ? [...seamSides] : []);
    }
  }

  _findTerrainProjectionTarget(sourceNode, terrainNodes) {
    return this._findTerrainTarget(sourceNode, terrainNodes, AUTO_TERRAIN_PROJECTION_MAX_VERTICAL_DELTA);
  }

  /**
   * Resolve the terrain node a bridge endpoint should link to.  Validates the
   * endpoint is within `maxDy` of the terrain height beneath it, then selects
   * the terrain node whose mesh bounding box contains the endpoint XZ (so tracks
   * with more than one registered ground surface link to the right one), falling
   * back to the first terrain node when none contains it.
   */
  _findTerrainTarget(sourceNode, terrainNodes, maxDy) {
    if (!Array.isArray(terrainNodes) || terrainNodes.length === 0) return null;

    const sourceTags = sourceNode?.tags ?? {};
    const sourceX = sourceTags.endpointWorldX;
    const sourceY = sourceTags.endpointWorldY;
    const sourceZ = sourceTags.endpointWorldZ;
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) || !Number.isFinite(sourceZ)) return null;

    const terrainY = this.track?.getHeightAt?.(sourceX, sourceZ);
    if (!Number.isFinite(terrainY)) return null;

    const dy = Math.abs(sourceY - terrainY);
    if (dy > maxDy) return null;

    return this._selectTerrainNodeAt(terrainNodes, sourceX, sourceZ);
  }

  /**
   * Pick the terrain node a point (x, z) belongs to. Prefers a node whose XZ
   * bounding box contains the point; when several contain it (overlapping
   * surfaces) or none do, falls back to the node with the smallest horizontal
   * distance to its bounds. Distance-to-bounds (clamp the point into the AABB)
   * is used instead of distance-to-centre so large area surfaces rank by their
   * actual extent, not their midpoint. Degrades to the first node when no node
   * exposes usable bounds.
   */
  _selectTerrainNodeAt(terrainNodes, x, z) {
    let bestContaining = null;
    let bestContainingArea = Infinity;
    let nearest = null;
    let nearestDistSq = Infinity;

    for (const node of terrainNodes) {
      const bounds = node?.mesh?.getBoundingInfo?.()?.boundingBox;
      if (!bounds) continue;
      const min = bounds.minimumWorld;
      const max = bounds.maximumWorld;

      const contains = x >= min.x && x <= max.x && z >= min.z && z <= max.z;
      if (contains) {
        // Multiple surfaces can overlap a point; prefer the most specific
        // (smallest footprint) so a small patch wins over the base ground.
        const area = (max.x - min.x) * (max.z - min.z);
        if (area < bestContainingArea) {
          bestContainingArea = area;
          bestContaining = node;
        }
        continue;
      }

      // Not contained — measure the gap to the nearest edge of this AABB.
      const cx = Math.max(min.x, Math.min(x, max.x));
      const cz = Math.max(min.z, Math.min(z, max.z));
      const dx = x - cx;
      const dz = z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = node;
      }
    }

    return bestContaining ?? nearest ?? terrainNodes[0] ?? null;
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
    return this._findTerrainTarget(sourceNode, terrainNodes, AUTO_TERRAIN_LINK_MAX_VERTICAL_DELTA);
  }

  dispose() {
    this.surfaceTopologyGraph?.removeByOwner?.(this);
    for (const bm of this._meshes) bm.dispose();
    this._meshes = [];
  }
}
