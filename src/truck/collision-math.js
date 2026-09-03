/**
 * Distance from a box's centre to its edge along a given world-space unit
 * direction — i.e. how far an oriented (width × depth) footprint extends
 * toward that direction, not its (larger, orientation-independent)
 * circumradius. Shared between TruckCollisionManager (truck-vs-truck,
 * single-player/AI) and RemoteTruckCollision (truck-vs-remote-puppet,
 * multiplayer) so both collision models agree on what shape a truck is.
 */
export function orientedSupport(heading, width, depth, dirX, dirZ) {
  const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
  const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
  const localX = dirX * rightX + dirZ * rightZ;
  const localZ = dirX * fwdX + dirZ * fwdZ;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return halfWidth * Math.abs(localX) + halfDepth * Math.abs(localZ);
}
