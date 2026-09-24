/**
 * The game's view of @babylonjs/core.
 *
 * vite.config.js aliases the bare "@babylonjs/core" specifier to this file, so
 * every `import { X } from "@babylonjs/core"` in src/ resolves here instead of
 * Babylon's barrel. The barrel pulls in the whole engine (Babylon marks every
 * file as side-effectful, so nothing tree-shakes): ~6.5 MB minified. Importing
 * only what the game uses from deep paths is ~2 MB.
 *
 * Adding a Babylon class to the game: import it where you need it from
 * "@babylonjs/core" as usual, and add its deep export below — the build fails
 * with "X is not exported" until you do. Deep paths: find the class's file under
 * node_modules/@babylonjs/core (e.g. `export class Foo` in Bar/foo.js →
 * "@babylonjs/core/Bar/foo").
 *
 * Side effects: some features are installed onto other classes by importing a
 * module (prototype methods, scene components). The barrel imported all of
 * them; here they're listed explicitly at the bottom. Missing one fails at
 * RUNTIME — usually a Babylon error naming the module to import ("X needs to
 * be imported before…"), sometimes a plain "is not a function". When a new
 * feature throws like that, add its side-effect import here.
 *
 * Node scripts/tests don't use the alias — they get the real barrel (or
 * scripts/babylon-stub.mjs), so this file only affects the Vite build/dev.
 */

// ── Classes and values ───────────────────────────────────────────────────────
export { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
export { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
export { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
export { Ray } from "@babylonjs/core/Culling/ray"; // (also installs scene picking)
export { Constants } from "@babylonjs/core/Engines/constants";
export { Engine } from "@babylonjs/core/Engines/engine";
export { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
export { ClusteredLightContainer } from "@babylonjs/core/Lights/Clustered/clusteredLightContainer";
export { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
export { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
export { Light } from "@babylonjs/core/Lights/light";
export { PointLight } from "@babylonjs/core/Lights/pointLight";
export { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
export { SpotLight } from "@babylonjs/core/Lights/spotLight";
export { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
export { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
export { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
export { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
export { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
export { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
export { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray";
export { Texture } from "@babylonjs/core/Materials/Textures/texture";
export { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
export { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
export { Mesh } from "@babylonjs/core/Meshes/mesh";
export { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
export { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
export { SubMesh } from "@babylonjs/core/Meshes/subMesh";
export { TransformNode } from "@babylonjs/core/Meshes/transformNode";
export { Tools } from "@babylonjs/core/Misc/tools";
export { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
export { PhysicsMotionType, PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
export { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
export { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
export { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
export { Scene } from "@babylonjs/core/scene";

// ── Side effects (see header) ────────────────────────────────────────────────
import "@babylonjs/core/Meshes/thinInstanceMesh";              // mesh.thinInstance* (scatters, instanced decorations)
import "@babylonjs/core/Meshes/instancedMesh";                 // mesh.createInstance
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent"; // shadow maps render
import "@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent"; // night headlights
import "@babylonjs/core/Particles/particleSystemComponent";    // particle systems render
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent"; // scene.enablePhysics / getPhysicsEngine
import "@babylonjs/core/Rendering/prePassRendererSceneComponent"; // SSAO2
import "@babylonjs/core/Loading/loadingScreen";               // SceneLoader's default loading UI
import "@babylonjs/core/Misc/screenshotTools";                // Tools.CreateScreenshot* (editor thumbnails)
