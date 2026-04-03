# Physics-Based Truck Implementation Plan

## Research Summary

### Babylon.js / Havok Physics Capabilities

Based on research of the Babylon.js documentation and GitHub repository, here's what's available:

#### 1. **Physics Constraints (Joints)**
Babylon.js V2 physics supports several constraint types through the `PhysicsConstraint` class:
- `BALL_AND_SOCKET` - Free rotation around pivot point
- `DISTANCE` - Maintains distance between bodies
- `HINGE` - Rotation around single axis (perfect for steering wheels)
- `SLIDER` - Linear motion along one axis
- `LOCK` - Locks all relative motion
- `SIX_DOF` (`Physics6DoFConstraint`) - Generic constraint with configurable axes

#### 2. **Constraint Motors**
Constraints can have motors with two types:
- `POSITION` - Position-based motor (move to target position)
- `VELOCITY` - Velocity-based motor (maintain target velocity)

Motors support:
- `setAxisMotorTarget()` - Set target position/velocity
- `setAxisMotorMaxForce()` - Set motor force limit
- `setAxisMotorType()` - Set motor type (POSITION/VELOCITY)

#### 3. **Forces and Impulses**
Bodies support applying physics forces:
- `applyForce(force, location)` - Apply continuous force
- `applyImpulse(impulse, location)` - Apply instant impulse
- `setLinearVelocity()` / `setAngularVelocity()` - Direct velocity control

#### 4. **Motion Types**
- `STATIC` - Never moves, for terrain/walls
- `DYNAMIC` - Fully simulated by physics engine
- `ANIMATED` - Can be moved but doesn't respond to forces (current truck uses this)

#### 5. **Mass Properties**
```javascript
body.setMassProperties({
  mass: 10,
  centerOfMass: new Vector3(0, -0.2, 0),
  inertia: new Vector3(1, 1, 1),
  inertiaOrientation: new Quaternion(0, 0, 0, 1)
});
```

#### 6. **Physics Materials**
```javascript
const material = {
  friction: 0.8,    // 0-1, sliding resistance
  restitution: 0.3  // 0-1, bounciness
};
shape.material = material;
```

#### 7. **What's NOT Available**
- ❌ No built-in raycast vehicle helper (like Bullet's btRaycastVehicle)
- ❌ No dedicated wheel joint type
- ❌ No automatic suspension simulation
- ✅ BUT: Can build all of this using 6DOF constraints + motors!

### Implementation Approach

Since Havok/Babylon doesn't provide a high-level vehicle API, we'll build our own using the primitives:

#### Option A: Constraint-Based Suspension (Recommended)
```
Chassis (DYNAMIC)
  ├─ Wheel FL (DYNAMIC) + Hinge constraint + Spring force
  ├─ Wheel FR (DYNAMIC) + Hinge constraint + Spring force  
  ├─ Wheel RL (DYNAMIC) + Hinge constraint + Spring force
  └─ Wheel RR (DYNAMIC) + Hinge constraint + Spring force
```

**Pros:**
- More realistic physics simulation
- Natural suspension behavior from physics engine
- Wheels interact with environment properly
- Can tune springs, damping, wheel mass

**Cons:**
- More complex setup
- Need to tune many parameters
- Potential instability if not configured correctly
- Higher computational cost

#### Option B: Raycast Suspension (Alternative)
```
Chassis (DYNAMIC) + 4 raycasts per frame
  └─ Apply forces based on ray hits
```

**Pros:**
- Simpler implementation
- More stable
- Lower computational cost
- Easier to tune

**Cons:**
- Less realistic
- Wheels don't physically interact with environment
- Need to fake wheel visuals

**Decision: Start with Option B (Raycast), then potentially add Option A later**

## Implementation Architecture

### New Class: `PhysicsTruck`

```javascript
export class PhysicsTruck {
  constructor(scene, shadows, diffuseColor, driver, spawnPos) {
    // Core components
    this.mesh = createChassisMesh();
    this.physics = createPhysicsBody(DYNAMIC); // Key difference!
    this.wheels = []; // 4 wheel info objects
    
    // Reusable systems
    this.particles = new ParticleEffects(this.mesh, scene);
    this.body = new TruckBody(this.mesh, scene, shadows, colors);
    
    // New physics-specific systems
    this.suspension = new RaycastSuspension(this.wheels);
    this.driveForces = new DriveForces(this.physics);
    this.steeringControl = new SteeringControl(this.wheels);
    
    this.state = createState();
  }
  
  update(input, deltaTime, terrainManager, track) {
    // 1. Raycast suspension
    const wheelContacts = this.suspension.update(this.mesh, track, deltaTime);
    
    // 2. Apply drive forces (acceleration/braking)
    this.driveForces.update(input, wheelContacts, deltaTime);
    
    // 3. Apply steering forces
    this.steeringControl.update(input, this.physics, deltaTime);
    
    // 4. Apply terrain friction (based on terrain type)
    this.applyTerrainEffects(terrainManager, wheelContacts);
    
    // 5. Visual updates
    this.body.update(this.state, input, speed, deltaTime);
    this.particles.update(this.state, speed, terrainManager, true, deltaTime);
    
    // 6. Read physics state for debug/gameplay
    return this.getDebugInfo();
  }
}
```

### Core Components

#### 1. **RaycastSuspension** (replaces TerrainPhysics)
```javascript
class RaycastSuspension {
  update(chassisMesh, track, deltaTime) {
    const contacts = [];
    
    for (const wheel of this.wheels) {
      // Raycast from wheel position downward
      const hit = this.raycast(wheel.position, -up, suspensionTravel);
      
      if (hit) {
        // Calculate compression
        const compression = suspensionTravel - hit.distance;
        
        // Spring force: F = k * x
        const springForce = compression * springStiffness;
        
        // Damping force: F = c * v
        const dampingForce = wheel.compressionVelocity * damping;
        
        // Apply upward force to chassis
        const totalForce = (springForce - dampingForce) * up;
        body.applyForce(totalForce, wheel.worldPosition);
        
        contacts.push({ wheel, hit, compression });
      }
    }
    
    return contacts;
  }
}
```

#### 2. **DriveForces** (replaces parts of Controls + DriftPhysics)
```javascript
class DriveForces {
  update(input, wheelContacts, deltaTime) {
    const rearWheelContacts = wheelContacts.filter(c => c.wheel.isRear);
    
    if (rearWheelContacts.length === 0) return; // In air
    
    // Calculate forward force
    const forwardForce = input.throttle * motorTorque;
    const brakeForce = input.brake * brakingForce;
    
    // Apply to each rear wheel contact
    for (const contact of rearWheelContacts) {
      const force = forward * (forwardForce - brakeForce);
      body.applyForce(force, contact.worldPosition);
    }
  }
}
```

#### 3. **SteeringControl** (replaces Controls steering)
```javascript
class SteeringControl {
  update(input, body, deltaTime) {
    // Calculate desired turn rate based on input and speed
    const turnTorque = input.steering * steerStrength * speedFactor;
    
    // Apply torque around Y axis
    const torque = new Vector3(0, turnTorque, 0);
    body.applyTorque(torque);
  }
}
```

### Mode Selection System

```javascript
// constants.js
export const TruckMode = {
  ARCADE: 'arcade',
  PHYSICS: 'physics'
};

// Truck factory
export function createTruckForMode(mode, scene, shadows, color, driver, spawnPos) {
  if (mode === TruckMode.PHYSICS) {
    return new PhysicsTruck(scene, shadows, color, driver, spawnPos);
  }
  return new Truck(scene, shadows, color, driver, spawnPos); // Arcade (current)
}
```

## Parameter Tuning Guide

### Physics Truck Parameters

```javascript
// Chassis
mass: 800,                  // kg
centerOfMass: (0, -0.3, 0), // Lower = more stable
inertia: (1.2, 0.8, 1.4),   // [roll, yaw, pitch] resistance

// Suspension
suspensionTravel: 0.5,      // meters
springStiffness: 25000,     // N/m (stiffer = less bounce)
damping: 2500,              // N*s/m (higher = less oscillation)
wheelRadius: 0.5,

// Drive
motorTorque: 3000,          // N*m
brakingForce: 5000,         // N
maxSteerAngle: 0.6,         // radians (~35 degrees)

// Terrain Friction (applied to ground material)
asphalt: { friction: 0.9, restitution: 0.1 },
dirt: { friction: 0.7, restitution: 0.2 },
mud: { friction: 0.4, restitution: 0.1 },
grass: { friction: 0.6, restitution: 0.15 }
```

## Implementation Steps

1. ✅ **Research** - Document Babylon.js physics capabilities
2. **Create PhysicsTruck class** - Basic structure with DYNAMIC body
3. **Implement RaycastSuspension** - Get wheels on ground
4. **Implement DriveForces** - Make it move forward/backward
5. **Implement SteeringControl** - Make it turn
6. **Add terrain friction system** - Different surfaces feel different  
7. **Create mode selector** - UI to switch between arcade/physics
8. **Parameter tuning** - Make it fun to drive
9. **AI adaptation** - Update AIDriver for physics response
10. **Testing & polish** - Fix bugs, add debugging tools
11. **Documentation** - Update AGENT.md and inline comments

## Expected Challenges

1. **Tuning Difficulty** - Getting physics to feel "fun" vs "realistic"
2. **Stability** - Physics can be jittery or explode if poorly tuned
3. **Performance** - More physics bodies = higher cost
4. **Terrain Interaction** - Need to map terrain types to physics materials dynamically
5. **AI Compatibility** - AI may need different control strategy for physics response lag

## Next Steps

Ready to start implementation! Begin with creating the basic `PhysicsTruck` class structure.
