/**
 * Parse a .obj file's text for which material each face group uses, by
 * tracking the most recent `g <name>` / `usemtl <material>` pair. Groups with
 * no faces (e.g. a Blender export's vertex-pool header group) never see a
 * `usemtl` line and are omitted.
 */
function parseGroupMaterials(objText) {
  const groupToMaterial = {};
  let currentGroup = null;
  for (const line of objText.split('\n')) {
    const g = line.match(/^g\s+(\S+)/);
    if (g) { currentGroup = g[1]; continue; }
    const u = line.match(/^usemtl\s+(\S+)/);
    if (u && currentGroup) groupToMaterial[currentGroup] = u[1];
  }
  return groupToMaterial;
}

/** Parse a .mtl file's text for each material's diffuse (Kd) colour. */
function parseMtlColors(mtlText) {
  const materialToColor = {};
  let currentMaterial = null;
  for (const line of mtlText.split('\n')) {
    const n = line.match(/^newmtl\s+(\S+)/);
    if (n) { currentMaterial = n[1]; continue; }
    const kd = line.match(/^Kd\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
    if (kd && currentMaterial) {
      materialToColor[currentMaterial] = [parseFloat(kd[1]), parseFloat(kd[2]), parseFloat(kd[3])];
    }
  }
  return materialToColor;
}

/**
 * Build { groupName: [r,g,b] } for every OBJ group whose material has a Kd
 * colour in the .mtl — the default fixed colour for meshes not opted into
 * user/driver colouring (decorations' `colorableMeshes`, vehicles' same).
 */
export function parseMeshDefaultColors(objText, mtlText) {
  const groupToMaterial = parseGroupMaterials(objText);
  const materialToColor = parseMtlColors(mtlText);
  const meshDefaultColors = {};
  for (const [group, material] of Object.entries(groupToMaterial)) {
    const color = materialToColor[material];
    if (color) meshDefaultColors[group] = color;
  }
  return meshDefaultColors;
}

/**
 * Fetch an OBJ from its asset URL and derive its meshDefaultColors against the
 * sibling .mtl (looked up by filename via `mtlTextFor`). The OBJ is fetched,
 * not bundled as a raw string: Babylon's loader requests the same hashed URL
 * when the model is built and gets it from the HTTP cache, so each model is
 * downloaded once and stays out of the JS bundle. Null when the OBJ has no
 * `mtllib`, the .mtl has no usable colours, or the fetch fails.
 */
export async function fetchMeshDefaultColors(objUrl, mtlTextFor) {
  if (!objUrl) return null;
  let obj;
  try {
    const res = await fetch(objUrl);
    if (!res.ok) return null;
    obj = await res.text();
  } catch {
    return null;
  }
  const mtlFile = obj.match(/^mtllib\s+(\S+)/m)?.[1];
  const mtl = mtlFile ? mtlTextFor(mtlFile) : null;
  if (!mtl) return null;
  const colors = parseMeshDefaultColors(obj, mtl);
  return Object.keys(colors).length ? colors : null;
}
