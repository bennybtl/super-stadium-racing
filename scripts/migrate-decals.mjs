/**
 * One-off codemod: convert legacy `surfaceDecal` / `wallDecal` track features to
 * the unified `decal` shape (decal-unification Phase 2). Run once:
 *
 *   node scripts/migrate-decals.mjs           # rewrite in place
 *   node scripts/migrate-decals.mjs --dry     # print what would change
 *
 * `position` is a hint the build re-snaps to the live surface, so no
 * terrain-height math is needed. Rotation uses the same stable-frame offset as
 * groundDecal.decalStableAngle (kept in sync here so this script is standalone).
 */
import fs from "node:fs";
import path from "node:path";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const DRY = process.argv.includes("--dry");
const ROOTS = ["src/tracks", "track-packs"];
const REF_AXIS = new Vector3(0, 0, 1);
const REF_FALLBACK = new Vector3(1, 0, 0);
const REF_POLE = 0.9;
const RAD2DEG = 180 / Math.PI;

/** decalStableAngle(n, 0) — the normal-dependent stable-frame offset (radians). */
function frameOffset(nArr) {
  const n = Vector3.FromArray(nArr).normalize();
  const yaw = -Math.atan2(n.z, n.x) - Math.PI / 2;
  const pitch = Math.atan2(n.y, Math.hypot(n.x, n.z));
  const u0 = Vector3.TransformNormal(Vector3.Right(), Matrix.RotationYawPitchRoll(yaw, pitch, 0));
  const rollAxis = n.scale(-1);
  let ref = REF_AXIS;
  if (Math.abs(Vector3.Dot(n, ref)) > REF_POLE) ref = REF_FALLBACK;
  const refU = ref.subtract(n.scale(Vector3.Dot(n, ref)));
  refU.normalize();
  return Math.atan2(Vector3.Dot(Vector3.Cross(u0, refU), rollAxis), Vector3.Dot(u0, refU));
}

const norm180 = (deg) => (((deg % 360) + 540) % 360) - 180;

function convert(f) {
  if (f.type === "surfaceDecal") {
    const out = { type: "decal" };
    if (f.shape === "polyline" && Array.isArray(f.points)) {
      const c = f.points.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
      out.position = [+(c.x / f.points.length).toFixed(3), 0, +(c.z / f.points.length).toFixed(3)];
    } else {
      out.position = [f.centerX ?? 0, 0, f.centerZ ?? 0];
    }
    out.normal = [0, 1, 0];
    out.rotation = norm180(-(f.angle ?? 0)); // decalStableAngle(up,0) === 0
    if (f.width != null && f.shape !== "polyline") out.width = f.width;
    if (f.depth != null && f.shape !== "polyline") out.height = f.depth;
    copyCommon(f, out);
    return out;
  }
  if (f.type === "wallDecal") {
    const out = {
      type: "decal",
      position: f.position,
      normal: f.normal,
      rotation: +norm180((f.roll ?? 0) - frameOffset(f.normal) * RAD2DEG).toFixed(2),
    };
    if (f.width != null) out.width = f.width;
    if (f.height != null) out.height = f.height;
    copyCommon(f, out);
    return out;
  }
  return null;
}

function copyCommon(f, out) {
  for (const k of ["shape", "color", "count", "outline", "text", "brand", "opacity", "points", "thickness"]) {
    if (f[k] !== undefined) out[k] = f[k];
  }
}

function walk(dir, acc) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".json")) acc.push(p);
  }
}

const files = [];
ROOTS.forEach((r) => walk(r, files));

let changedFiles = 0;
let changedDecals = 0;
const wallRows = [];

for (const file of files) {
  let json;
  try { json = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
  if (!Array.isArray(json.features)) continue;
  let touched = false;
  json.features = json.features.map((f) => {
    if (f?.type !== "surfaceDecal" && f?.type !== "wallDecal") return f;
    const next = convert(f);
    if (!next) return f;
    touched = true;
    changedDecals++;
    if (f.type === "wallDecal") {
      wallRows.push(`${path.basename(file)}: roll ${f.roll ?? 0} → rotation ${next.rotation}`);
    }
    return next;
  });
  if (!touched) continue;
  changedFiles++;
  if (!DRY) fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}

console.log(`${DRY ? "[dry] " : ""}${changedDecals} decals in ${changedFiles} files`);
if (wallRows.length) {
  console.log("\nwallDecal rotation conversions (eyeball these in the editor):");
  wallRows.forEach((r) => console.log("  " + r));
}
