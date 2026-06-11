# Terrain Refactor: Layered Multi-Level Surfaces

## Purpose
Define a practical refactor plan to support true multi-level tracks in Babylon.js, including bridges, overpasses, tunnels, and stacked floors, while preserving compatibility with existing content.

Note: legacy box bridge features have been removed from runtime/editor usage and are no longer present in shipped tracks. This plan treats bridgeMesh as the bridge baseline and ignores legacy bridge migration.

## Recommended Architecture Direction
1. Use triangle-mesh world geometry for all drivable surfaces.
2. Separate render meshes from collision meshes.
3. Keep static mesh colliders for world geometry and dynamic convex bodies for vehicles.
4. Add a unified drivable-surface registry and query API.
5. Drive AI routing from level-aware topology, not only 2D paths.

## Current Implementation Findings
Reviewed files:
- src/truck/TerrainPhysics.js
- src/managers/TerrainQuery.js
- src/managers/DriveSurfaceManager.js
- src/managers/SurfaceRegistry.js
- src/managers/SurfaceTopologyGraph.js
- src/track.js
- src/modes/SceneBuilder.js
- src/objects/BridgeMesh.js
- src/managers/BridgeMeshManager.js
- src/editor/BridgeMeshEditor.js
- src/vue/editor/BridgeMeshPanel.vue
- src/vue/store.js
- src/ai/AIDriver.js

Key findings:
1. Surface registry foundation exists (`SurfaceRegistry` + `DriveSurfaceManager`) with surface id/level/role metadata.
2. Ground and bridgeMesh top surfaces are registered as drivable surfaces.
3. TerrainQuery already resolves layered drivable hits with top-face filtering and normal filtering.
4. BridgeMesh transition strips have been removed; bridgeMesh now registers deck-only drivable surfaces.
5. SurfaceTopologyGraph exists and bridgeMesh runtime node/connector wiring is now in place for the bridge pilot.
6. Truck runtime now feeds continuity hints from last resolved surface into query selection; multi-probe floor sampling is active, with AI running always-on multi-probe at full terrain sampling cadence to harden bridge-edge reliability.
7. AI pathing remains mostly 2D/checkpoint or authored path based, without topology/layer routing.
8. Track schema/editor tools now expose bridgeMesh metadata controls (layer id, thickness, rotation, connector endpoints); transition controls were removed.
9. Legacy bridge helper code in Track has been removed; TerrainQuery + drive-surface registration are authoritative.

## Goals
1. Support multiple drivable layers at the same XZ location.
2. Make floor/surface selection deterministic and stateful.
3. Separate visual terrain from gameplay collision/navigation surfaces.
4. Add explicit connectivity between layers for AI and recovery.
5. Preserve old track behavior through migration wrappers.

## Guiding Principles
1. Keep old tracks playable during migration.
2. Introduce compatibility layers first, then deprecate legacy paths.
3. Prefer explicit surface roles over inferred metadata behavior.
4. Ship in incremental phases with validation scenes and profiling checkpoints.

## Phased Refactor Plan

### Phase 1: Surface Domain Model
Create a unified SurfaceRegistry manager that tracks all gameplay-relevant surfaces.

Deliverables:
1. Surface record schema with:
   - surfaceId
   - layerId
   - role (drive, boundary, ceiling, obstacle)
   - bounds
   - source feature id
   - priority and selection hints
2. Backward-compatible registration path from DriveSurfaceManager.
3. Initial bridge deck and ramp registration with explicit layer ids.

Status:
1. Done for registry foundations (`SurfaceRegistry`, `DriveSurfaceManager`).
2. Done for ground + bridgeMesh deck surfaces.
3. In progress: registration infrastructure is ready; broaden runtime registration coverage as future multi-level feature producers (tunnels/overpasses beyond bridgeMesh) are implemented.

### Phase 2: Unified Surface Query API
Replace direct ad hoc picking with a stable query contract.

Deliverables:
1. queryDriveSurfaceAt(x, z, hintY, options)
2. castDownToDriveSurface(x, z, fromY, options)
3. querySurfacesInBounds(bounds, filter)
4. Deterministic policy:
   - prefer upward-facing drive-role surfaces
   - prefer active layer continuity when confidence is high
   - support explicit filters and transition locks

Notes:
1. TerrainQuery becomes an adapter over this API.
2. Legacy fallback remains enabled during migration.

Status:
1. Done: `castDownToDriveSurface`, `castUpToDriveSurface`, and `queryDriveSurfaceAt` are implemented and now serve as the authoritative query path when DriveSurfaceManager is present.
2. Done: TerrainQuery now resolves `castDown`/`heightAtFast` through DriveSurfaceManager query APIs (layered top-face filtering + continuity lock + upward-fallback guard); legacy scene-raycast fallback is explicit opt-in for migration-only use.
3. Done: `querySurfacesInBounds(bounds, filter)` and explicit transition-lock continuity options in query calls are implemented.

### Phase 3: Geometry Separation
Split visual terrain concerns from gameplay collision/navigation concerns.

Deliverables:
1. Keep visual displacement and shading pipeline for rendering.
2. Build explicit drivable collision meshes per layer.
3. Classify non-drivable colliders by role so floor queries cannot select them.

Notes:
1. BridgeMesh currently ships without transition strips; any future ramp/connectors should be modeled as explicit layered features plus side/ceiling blockers.
2. Decorative meshes should never be authoritative for floor resolution.

Status:
1. Done for bridgeMesh: visible mesh is separate from hidden drivable top mesh.
2. Remaining: if future layered feature types need non-drivable sides/ceilings, handle those as explicit authored blockers rather than relying on the visual mesh.

### Phase 4: Layer Connectivity Topology
Add explicit graph connectivity between drivable layers.

Deliverables:
1. Surface connectivity graph:
   - nodes: drivable surface segments or lane segments
   - edges: legal transitions between adjacent segments
2. Connector types:
   - RampUp
   - RampDown
   - TunnelPortal
   - DeckJoin
3. Validation pass for disconnected topology or invalid one-way links.

Notes:
1. Treat any future connector surfaces as explicit mesh segments with entry/exit points rather than ad hoc planes.
2. Preserve a small seam overlap or stitching rule at segment boundaries so floor queries never see a gap.
3. Record source/target layer ids at authoring and runtime, with connector directionality deferred until endpoint authoring is in place.

Status:
1. Scaffold done: `SurfaceTopologyGraph` supports nodes/connectors and validation.
2. Done for bridgeMesh pilot: runtime topology registration covers bridgeMesh deck nodes.
3. In progress: bridgeMesh authoring/runtime now carries explicit connector endpoint metadata and target-layer hints; external linkage behavior and validation overlays still remain.

### Phase 5: Runtime Integration
Migrate truck physics and AI to active-surface state.

Deliverables:
1. Truck runtime tracks active surfaceId and layerId.
2. Terrain/surface sampling uses unified query API.
3. AI path planner consumes level-aware topology graph, not only 2D polylines.
4. Recovery/respawn chooses nearest valid connector and layer-consistent spawn outcomes.

Status:
1. Partially done: truck debug/state includes resolved surface metadata from TerrainQuery.
2. In progress: runtime surface continuity uses last resolved surface metadata in query selection; multi-probe sampling is enabled for player trucks and always-on full-cadence for AI trucks, which resolved intermittent bridge-edge misses in validation.
3. Remaining: integrate AI planner with topology graph and layered connectors.
4. In progress: AI spawn recovery now prefers nearby topology connector nodes with layer-aware matching, with path/spiral fallback.

### Phase 6: Editor and Data Schema
Extend authoring to layered surfaces and connectors.

Deliverables:
1. Track schema version bump.
2. Authoring fields:
   - layerId
   - connector endpoints
   - transition directionality (deferred)
   - bridgeMesh rotation
   - bridgeMesh thickness
3. Validation overlays:
   - active layer view
   - connector flow arrows
   - unreachable surface warnings

Notes:
1. Legacy box bridge migration is intentionally out of scope (legacy bridge features are not used).
2. Focus migration/tooling effort on bridgeMesh and future layered feature types.

Status:
1. In progress: bridgeMesh authoring/UI now includes layer id, thickness, rotation, and connector endpoint metadata.
2. Done: track schema version bump added with backward-compatible loading defaults.
3. Done: explicit bridgeMesh connector endpoint fields are wired through schema/editor/runtime metadata.
4. Remaining: validation overlays for layer view, connector flow, and unreachable surfaces.

### Phase 7: Performance and Validation
Lock correctness and runtime cost.

Deliverables:
1. Regression scenes:
   - single bridge over ground
   - tunnel under bridge
   - stacked overpasses
   - triple-level crossover
2. Surface query correctness tests.
3. Runtime telemetry:
   - active surface id
   - layer switches
   - invalid transition attempts
4. Performance budgets for:
   - surface query cost
   - AI routing update cost
   - collision update cost

Status:
1. In progress: added layered query regression assets/check script (`public/tracks/layered_query_regression.json`, `npm run check:surfaces`) covering overlapping surface over/under resolution + layer filtering.
2. Remaining: add telemetry counters for layer switches and invalid transitions.
3. Remaining: codify and enforce budgets in profiling passes.

## Migration Strategy
1. Introduce SurfaceRegistry and query API behind existing manager interfaces.
2. Use bridgeMesh surfaces as pilot scope.
3. Enable level-aware AI routing on migrated assets.
4. Expand to tunnels and stacked-floor authoring.
5. Deprecate metadata-only legacy selection once parity is proven.

## Practical Risks
1. Increased complexity from dual-path compatibility.
2. Authoring UX complexity for layer and connector workflows.
3. Potential query/routing overhead if not profiled early.

## Mitigations
1. Keep each phase scoped and feature-flagged.
2. Add debug visualizations early in Phases 1-3.
3. Add profiling checkpoints after each milestone.
4. Validate each phase with dedicated test tracks before broad rollout.

## Success Criteria
1. AI reliably enters/exits bridge ramps at race speeds.
2. AI selects correct layer in overlapping XZ spaces.
3. Player and AI produce consistent surface resolution outcomes.
4. Existing bridgeMesh tracks remain playable without mandatory re-authoring.
5. New layered tracks are authorable with predictable behavior.

## Suggested Milestone Breakdown
1. Milestone 1: SurfaceRegistry and query API adapters.
2. Milestone 2: BridgeMesh pilot with deterministic layered selection.
3. Milestone 3: AI topology routing for bridge pilot.
4. Milestone 4: Tunnel support and connector tooling.
5. Milestone 5: Legacy path deprecation and full rollout.

## Suggested Implementation Order
Prioritized order to reduce breakage and unlock over/under drivability early:
1. Runtime physics sampling cleanup toward query-based layered surfaces.
2. Surface registry unification.
3. BridgeMesh render/collision decoupling through explicit surface production.
4. Topology node/connector wiring for bridgeMesh transitions.
5. Editor/schema upgrades.
6. AI level-aware routing.
7. Full validation and migration hardening.

## Remaining Work Checklist
1. Expand runtime topology registration beyond the bridgeMesh pilot and expose authoring-driven connector metadata.
2. Complete bridgeMesh schema/editor metadata with explicit connector endpoint authoring.
3. Integrate AI path planning with topology graph connectors.
4. Add layer-aware recovery/respawn selection using connector graph.
5. Done: removed stale legacy bridge helper logic from `Track` after confirming no callers.
6. In progress: layered regression fixture + automated query correctness check added; expand to more scenarios and perf assertions.