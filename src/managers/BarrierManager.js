import { 
  MeshBuilder, 
  StandardMaterial, 
  Color3, 
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType
} from "@babylonjs/core";

/**
 * BarrierManager - Creates and manages barriers (concrete walls and hay bales)
 */
export class BarrierManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this.hayBales = [];
    this.concreteBarriers = [];
  }

  createBarriers() {
    // Create visual and physics representation for barriers
    for (const feature of this.track.features) {
      if (feature.type === "concreteBarrier") {
        this.createConcreteBarrier(feature);
      } else if (feature.type === "hayBales") {
        this.createHayBale(feature);
      }
    }
  }

  createConcreteBarrier(feature) {
    const terrainHeight = this.track.getHeightAt(feature.centerX, feature.centerZ);
    
    // Create concrete barrier mesh
    const barrier = MeshBuilder.CreateBox("concreteBarrier", {
      width: feature.length,
      height: feature.height,
      depth: 0.5
    }, this.scene);
    
    barrier.position = new Vector3(
      feature.centerX,
      terrainHeight + feature.height / 2,
      feature.centerZ
    );
    barrier.rotation.y = feature.heading;
    
    // Concrete material
    const concreteMat = new StandardMaterial("concreteMat", this.scene);
    concreteMat.diffuseColor = new Color3(0.6, 0.6, 0.6);
    concreteMat.specularColor = new Color3(0.2, 0.2, 0.2);
    barrier.material = concreteMat;
    barrier.receiveShadows = true;
    this.shadows.addShadowCaster(barrier);
    
    // Static physics body (immovable)
    new PhysicsAggregate(barrier, PhysicsShapeType.BOX, {
      mass: 0,
      restitution: 0.8,
      friction: 0.0
    }, this.scene);
    
    // Store reference for disposal
    this.concreteBarriers.push(barrier);
  }

  createHayBale(feature) {
    const terrainHeight = this.track.getHeightAt(feature.centerX, feature.centerZ);
    
    // Create hay bale mesh
    const hayBale = MeshBuilder.CreateBox("hayBale", {
      width: feature.length,
      height: feature.height,
      depth: feature.depth || 1.2
    }, this.scene);
    
    hayBale.position = new Vector3(
      feature.centerX,
      terrainHeight + feature.height / 2,
      feature.centerZ
    );
    hayBale.rotation.y = feature.heading;
    
    // Hay material (golden yellow)
    const hayMat = new StandardMaterial("hayMat", this.scene);
    hayMat.diffuseColor = new Color3(0.8, 0.7, 0.3);
    hayMat.specularColor = new Color3(0.1, 0.1, 0.05);
    hayBale.material = hayMat;
    hayBale.receiveShadows = true;
    this.shadows.addShadowCaster(hayBale);
    
    // Dynamic physics body (can be pushed, but heavy and slow)
    const hayPhysics = new PhysicsAggregate(hayBale, PhysicsShapeType.BOX, {
      mass: 50, // Heavy so it's hard to push
      restitution: 0.01, // Very low bounce
      friction: 2.5 // Very high friction makes it slow down quickly
    }, this.scene);
    
    // Set motion type to dynamic but keep them grounded
    hayPhysics.body.setMotionType(PhysicsMotionType.DYNAMIC);
    hayPhysics.body.setLinearDamping(5.0); // Increased damping to reduce bounce
    hayPhysics.body.setAngularDamping(3.0); // Increased to prevent spinning
    
    // Keep hay bales at terrain level by locking Y position after physics
    this.hayBales.push({ 
      mesh: hayBale,
      physics: hayPhysics,
      initialHeight: terrainHeight + feature.height / 2 
    });
  }

  disposeAll() {
    // Dispose all concrete barriers
    for (const barrier of this.concreteBarriers) {
      if (barrier.physicsBody) {
        barrier.physicsBody.dispose();
      }
      barrier.dispose();
    }
    this.concreteBarriers = [];
    
    // Dispose all hay bales
    for (const bale of this.hayBales) {
      if (bale.physics) {
        bale.physics.dispose();
      }
      bale.mesh.dispose();
    }
    this.hayBales = [];
  }

  reset() {
    // Dispose and recreate all barriers
    this.disposeAll();
    this.createBarriers();
  }

  update() {
    // Keep hay bales at terrain level
    for (const bale of this.hayBales) {
      bale.mesh.position.y = bale.initialHeight;
    }
  }

  getHayBales() {
    return this.hayBales;
  }
}
