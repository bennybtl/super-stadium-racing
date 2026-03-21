import { 
  MeshBuilder, 
  StandardMaterial, 
  Color3, 
  Vector3,
  ParticleSystem,
  Texture,
  Color4,
} from "@babylonjs/core";

export function createTruck(scene, shadows) {
  const mesh = MeshBuilder.CreateBox("truck", { width: 1.5, height: 0.8, depth: 2.2 }, scene);
  mesh.position.y = 0.4;

  const mat = new StandardMaterial("truckMat", scene);
  mat.diffuseColor = new Color3(0.8, 0.2, 0.1);
  mesh.material = mat;
  shadows.addShadowCaster(mesh);

  // Drift smoke particle system
  const particles = new ParticleSystem("drift", 200, scene);
  particles.particleTexture = new Texture("https://assets.babylonjs.com/textures/flare.png", scene);
  particles.emitter = mesh; // Emits from the truck
  particles.minEmitBox = new Vector3(-0.7, 0, -1);  // Rear left wheel
  particles.maxEmitBox = new Vector3(0.7, 0, -1);   // Rear right wheel
  
  particles.color1 = new Color4(0.4, 0.3, 0.2, 0.5);
  particles.color2 = new Color4(0.3, 0.25, 0.15, 0.3);
  particles.colorDead = new Color4(0.2, 0.15, 0.1, 0);
  
  particles.minSize = 0.3;
  particles.maxSize = 0.8;
  particles.minLifeTime = 0.3;
  particles.maxLifeTime = 0.6;
  
  particles.emitRate = 0; // Start off, controlled by drift intensity
  particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  particles.gravity = new Vector3(0, -1, 0);
  particles.direction1 = new Vector3(-1, 0.5, -0.5);
  particles.direction2 = new Vector3(1, 0.5, -0.5);
  particles.minAngularSpeed = 0;
  particles.maxAngularSpeed = Math.PI;
  particles.minEmitPower = 1;
  particles.maxEmitPower = 3;
  particles.updateSpeed = 0.01;
  
  particles.start();

  const state = {
    heading: 0,           // radians, 0 = facing +Z
    velocity: Vector3.Zero(), // actual movement vector (can diverge from heading = drift)
    maxSpeed: 20,
    maxReverseSpeed: -1,
    acceleration: 5,      // reduced from 12
    braking: 18,
    drag: 4,              // natural deceleration when no input
    turnSpeed: 3.6,       // radians/sec at full speed
    grip: 0.03,           // how fast velocity aligns to heading (0=ice, 1=instant grip)
    driftThreshold: 0.15, // angle (radians) before considered "drifting"
    isDrifting: false,
    slipAngle: 0,
  };

  return { mesh, state, particles };
}

export function updateTruck(truck, input, deltaTime) {
  const { mesh, state, particles } = truck;

  // Current speed magnitude
  const speed = state.velocity.length();

  // Speed-based handling adjustments
  // Understeer at high speed: turn rate decreases as you go faster
  const speedRatio = Math.min(speed / state.maxSpeed, 1);
  const understeerFactor = 1 - (speedRatio * 0.5); // At max speed, turn rate reduced by 40%
  const effectiveTurnSpeed = state.turnSpeed * understeerFactor;

  // Oversteer at high speed: grip reduces slightly, rear breaks loose easier
  const oversteerFactor = Math.max(0.5, 1 - (speedRatio * 0.3)); // At max speed, grip reduced to 70%
  const effectiveGrip = state.grip * oversteerFactor;

  // Steering — with speed-dependent turn rate
  if (input.left)  state.heading -= effectiveTurnSpeed * speedRatio * deltaTime;
  if (input.right) state.heading += effectiveTurnSpeed * speedRatio * deltaTime;

  // Heading direction (where the truck is pointing)
  const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));

  // Acceleration / braking — apply force in the heading direction
  if (input.forward) {
    state.velocity.addInPlace(forward.scale(state.acceleration * deltaTime));
    if (speed > state.maxSpeed) {
      state.velocity.normalize().scaleInPlace(state.maxSpeed);
    }
  } else if (input.back) {
    // Active braking - gradual deceleration
    const brakeForce = state.velocity.scale(-1.5 * deltaTime);
    state.velocity.addInPlace(brakeForce);
    if (state.velocity.length() < 0.1) state.velocity = Vector3.Zero();
  }

  // Gentle natural drag when coasting (much less than active braking)
  if (speed > 0.1 && !input.forward) {
    const naturalDrag = state.velocity.scale(-0.8 * deltaTime);
    state.velocity.addInPlace(naturalDrag);
  }

  // DRIFT PHYSICS: Apply grip — pull velocity toward heading direction
  // The lower the grip value, the more the truck slides sideways
  if (speed > 0.1) {
    const velocityDir = state.velocity.clone().normalize();
    const targetVelocity = forward.scale(speed);
    state.velocity = Vector3.Lerp(state.velocity, targetVelocity, effectiveGrip);
  }

  // Move the truck based on actual velocity (not heading)
  mesh.position.addInPlace(state.velocity.scale(deltaTime));
  mesh.rotation.y = state.heading;

  // Calculate slip angle and update drift indicator
  if (speed > 0.5) {
    const velocityDir = state.velocity.clone().normalize();
    state.slipAngle = Math.acos(Math.max(-1, Math.min(1, forward.dot(velocityDir))));
    state.isDrifting = state.slipAngle > state.driftThreshold;
    
    // Particle emission scales with drift intensity
    const driftIntensity = Math.max(0, state.slipAngle - state.driftThreshold);
    particles.emitRate = driftIntensity * 300; // 0-100+ particles/sec based on slide
    
    // Debug output
    if (state.isDrifting) {
      console.log(`DRIFT! Speed: ${speed.toFixed(2)}, SlipAngle: ${state.slipAngle.toFixed(3)}, EmitRate: ${particles.emitRate.toFixed(1)}`);
    } else {
      console.log(`Speed: ${speed.toFixed(2)}, SlipAngle: ${state.slipAngle.toFixed(3)}`);
    }
  } else {
    state.isDrifting = false;
    state.slipAngle = 0;
    particles.emitRate = 0;
  }
}
