# Terrain Refactor: Layered Multi-Level Surfaces

## Purpose
Define a practical refactor plan to support true multi-level tracks in Babylon.js, including bridges, overpasses, tunnels, and stacked floors, while preserving compatibility with existing content.

## Recommended Architecture Direction
1. Use triangle-mesh world geometry for all drivable surfaces.
2. Separate render meshes from collision meshes.
3. Keep static mesh colliders for world geometry and dynamic convex bodies for vehicles.
4. Add a unified drivable-surface registry and query API.
5. Drive AI routing from level-aware topology, not only 2D paths.

## Current Implementation Findings
Reviewed files:
- src/objects/Bridge.js
- src/managers/BridgeManager.js
- src/truck/TerrainPhysics.js
- src/managers/TerrainQuery.js
- src/track.js
- src/modes/SceneBuilder.js
- src/editor/BridgeEditor.js
- src/vue/editor/BridgePanel.vue
- src/vue/store.js
- src/ai/AIDriver.js

Key findings:
1. Bridge runtime is currently box-driven for both geometry assumptions and collider behavior.
2. Bridge placement is anchored to sampled terrain center height.
3. Ground is a displaced mesh with static mesh physics and terrain tagging.
4. TerrainQuery already provides ray-based floor resolution, which is a strong base for layered selection.
5. TerrainPhysics still includes slope/downhill logic that uses single-height track sampling paths.
6. Track model still contains legacy bridge fallback assumptions tied to footprint math.
7. Bridge editor schema is still largely box-parameter oriented.
8. AI pathing remains mostly 2D and lacks explicit level/layer routing state.

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

### Phase 3: Geometry Separation
Split visual terrain concerns from gameplay collision/navigation concerns.

Deliverables:
1. Keep visual displacement and shading pipeline for rendering.
2. Build explicit drivable collision meshes per layer.
3. Classify non-drivable colliders by role so floor queries cannot select them.

Notes:
1. Bridge transitions should produce drivable ramp surfaces plus independent side/ceiling blockers.
2. Decorative meshes should never be authoritative for floor resolution.

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
1. Treat transition surfaces as mesh segments with explicit entry/exit points rather than ad hoc planes.
2. Preserve a small seam overlap or stitching rule at segment boundaries so floor queries never see a gap.
3. Record connector directionality and source/target layer ids at authoring and runtime.

### Phase 5: Runtime Integration
Migrate truck physics and AI to active-surface state.

Deliverables:
1. Truck runtime tracks active surfaceId and layerId.
2. Terrain/surface sampling uses unified query API.
3. AI path planner consumes level-aware topology graph, not only 2D polylines.
4. Recovery/respawn chooses nearest valid connector and layer-consistent spawn outcomes.

### Phase 6: Editor and Data Schema
Extend authoring to layered surfaces and connectors.

Deliverables:
1. Track schema version bump.
2. Authoring fields:
   - layerId
   - connector endpoints
   - transition directionality
3. Validation overlays:
   - active layer view
   - connector flow arrows
   - unreachable surface warnings

Notes:
1. Add migration transforms so old bridge features load with sensible defaults.

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

## Migration Strategy
1. Introduce SurfaceRegistry and query API behind existing manager interfaces.
2. Migrate bridge surfaces first as pilot scope.
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
4. Existing tracks remain playable without mandatory re-authoring.
5. New layered tracks are authorable with predictable behavior.

## Suggested Milestone Breakdown
1. Milestone 1: SurfaceRegistry and query API adapters.
2. Milestone 2: Bridge pilot migration with deterministic selection.
3. Milestone 3: AI topology routing for bridge pilot.
4. Milestone 4: Tunnel support and connector tooling.
5. Milestone 5: Legacy path deprecation and full rollout.

## Suggested Implementation Order
Prioritized order to reduce breakage and unlock over/under drivability early:
1. Runtime physics sampling cleanup toward query-based layered surfaces.
2. Surface registry unification.
3. Bridge render/collision decoupling through explicit surface production.
4. Legacy bridge fallback decommission path.
5. Editor/schema upgrades.
6. AI level-aware routing.
7. Full validation and migration hardening.