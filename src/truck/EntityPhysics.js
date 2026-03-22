import { Vector3 } from "@babylonjs/core";

/**
 * Handles collision physics with entities (walls, barriers, hay bales)
 */
export class EntityPhysics {
  constructor(state) {
    this.state = state;
  }

  handleCollisions(mesh, physics, oldPosition, newPosition) {
    if (!physics) {
      mesh.position = newPosition;
      return;
    }

    const scene = mesh.getScene();
    
    // Check if already intersecting something
    const { alreadyIntersecting, intersectingMesh } = this.checkExistingIntersection(mesh, scene);
    
    if (alreadyIntersecting && intersectingMesh) {
      this.resolveClipping(mesh, intersectingMesh);
    }
    
    // Try moving to new position
    mesh.position = newPosition;
    
    // Check for collisions at new position
    const { hasCollision, collisionMesh } = this.checkNewCollision(mesh, scene);
    
    if (hasCollision && collisionMesh) {
      this.resolveCollision(mesh, collisionMesh, oldPosition);
    }
  }

  checkExistingIntersection(mesh, scene) {
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
    
    return { alreadyIntersecting, intersectingMesh };
  }

  checkNewCollision(mesh, scene) {
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
    
    return { hasCollision, collisionMesh };
  }

  resolveClipping(mesh, intersectingMesh) {
    const awayFromWall = mesh.position.subtract(intersectingMesh.position);
    awayFromWall.y = 0;
    awayFromWall.normalize();
    mesh.position.addInPlace(awayFromWall.scale(0.05));
    this.state.velocity.scaleInPlace(0.95);
  }

  resolveCollision(mesh, collisionMesh, oldPosition) {
    const toCollision = collisionMesh.position.subtract(oldPosition);
    toCollision.y = 0;
    toCollision.normalize();
    
    const velocityTowardsCollision = this.state.velocity.dot(toCollision);
    
    if (velocityTowardsCollision > 0) {
      if (collisionMesh.name.includes("hayBale") && collisionMesh.physicsBody) {
        this.handleHayBaleCollision(collisionMesh, toCollision, velocityTowardsCollision);
      } else {
        this.handleWallCollision(mesh, collisionMesh, toCollision, velocityTowardsCollision, oldPosition);
      }
    }
  }

  handleHayBaleCollision(collisionMesh, toCollision, velocityTowardsCollision) {
    const pushForce = toCollision.scale(velocityTowardsCollision * 200);
    collisionMesh.physicsBody.applyImpulse(pushForce, collisionMesh.position);
    
    const normalComponent = toCollision.scale(velocityTowardsCollision * 0.5);
    this.state.velocity.subtractInPlace(normalComponent);
  }

  handleWallCollision(mesh, collisionMesh, toCollision, velocityTowardsCollision, oldPosition) {
    // Scrape along wall - remove perpendicular component, keep tangential
    const normalComponent = toCollision.scale(velocityTowardsCollision * 0.8);
    this.state.velocity.subtractInPlace(normalComponent);
    
    // Move back slightly to prevent clipping
    const awayFromWall = mesh.position.subtract(collisionMesh.position);
    awayFromWall.y = 0;
    awayFromWall.normalize();
    mesh.position = oldPosition.add(awayFromWall.scale(0.02));
  }
}
