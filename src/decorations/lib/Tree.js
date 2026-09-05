import * as BABYLON from '@babylonjs/core';

export class ProceduralTree {
    constructor(scene, options = {}) {
        this.scene = scene;

        this.options = {
            trunkHeight: options.trunkHeight || 4.0,
            trunkRadius: options.trunkRadius || 0.5,
            radialSegments: options.radialSegments || 6, // Low poly count
            maxDepth: options.maxDepth || 3,            // Level of recursive branches
            seed: options.seed || Math.random(),
            trunkColor: options.trunkColor || new BABYLON.Color3(0.35, 0.24, 0.16),
            foliageColor: options.foliageColor || new BABYLON.Color3(0.24, 0.44, 0.23),
            ...options
        };

        this.mainGroup = new BABYLON.TransformNode("tree_root", this.scene);

        // Core Materials
        this.woodMaterial = new BABYLON.StandardMaterial("wood_mat", this.scene);
        this.woodMaterial.diffuseColor = this.options.trunkColor;
        this.woodMaterial.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

        this.leafMaterial = new BABYLON.StandardMaterial("leaf_mat", this.scene);
        this.leafMaterial.diffuseColor = this.options.foliageColor;
        this.leafMaterial.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

        // Keep track of random state using the constructor seed
        this.rngSeed = this.options.seed;

        this.generate();
    }

    // Deterministic pseudo-random helper
    random() {
        let x = Math.sin(this.rngSeed++) * 10000;
        return x - Math.floor(x);
    }

    // Creates an angular, tapered branch mesh segment
    createBranchSegment(name, baseRadius, topRadius, height) {
        const branchMesh = BABYLON.MeshBuilder.CreateCylinder(name, {
            height: height,
            diameterTop: topRadius * 2,
            diameterBottom: baseRadius * 2,
            tessellation: this.options.radialSegments,
            subdivisions: 1
        }, this.scene);

        branchMesh.material = this.woodMaterial;
        branchMesh.convertToFlatShadedMesh();

        // Shift Babylon pivot point to the bottom base of the cylinder (makes joint rotation simple)
        branchMesh.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, height / 2, 0));

        return branchMesh;
    }

    // Creates a low-poly foliage cluster chunk
    createFoliageCluster(name, radius) {
        // Icosahedron with detail = 1 generates beautiful geometric facets
        const leafMesh = BABYLON.MeshBuilder.CreateIcosahedron(name, {
            radius: radius,
            flat: true,
            subdivisions: 1
        }, this.scene);

        leafMesh.material = this.leafMaterial;

        // Jitter vertices around slightly to randomize the leaf canopy shape
        const positions = leafMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let i = 0; i < positions.length; i += 3) {
            positions[i]     += (this.random() - 0.5) * (radius * 0.2); // X
            positions[i + 1] += (this.random() - 0.5) * (radius * 0.2); // Y
            positions[i + 2] += (this.random() - 0.5) * (radius * 0.2); // Z
        }
        leafMesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        
        // Recompute normals to maintain crisp lighting across modified low-poly edges
        leafMesh.convertToFlatShadedMesh();

        return leafMesh;
    }

    // Recursive function to branch out the tree matrix
    growBranch(parentNode, depth, currentRadius, currentHeight) {
        if (depth > this.options.maxDepth) {
            // Cap the branch off with a terminal leaf canopy
            const leafCluster = this.createFoliageCluster(`leaf_cap_d${depth}`, currentRadius * 5.0);
            leafCluster.parent = parentNode;
            leafCluster.position.y = currentHeight;
            return;
        }

        // 1. Generate structural wood branch
        const nextRadius = currentRadius * 0.65; // Taper the next limbs down
        const branchMesh = this.createBranchSegment(`branch_d${depth}`, currentRadius, nextRadius, currentHeight);
        branchMesh.parent = parentNode;

        // 2. Decorate lower tiers with loose, lateral side foliage masses for an oak/maple feel
        if (depth >= 2 && this.random() > 0.4) {
            const sideLeaves = this.createFoliageCluster(`side_leaves_d${depth}`, currentRadius * 3.5);
            sideLeaves.parent = branchMesh;
            sideLeaves.position.set(0, currentHeight * 0.5, 0);
        }

        // 3. Sprout split branching child nodes
        const branchCount = (depth === 1) ? 3 : 2; // Split heavily at the base trunk layer
        
        for (let i = 0; i < branchCount; i++) {
            const branchJoint = new BABYLON.TransformNode(`joint_d${depth}_i${i}`, this.scene);
            branchJoint.parent = branchMesh;
            
            // Set joint position at the absolute tip of the current parent branch
            branchJoint.position.y = currentHeight;

            // Mathematical angles mapping out natural tree spread structures
            const spreadAngle = 0.4 + (this.random() * 0.35); // Tilt outward
            const spinAngle = (i * (Math.PI * 2 / branchCount)) + (this.random() * 0.5); // Spin around center axis

            branchJoint.rotation.z = spreadAngle;
            branchJoint.rotation.y = spinAngle;

            // Recurse down another step into the grid layout
            const nextHeight = currentHeight * (0.65 + this.random() * 0.2);
            this.growBranch(branchJoint, depth + 1, nextRadius, nextHeight);
        }
    }

    generate() {
        // Create an explicit base anchor wrapper inside the root container
        const treeBaseNode = new BABYLON.TransformNode("base_node", this.scene);
        treeBaseNode.parent = this.mainGroup;

        // Fire off initial recursive generation loop (Depth = 1 is the main base trunk)
        this.growBranch(
            treeBaseNode,
            1,
            this.options.trunkRadius,
            this.options.trunkHeight
        );
    }

    getMesh() {
        return this.mainGroup;
    }
}
