import { 
  MeshBuilder, 
  StandardMaterial, 
  Color3, 
  Vector3,
  ParticleSystem,
  Texture,
  Color4,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
} from "@babylonjs/core";

export function createTruck(scene, shadows) {
  const mesh = MeshBuilder.CreateBox("truck", { width: 1.5, height: 0.8, depth: 2.2 }, scene);
  mesh.position.y = 0.4;

  const mat = new StandardMaterial("truckMat", scene);
  mat.diffuseColor = new Color3(0.8, 0.2, 0.1);
  mesh.material = mat;
  shadows.addShadowCaster(mesh);

  // Add physics body to truck for collision with barriers
  const truckPhysics = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, {
    mass: 10,
    restitution: 0.2,
    friction: 0.5
  }, scene);
  // Use kinematic mode - controlled by us but still participates in collisions
  truckPhysics.body.setMotionType(PhysicsMotionType.ANIMATED);
  truckPhysics.body.disablePreStep = false;

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

  // Water splash particle system
  const splashParticles = new ParticleSystem("splash", 300, scene);
  splashParticles.particleTexture = new Texture("https://assets.babylonjs.com/textures/cloud.png", scene);
  splashParticles.emitter = mesh;
  splashParticles.minEmitBox = new Vector3(-0.7, 0, -0.5);
  splashParticles.maxEmitBox = new Vector3(0.7, 0, 0.5);
  
  splashParticles.color1 = new Color4(0.8, 0.9, 1.0, 0.6);
  splashParticles.color2 = new Color4(0.6, 0.8, 0.9, 0.4);
  splashParticles.colorDead = new Color4(0.4, 0.6, 0.8, 0);
  
  splashParticles.minSize = 0.4;
  splashParticles.maxSize = 1.2;
  splashParticles.minLifeTime = 0.2;
  splashParticles.maxLifeTime = 0.5;
  
  splashParticles.emitRate = 0;
  splashParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  splashParticles.gravity = new Vector3(0, -5, 0);
  splashParticles.direction1 = new Vector3(-2, 2, -1);
  splashParticles.direction2 = new Vector3(2, 3, 1);
  splashParticles.minAngularSpeed = 0;
  splashParticles.maxAngularSpeed = Math.PI * 2;
  splashParticles.minEmitPower = 3;
  splashParticles.maxEmitPower = 6;
  splashParticles.updateSpeed = 0.01;
  
  splashParticles.start();

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
    // Physics tuning
    springStrength: 150,  // Terrain collision spring constant
    damping: 7,           // Terrain collision damping (lower = more bouncy)
    maxSpeed: 25,
    maxReverseSpeed: -10,
    acceleration: 7,      // reduced from 12
    braking: 18,
    drag: 4,              // natural deceleration when no input
    turnSpeed: 3.6,       // radians/sec at full speed
    grip: 0.03,           // how fast velocity aligns to heading (0=ice, 1=instant grip)
    driftThreshold: 0.1, // angle (radians) before considered "drifting"
    isDrifting: false,
    isSpinningOut: false,
    slipAngle: 0,
  };

  return { mesh, state, particles, splashParticles, physics: truckPhysics };
}

export function updateTruck(truck, input, deltaTime, terrainManager = null, track = null) {
  const { mesh, state, particles, splashParticles, physics } = truck;

  // === VERTICAL PHYSICS ===
  const gravity = -50;
  state.verticalVelocity += gravity * deltaTime;
  
  // Check terrain collision and apply spring force
  const terrainHeight = track ? track.getHeightAt(mesh.position.x, mesh.position.z) : 0;
  const truckBottomY = terrainHeight + 0.4; // 0.4 = half truck height
  const penetration = truckBottomY - mesh.position.y;
  
  // Terrain acts as a spring - pushes back when penetrated or very close
  if (penetration > -0.2) {
    const springForce = Math.max(0, penetration) * state.springStrength;
    const dampingForce = -state.verticalVelocity * state.damping;
    
    const totalForce = springForce + dampingForce;
    state.verticalVelocity += totalForce * deltaTime;
  }
  
  // Move truck vertically
  mesh.position.y += state.verticalVelocity * deltaTime;
  
  // Calculate suspension compression
  const baseCompression = Math.max(0, Math.min(1, penetration / 0.2));
  let targetCompression = 0;
  if (baseCompression > 0) {
    const velocityCompression = Math.max(0, -state.verticalVelocity * 0.03);
    targetCompression = (baseCompression * 0.08) + velocityCompression;
  }
  
  state.suspensionCompression += (targetCompression - state.suspensionCompression) * 0.3;
  state.suspensionCompression = Math.max(0, Math.min(0.25, state.suspensionCompression));
  
  // Calculate groundedness from compression
  const groundedness = Math.min(1, state.suspensionCompression / 0.08);
  
  // Calculate visual pitch/roll when on or near ground
  if (groundedness > 0.3 && track) {
    const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    const right = new Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading));
    const slopeCheckDist = 0.3;
    
    const heightAheadVisual = track.getHeightAt(
      mesh.position.x + forward.x * slopeCheckDist,
      mesh.position.z + forward.z * slopeCheckDist
    );
    const heightBehindVisual = track.getHeightAt(
      mesh.position.x - forward.x * slopeCheckDist,
      mesh.position.z - forward.z * slopeCheckDist
    );
    const terrainSlopeAngle = Math.atan2(heightAheadVisual - heightBehindVisual, slopeCheckDist * 2);
    
    const heightRight = track.getHeightAt(
      mesh.position.x + right.x * slopeCheckDist,
      mesh.position.z + right.z * slopeCheckDist
    );
    const heightLeft = track.getHeightAt(
      mesh.position.x - right.x * slopeCheckDist,
      mesh.position.z - right.z * slopeCheckDist
    );
    const terrainRollAngle = Math.atan2(heightRight - heightLeft, slopeCheckDist * 2);
    
    mesh.rotation.x = -terrainSlopeAngle;
    state.terrainRoll = terrainRollAngle;
  } else {
    state.terrainRoll = 0;
  }

  // === HORIZONTAL PHYSICS ===
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
  const effectiveGrip = state.grip * oversteerFactor * terrainGripMultiplier * groundedness; // Apply terrain modifier and groundedness

  // Steering — scaled by groundedness (less control in air)
  if (groundedness > 0.1) {
    if (input.left)  state.heading -= effectiveTurnSpeed * speedRatio * groundedness * deltaTime;
    if (input.right) state.heading += effectiveTurnSpeed * speedRatio * groundedness * deltaTime;
  }

  // Heading direction (where the truck is pointing)
  const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));

  // Acceleration / braking — scaled by groundedness
  if (groundedness > 0.1) {
    if (input.forward) {
      // Check if we're moving backward
      const forwardSpeed = state.velocity.dot(forward);
      
      if (forwardSpeed < -0.5) {
        // Moving backward - aggressively brake and accelerate forward
        const brakeForce = state.velocity.scale(-5 * deltaTime);
        state.velocity.addInPlace(brakeForce);
        // Also add forward acceleration to quickly overcome backward momentum
        state.velocity.addInPlace(forward.scale(state.acceleration * 2 * deltaTime));
      } else {
        // At low speed or already moving forward - accelerate forward
        state.velocity.addInPlace(forward.scale(state.acceleration * deltaTime));
        if (speed > state.maxSpeed) {
          state.velocity.normalize().scaleInPlace(state.maxSpeed);
        }
      }
    } else if (input.back) {
      // Check if we're moving forward or backward
      const forwardSpeed = state.velocity.dot(forward);
      
      if (forwardSpeed > 0.5) {
        // Moving forward - apply brakes
        const brakeForce = state.velocity.scale(-1.5 * deltaTime);
        state.velocity.addInPlace(brakeForce);
      } else {
        // At low speed or already reversing - accelerate backward
        state.velocity.addInPlace(forward.scale(state.acceleration * -2.5 * deltaTime));
        // Clamp to max reverse speed
        const reverseSpeed = state.velocity.dot(forward);
        if (reverseSpeed < state.maxReverseSpeed) {
          state.velocity = forward.scale(state.maxReverseSpeed);
        }
      }
    }
  }

  // Natural drag - always applies (terrain affects drag)
  // Higher drag when coasting (not accelerating)
  if (speed > 0.1) {
    const coastingMultiplier = input.forward ? 0.3 : 0.8;
    const naturalDrag = state.velocity.scale(-coastingMultiplier * terrainDragMultiplier * deltaTime);
    state.velocity.addInPlace(naturalDrag);
  }

  // DRIFT PHYSICS: Apply grip — pull velocity toward heading direction
  // The lower the grip value, the more the truck slides sideways
  if (speed > 0.1) {
    const velocityDir = state.velocity.clone().normalize();
    
    // Check if we're moving backward (reversing)
    const forwardVelocity = state.velocity.dot(forward);
    const isReversing = forwardVelocity < 0;
    
    // When reversing, use backward direction as target and boost grip
    const targetDir = isReversing ? forward.scale(-1) : forward;
    const targetVelocity = targetDir.scale(speed);
    
    // Calculate slip angle
    state.slipAngle = Math.acos(Math.max(-1, Math.min(1, targetDir.dot(velocityDir))));
    
    // Grip naturally decreases with slip angle - creates progressive loss of control
    // At high slip angles, grip effectiveness drops exponentially
    const slipAngleFactor = Math.max(0.2, 1 - Math.pow(state.slipAngle / 1.5, 2));
    
    // Boost grip significantly when reversing for more responsive control
    const reverseGripBoost = isReversing ? 15 : 1;
    const finalGrip = effectiveGrip * slipAngleFactor * reverseGripBoost;
    
    // Apply grip - naturally spins out when grip is too low
    state.velocity = Vector3.Lerp(state.velocity, targetVelocity, finalGrip);
    
    // Track spin-out state for visual feedback
    state.isSpinningOut = state.slipAngle > 0.6 && finalGrip < 0.01;
  } else {
    state.slipAngle = 0;
    state.isSpinningOut = false;
  }

  // Move the truck based on actual velocity (not heading)
  const oldPosition = mesh.position.clone();
  const newPosition = mesh.position.add(state.velocity.scale(deltaTime));
  
  // Check if new position would collide - if so, stop movement in that direction
  if (physics) {
    // First check if we're already intersecting something (e.g., from drifting)
    const scene = mesh.getScene();
    let alreadyIntersecting = false;
    let intersectingMesh = null;
    
    scene.meshes.forEach(otherMesh => {
      if (otherMesh !== mesh && otherMesh.physicsBody && 
          (otherMesh.name.includes("concrete") || otherMesh.name.includes("hayBale"))) {
        if (mesh.intersectsMesh(otherMesh, false)) {
          alreadyIntersecting = true;
          intersectingMesh = otherMesh;
        }
      }
    });
    
    // If already intersecting, push truck away from the wall
    if (alreadyIntersecting && intersectingMesh) {
      const awayFromWall = mesh.position.subtract(intersectingMesh.position);
      awayFromWall.y = 0;
      awayFromWall.normalize();
      mesh.position.addInPlace(awayFromWall.scale(0.1)); // Push away
      state.velocity.scaleInPlace(0.3); // Reduce velocity when clipping
    }
    
    // Now try to move to new position
    mesh.position = newPosition;
    
    // Check for intersections at new position
    let hasCollision = false;
    let collisionMesh = null;
    scene.meshes.forEach(otherMesh => {
      if (otherMesh !== mesh && otherMesh.physicsBody && 
          (otherMesh.name.includes("concrete") || otherMesh.name.includes("hayBale"))) {
        if (mesh.intersectsMesh(otherMesh, false)) {
          hasCollision = true;
          collisionMesh = otherMesh;
        }
      }
    });
    
    // If collision detected, check if we're moving towards or away from it
    if (hasCollision && collisionMesh) {
      // Vector from old position to collision object
      const toCollision = collisionMesh.position.subtract(oldPosition);
      toCollision.y = 0; // Only consider horizontal direction
      toCollision.normalize();
      
      // Project velocity onto the collision normal (component moving towards collision)
      const velocityTowardsCollision = state.velocity.dot(toCollision);
      
      if (velocityTowardsCollision > 0) {
        // Check if it's a pushable hay bale
        if (collisionMesh.name.includes("hayBale") && collisionMesh.physicsBody) {
          // Apply impulse to push the hay bale
          const pushForce = toCollision.scale(velocityTowardsCollision * 200); // Scale force based on velocity
          collisionMesh.physicsBody.applyImpulse(pushForce, collisionMesh.position);
          
          // Reduce truck velocity less than hitting a wall
          const normalComponent = toCollision.scale(velocityTowardsCollision * 0.5);
          state.velocity.subtractInPlace(normalComponent);
        } else {
          // Concrete barrier - full stop
          // Moving towards collision - remove the component moving towards it
          // but keep the perpendicular component (allows sliding along walls)
          const normalComponent = toCollision.scale(velocityTowardsCollision);
          state.velocity.subtractInPlace(normalComponent);
          
          // Revert to old position to prevent clipping into wall
          mesh.position = oldPosition;
        }
      }
      // If moving away (reversing), allow the movement
    }
  } else {
    mesh.position = newPosition;
  }
  
  mesh.rotation.y = state.heading;
  
  // Sync physics body with mesh transform (ANIMATED bodies need explicit updates)
  if (truck.physics) {
    truck.physics.body.transformNode.position = mesh.position.clone();
    truck.physics.body.transformNode.rotationQuaternion = mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null;
    truck.physics.body.transformNode.rotation = mesh.rotation.clone();
  }
  
  // Apply roll - combine terrain roll with turn-based roll
  const combinedRoll = (state.terrainRoll || 0) + state.currentRoll;
  mesh.rotation.z = combinedRoll;

  // Calculate target roll (lean) based on turning
  // Roll is influenced by how fast the truck is turning relative to its speed
  if (groundedness > 0.5 && speed > 1) {
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
  const rollSpeed = groundedness > 0.5 ? 8 : 3; // Slower roll in air
  state.currentRoll += (state.targetRoll - state.currentRoll) * rollSpeed * deltaTime;

  // Update drift and particle indicator
  if (speed > 0.5) {
    state.isDrifting = state.slipAngle > state.driftThreshold;
    
    // Particle emission scales with drift intensity (more during spinout)
    const driftIntensity = Math.max(0, state.slipAngle - state.driftThreshold);
    const spinoutBoost = state.isSpinningOut ? 2.0 : 1.0;
    particles.emitRate = driftIntensity * 300 * spinoutBoost;
  } else {
    state.isDrifting = false;
    state.slipAngle = 0;
    particles.emitRate = 0;
  }
  
  // Update splash particles when in water
  const isInWater = terrainManager && terrainManager.getTerrainAt(mesh.position).name === 'WATER';
  if (isInWater && speed > 1) {
    // Splash intensity based on speed
    splashParticles.emitRate = speed * 80;
  } else {
    splashParticles.emitRate = 0;
  }
  
  // Return debug info
  return {
    compression: state.suspensionCompression,
    groundedness,
    penetration,
    verticalVelocity: state.verticalVelocity,
    speed,
    effectiveGrip,
    slipAngle: state.slipAngle,
    terrainGripMultiplier,
    x: mesh.position.x,
    y: mesh.position.y,
    z: mesh.position.z
  };
}
