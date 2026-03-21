import {
  Engine,
  Scene,
  HavokPlugin,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  PhysicsAggregate,
  PhysicsShapeType,
  FreeCamera,
  DynamicTexture,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { createTruck, updateTruck } from "./truck.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

async function createScene() {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.15, 0.12, 0.1, 1);

  // -- Physics --
  const havok = await HavokPhysics();
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  // -- Camera: fixed isometric offset, slides with the truck --
  const CAM_OFFSET = new Vector3(0, 28, -20);
  const camera = new FreeCamera("cam", CAM_OFFSET.clone(), scene);
  camera.setTarget(Vector3.Zero());

  // -- Lighting --
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.4;
  ambient.groundColor = new Color3(0.2, 0.15, 0.1);

  const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), scene);
  sun.intensity = 1.2;
  sun.position = new Vector3(20, 40, 20);

  // -- Shadows --
  const shadows = new ShadowGenerator(1024, sun);
  shadows.useBlurExponentialShadowMap = true;

  // -- Ground --
  const ground = MeshBuilder.CreateGround("ground", { width: 80, height: 80, subdivisions: 8 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  // Draw a 10x10 checkerboard across the full 512x512 texture (uScale=1, no clamping issues)
  const checkerTex = new DynamicTexture("checkerTex", { width: 512, height: 512 }, scene);
  const ctx = checkerTex.getContext();
  const tiles = 10;
  const tileSize = 512 / tiles;
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      ctx.fillStyle = ((col + row) % 2 === 0) ? "#8B7240" : "#5C4A1A";
      ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
    }
  }
  checkerTex.update();
  groundMat.diffuseTexture = checkerTex;
  ground.material = groundMat;
  ground.receiveShadows = true;
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);

  // -- Truck --
  const truck = createTruck(scene, shadows);

  // -- Input --
  const input = { forward: false, back: false, left: false, right: false };

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp")    input.forward = true;
    if (e.code === "KeyS" || e.code === "ArrowDown")  input.back    = true;
    if (e.code === "KeyA" || e.code === "ArrowLeft")  input.left    = true;
    if (e.code === "KeyD" || e.code === "ArrowRight") input.right   = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp")    input.forward = false;
    if (e.code === "KeyS" || e.code === "ArrowDown")  input.back    = false;
    if (e.code === "KeyA" || e.code === "ArrowLeft")  input.left    = false;
    if (e.code === "KeyD" || e.code === "ArrowRight") input.right   = false;
  });

  // -- Game loop --
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    updateTruck(truck, input, dt);
    // Slide the camera in the XZ plane to follow the truck, keeping the fixed offset
    const targetCamPos = truck.mesh.position.add(CAM_OFFSET);
    camera.position = Vector3.Lerp(camera.position, targetCamPos, 0.08);
    camera.setTarget(truck.mesh.position);
  });

  return scene;
}

createScene().then((scene) => {
  engine.runRenderLoop(() => scene.render());
});

window.addEventListener("resize", () => engine.resize());
