// Usage

// import * as BABYLON from '@babylonjs/core';
// import { ProceduralCactus } from './ProceduralCactus.js';

// const canvas = document.getElementById("renderCanvas");
// const engine = new BABYLON.Engine(canvas, true);

// const createScene = function () {
//     const scene = new BABYLON.Scene(engine);

//     // Camera setup
//     const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 15, new BABYLON.Vector3(0, 3, 0), scene);
//     camera.attachControl(canvas, true);

//     // Directional light creates sharp shadow planes along the ridges
//     const light = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-1, -2, -1), scene);
//     light.position = new BABYLON.Vector3(5, 10, 5);
//     light.intensity = 0.8;

//     const ambientLight = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), scene);
//     ambientLight.intensity = 0.4;

//     // Instance our generator with unique constraints
//     const uniqueCactus = new ProceduralCactus(scene, {
//         trunkHeight: 6.5,
//         trunkRadius: 0.55,
//         ribsCount: 9,
//         branchesCount: 3,
//         seed: 777 // Mutate this numerical seed value to get entirely new configurations
//     });

//     return scene;
// };

// const scene = createScene();
// engine.runRenderLoop(() => { scene.render(); });


import * as BABYLON from '@babylonjs/core';

export class ProceduralCactus {
    constructor(scene, options = {}) {
        this.scene = scene;
        
        // Core customizable parameters
        this.options = {
            trunkHeight: options.trunkHeight || 6,
            trunkRadius: options.trunkRadius || 0.6,
            ribsCount: options.ribsCount || 8,
            ribDepth: options.ribDepth || 0.12,
            branchesCount: options.branchesCount || 2,
            seed: options.seed || Math.random(),
            cactusColor: options.cactusColor || new BABYLON.Color3(0.18, 0.43, 0.25),
            ...options
        };

        this.mainGroup = new BABYLON.TransformNode("cactus_root", this.scene);
        
        // Define a stylized material
        this.material = new BABYLON.StandardMaterial("cactus_mat", this.scene);
        this.material.diffuseColor = this.options.cactusColor;
        this.material.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
        this.material.roughness = 0.8;

        this.generate();
    }

    // Generates the explicit coordinates for the jagged rib profile
    createCactusProfileShape() {
        const shape = [];
        const segments = this.options.ribsCount * 2;
        const radius = this.options.trunkRadius;
        const depth = this.options.ribDepth;

        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            // Alternate distance from center to explicitly construct clean mathematical ridges
            const currentRadius = (i % 2 === 0) ? radius : (radius - depth);
            
            const x = Math.cos(angle) * currentRadius;
            const z = Math.sin(angle) * currentRadius; // Babylon uses Y-up, so XZ plane is the floor
            
            shape.push(new THREE_OR_BABYLON_Vector3(x, 0, z)); 
        }
        // Close the path loop perfectly
        shape.push(shape[0].clone());
        return shape;
    }

    // Builds a path array for custom extrusion
    generatePath(height, curveOffset = 0) {
        const path = [];
        const steps = 15;
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const y = t * height;
            // Add an organic, sweeping trigonometric curve outwards
            const x = Math.sin(t * Math.PI * 0.5) * curveOffset;
            
            path.push(new BABYLON.Vector3(x, y, 0));
        }
        return path;
    }

    // Wraps Babylon's ExtrudeShapeCustom to build out an individual limb mesh
    createLimb(name, height, curveOffset, scaleFunction) {
        const shape = this.createCactusProfileShape();
        const path = this.generatePath(height, curveOffset);

        const limbMesh = BABYLON.MeshBuilder.ExtrudeShapeCustom(name, {
            shape: shape,
            path: path,
            scaleFunction: scaleFunction, // Handles tapering at the top tip cleanly
            ribbonClosePath: true,
            cap: BABYLON.Mesh.CAP_ALL,
            updatable: false
        }, this.scene);

        limbMesh.material = this.material;
        
        // Optimize geometric calculations by forcing clean flat lighting normals
        limbMesh.convertToFlatShadedMesh(); 
        
        return limbMesh;
    }

    generate() {
        // Taper function to round off the tips of the limbs organically
        const tipTaperFunction = (i, distance) => {
            // Keep normal thickness until the very top 15%, then drop radius exponentially
            if (i > 0.85) {
                const factor = (1.0 - i) / 0.15;
                return Math.pow(factor, 0.4); 
            }
            return 1.0;
        };

        // 1. Generate Main Trunk
        const trunkMesh = this.createLimb("cactus_trunk", this.options.trunkHeight, 0.15, tipTaperFunction);
        trunkMesh.parent = this.mainGroup;

        // Simple pseudo-random utility seeded from construction parameters
        let seedTracker = this.options.seed;
        let pseudoRandom = () => {
            let x = Math.sin(seedTracker++) * 10000;
            return x - Math.floor(x);
        };

        // 2. Generate Branches
        for (let i = 0; i < this.options.branchesCount; i++) {
            const branchPivot = new BABYLON.TransformNode(`branch_pivot_${i}`, this.scene);
            branchPivot.parent = this.mainGroup;

            // Randomize where along the height the branch attaches
            const attachY = this.options.trunkHeight * (0.35 + pseudoRandom() * 0.35);
            const branchHeight = this.options.trunkHeight * (0.4 + pseudoRandom() * 0.3);

            // Create upward sweeping limb geometry
            const branchMesh = this.createLimb(`cactus_branch_${i}`, branchHeight, branchHeight * 0.45, tipTaperFunction);
            branchMesh.parent = branchPivot;

            // Orient the limb so it extends horizontally from the trunk and curves up
            branchMesh.rotation.z = -Math.PI / 2;
            
            // Adjust position wrapper and distribute branches around the center axis
            branchPivot.position.y = attachY;
            const absoluteAngle = (i * (Math.PI * 2 / this.options.branchesCount)) + (pseudoRandom() * 0.4);
            branchPivot.rotation.y = absoluteAngle;
        }
    }

    getMesh() {
        return this.mainGroup;
    }
}

// Internal helper alias mapping back to clean standard vector syntax
function THREE_OR_BABYLON_Vector3(x, y, z) {
    return new BABYLON.Vector3(x, y, z);
}
