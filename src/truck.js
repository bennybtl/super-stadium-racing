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
    verticalVelocity: 0,  // Y-axis velocity for jumping
    onGround: true,       // whether truck is touching the ground
    // Suspension system
    suspensionCompression: 0, // How much suspension is compressed (0 = rest, negative = extended)
    suspensionVelocity: 0,    // Rate of suspension compression/extension
    targetRoll: 0,        // Target roll angle based on turning
    currentRoll: 0,       // Actual roll angle (smoothed)
    terrainRoll: 0,       // Roll angle from terrain slope
    maxSpeed: 20,
    maxReverseSpeed: -1,
    acceleration: 5,      // reduced from 12
    braking: 18,
    drag: 4,              // natural deceleration when no input
    turnSpeed: 3.6,       // radians/sec at full speed
    grip: 0.03,           // how fast velocity aligns to heading (0=ice, 1=instant grip)
    driftThreshold: 0.15, // angle (radians) before considered "drifting"
    isDrifting: false,
    isSpinningOut: false,
    slipAngle: 0,
  };

  return { mesh, state, particles };
}

export function updateTruck(truck, input, deltaTime, terrainManager = null) {
  const { mesh, state, particles } = truck;

  // Get current terrain and apply modifiers
  let terrainGripMultiplier = 1.0;
  let terrainDragMultiplier = 1.0;
  if (terrainManager) {
    const terrain = terrainManager.getTerrainAt(mesh.position);
    terrainGripMultiplier = terrain.gripMultiplier;
    terrainDragMultiplier = terrain.dragMultiplier;
  }

  // Current speed magnitude
  const speed = state.velocity.length();

  // Speed-based handling adjustments
  // Understeer at high speed: turn rate decreases as you go faster
  const speedRatio = Math.min(speed / state.maxSpeed, 1);
  const understeerFactor = 1 - (speedRatio * 0.5); // At max speed, turn rate reduced by 40%
  const effectiveTurnSpeed = state.turnSpeed * understeerFactor;

  // Oversteer at high speed: grip reduces slightly, rear breaks loose easier
  const oversteerFactor = Math.max(0.5, 1 - (speedRatio * 0.3)); // At max speed, grip reduced to 70%
  const effectiveGrip = state.grip * oversteerFactor * terrainGripMultiplier; // Apply terrain modifier

  // Steering — only when on ground, with speed-dependent turn rate
  if (state.onGround) {
    if (input.left)  state.heading -= effectiveTurnSpeed * speedRatio * deltaTime;
    if (input.right) state.heading += effectiveTurnSpeed * speedRatio * deltaTime;
  }

  // Heading direction (where the truck is pointing)
  const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));

  // Acceleration / braking — only when on ground
  if (state.onGround) {
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
  }

  // Gentle natural drag when coasting (terrain affects drag)
  if (speed > 0.1 && !input.forward) {
    const naturalDrag = state.velocity.scale(-0.8 * terrainDragMultiplier * deltaTime);
    state.velocity.addInPlace(naturalDrag);
  }

  // DRIFT PHYSICS: Apply grip — pull velocity toward heading direction
  // The lower the grip value, the more the truck slides sideways
  if (speed > 0.1) {
    const velocityDir = state.velocity.clone().normalize();
    const targetVelocity = forward.scale(speed);
    
    // Calculate slip angle before applying grip
    state.slipAngle = Math.acos(Math.max(-1, Math.min(1, forward.dot(velocityDir))));
    
    // SPIN-OUT MECHANIC: If slip angle exceeds terrain-dependent breakpoint, lose all grip
    // Higher grip surfaces allow more angle before spinning out
    const spinoutThreshold = 0.35 + (terrainGripMultiplier * 0.25); // 0.45-0.725 radians (~26-42 degrees)
    
    if (state.slipAngle > spinoutThreshold && speed > 3) {
      // Spinning out! Apply counter-rotation to the heading (rear swings out faster)
      const spinDirection = Math.sign(Math.sin(state.slipAngle));
      const spinRate = (state.slipAngle - spinoutThreshold) * 3; // Stronger spin as angle increases
      state.heading += spinRate * deltaTime * spinDirection;
      
      // Reduce grip drastically during spinout
      state.velocity = Vector3.Lerp(state.velocity, targetVelocity, effectiveGrip * 0.2);
      state.isSpinningOut = true;
    } else {
      // Normal grip application
      state.velocity = Vector3.Lerp(state.velocity, targetVelocity, effectiveGrip);
      state.isSpinningOut = false;
    }
  } else {
    state.slipAngle = 0;
    state.isSpinningOut = false;
  }

  // Move the truck based on actual velocity (not heading)
  mesh.position.addInPlace(state.velocity.scale(deltaTime));
  mesh.rotation.y = state.heading;

  // Calculate target roll (lean) based on turning
  // Roll is influenced by how fast the truck is turning relative to its speed
  if (state.onGround && speed > 1) {
    // Calculate lateral (sideways) component of velocity
    const right = new Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading));
    const lateralSpeed = state.velocity.dot(right);
    
    // Calculate turn rate
    let turnRate = 0;
    if (input.left) turnRate = -effectiveTurnSpeed * speedRatio;
    if (input.right) turnRate = effectiveTurnSpeed * speedRatio;
    
    // Combine lateral speed and turn rate for roll
    const rollFromLateral = lateralSpeed * 0.04; // Lean into the slide
    const rollFromTurning = turnRate * speed * 0.02; // Lean into the turn
    state.targetRoll = rollFromLateral + rollFromTurning; // Positive = lean right when turning right
    
    // Clamp roll to reasonable limits
    state.targetRoll = Math.max(-0.25, Math.min(0.25, state.targetRoll));
  } else {
    state.targetRoll = 0;
  }
  
  // Smooth roll towards target
  const rollSpeed = state.onGround ? 8 : 3; // Slower roll in air
  state.currentRoll += (state.targetRoll - state.currentRoll) * rollSpeed * deltaTime;

  // Update drift and particle indicator
  if (speed > 0.5) {
    state.isDrifting = state.slipAngle > state.driftThreshold;
    
    // Particle emission scales with drift intensity (more during spinout)
    const driftIntensity = Math.max(0, state.slipAngle - state.driftThreshold);
    const spinoutBoost = state.isSpinningOut ? 2.0 : 1.0;
    particles.emitRate = driftIntensity * 300 * spinoutBoost;
    
    // Debug output
    if (state.isSpinningOut) {
      console.log(`SPINOUT! Speed: ${speed.toFixed(2)}, SlipAngle: ${state.slipAngle.toFixed(3)} rad`);
    } else if (state.isDrifting) {
      console.log(`DRIFT! Speed: ${speed.toFixed(2)}, SlipAngle: ${state.slipAngle.toFixed(3)}`);
    }
  } else {
    state.isDrifting = false;
    state.slipAngle = 0;
    particles.emitRate = 0;
  }
}
