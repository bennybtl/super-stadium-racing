/**
 * SurfaceTopologyGraph
 *
 * Stores connectivity between drivable surface segments so runtime systems
 * can reason about legal transitions explicitly instead of inferring joins
 * from raw mesh adjacency.
 */
export class SurfaceTopologyGraph {
  constructor(scene = null) {
    this.scene = scene;
    this._nodesById = new Map();
    this._connectorsById = new Map();
    this._nextNodeId = 1;
    this._nextConnectorId = 1;
    this._ownerNodeIds = new WeakMap();
    this._ownerConnectorIds = new WeakMap();
  }

  static get VALID_CONNECTOR_TYPES() {
    return new Set(['RampUp', 'RampDown', 'TunnelPortal', 'DeckJoin']);
  }

  registerNode(owner, options = {}) {
    if (!owner) return null;

    const {
      mesh = null,
      surfaceId = mesh?.metadata?.surfaceId ?? null,
      layerId = mesh?.metadata?.level ?? 0,
      role = mesh?.metadata?.surfaceRole ?? 'drive',
      kind = mesh?.metadata?.surfaceKind ?? 'unknown',
      connectorType = null,
      tags = {},
    } = options;

    const nodeId = this._nextNodeId++;
    const record = {
      nodeId,
      owner,
      mesh,
      surfaceId,
      layerId,
      role,
      kind,
      connectorType,
      tags: { ...tags },
    };

    this._nodesById.set(nodeId, record);

    const ownerIds = this._ownerNodeIds.get(owner) ?? [];
    ownerIds.push(nodeId);
    this._ownerNodeIds.set(owner, ownerIds);

    return nodeId;
  }

  registerConnector(owner, options = {}) {
    if (!owner) return null;

    const {
      fromNodeId = null,
      toNodeId = null,
      fromSurfaceId = null,
      toSurfaceId = null,
      type = 'DeckJoin',
      oneWay = false,
      tags = {},
    } = options;

    const connectorId = this._nextConnectorId++;
    const record = {
      connectorId,
      owner,
      fromNodeId,
      toNodeId,
      fromSurfaceId,
      toSurfaceId,
      type,
      oneWay: oneWay === true,
      tags: { ...tags },
    };

    this._connectorsById.set(connectorId, record);

    const ownerIds = this._ownerConnectorIds.get(owner) ?? [];
    ownerIds.push(connectorId);
    this._ownerConnectorIds.set(owner, ownerIds);

    return connectorId;
  }

  removeByOwner(owner) {
    if (!owner) return;

    for (const nodeId of this._ownerNodeIds.get(owner) ?? []) {
      this._nodesById.delete(nodeId);
    }
    for (const connectorId of this._ownerConnectorIds.get(owner) ?? []) {
      this._connectorsById.delete(connectorId);
    }

    this._ownerNodeIds.delete(owner);
    this._ownerConnectorIds.delete(owner);
  }

  getNode(nodeId) {
    return this._nodesById.get(nodeId) ?? null;
  }

  getConnector(connectorId) {
    return this._connectorsById.get(connectorId) ?? null;
  }

  getAllNodes() {
    return Array.from(this._nodesById.values());
  }

  getAllConnectors() {
    return Array.from(this._connectorsById.values());
  }

  validate() {
    const nodes = this.getAllNodes();
    const connectors = this.getAllConnectors();
    const issues = [];
    const validConnectorTypes = SurfaceTopologyGraph.VALID_CONNECTOR_TYPES;

    const nodeIds = new Set(nodes.map(node => node.nodeId));
    const nodesById = new Map(nodes.map(node => [node.nodeId, node]));
    const adjacency = new Map();
    for (const node of nodes) {
      adjacency.set(node.nodeId, { in: 0, out: 0 });
    }

    for (const connector of connectors) {
      if (!validConnectorTypes.has(connector.type)) {
        issues.push({
          type: 'invalid-connector-type',
          connectorId: connector.connectorId,
          connectorType: connector.type,
        });
      }

      const fromExists = Number.isFinite(connector.fromNodeId) && nodeIds.has(connector.fromNodeId);
      const toExists = Number.isFinite(connector.toNodeId) && nodeIds.has(connector.toNodeId);

      if (!fromExists || !toExists) {
        issues.push({
          type: 'dangling-connector',
          connectorId: connector.connectorId,
          fromNodeId: connector.fromNodeId,
          toNodeId: connector.toNodeId,
        });
        continue;
      }

      const fromNode = nodesById.get(connector.fromNodeId);
      const toNode = nodesById.get(connector.toNodeId);

      adjacency.get(connector.fromNodeId).out++;
      adjacency.get(connector.toNodeId).in++;

      if (fromNode && toNode) {
        if (fromNode.layerId !== toNode.layerId) {
          const isVerticalType = connector.type === 'RampUp' || connector.type === 'RampDown' || connector.type === 'TunnelPortal';
          if (!isVerticalType) {
            issues.push({
              type: 'cross-layer-connector-uses-horizontal-type',
              connectorId: connector.connectorId,
              connectorType: connector.type,
              fromLayerId: fromNode.layerId,
              toLayerId: toNode.layerId,
            });
          }
        } else if (connector.type === 'RampUp' || connector.type === 'RampDown' || connector.type === 'TunnelPortal') {
          issues.push({
            type: 'same-layer-connector-uses-vertical-type',
            connectorId: connector.connectorId,
            connectorType: connector.type,
            layerId: fromNode.layerId,
          });
        }
      }

      if (!connector.oneWay && connector.fromNodeId === connector.toNodeId) {
        issues.push({
          type: 'self-loop',
          connectorId: connector.connectorId,
          nodeId: connector.fromNodeId,
        });
      }
    }

    for (const node of nodes) {
      const degree = adjacency.get(node.nodeId);
      if (!degree || (degree.in === 0 && degree.out === 0)) {
        issues.push({
          type: 'disconnected-node',
          nodeId: node.nodeId,
          surfaceId: node.surfaceId,
          kind: node.kind,
          layerId: node.layerId,
        });
      }
    }

    // Prefer at least one in/out transition on each non-connector node.
    for (const node of nodes) {
      if (node.connectorType) continue;
      const degree = adjacency.get(node.nodeId);
      if (degree && degree.in === 0 && degree.out > 0) {
        issues.push({
          type: 'one-way-source-without-return-path',
          nodeId: node.nodeId,
          surfaceId: node.surfaceId,
          kind: node.kind,
          layerId: node.layerId,
        });
      }
    }

    return {
      nodeCount: nodes.length,
      connectorCount: connectors.length,
      issues,
      valid: issues.length === 0,
    };
  }

  get count() {
    return this._nodesById.size;
  }
}