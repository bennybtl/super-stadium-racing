// Generates public/favicon.ico + PNG favicons from the SSR logo badge.
// Run manually whenever src/assets/brands/ssr-logo-badge.png changes:
//   node scripts/generateFavicons.js

import fs from "fs";
import path from "path";
import sharp from "sharp";

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, "src", "assets", "brands", "ssr-logo-badge.png");
const publicDir = path.join(projectRoot, "public");
const icoSizes = [16, 32, 48];

// The badge's own canvas (1448x1086) has a lot of built-in transparent
// padding around the mark, so a plain resize would shrink "SSR" to a
// sliver. Crop to the opaque content's bounding box first, then pad that
// to a square so the mark fills the icon.
async function getOpaqueBoundingBox(imagePath) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return { left: 0, top: 0, width, height };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Modern ICO entries can embed PNG data directly (supported since Vista) —
// no need for a separate ico-encoding dependency.
function buildIco(pngBuffers, sizes) {
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + dirEntrySize * pngBuffers.length;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngBuffers.length, 4);

  const dirEntries = [];
  for (let i = 0; i < pngBuffers.length; i++) {
    const size = sizes[i];
    const png = pngBuffers[i];
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // offset from file start
    offset += png.length;
    dirEntries.push(entry);
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers]);
}

async function main() {
  const bbox = await getOpaqueBoundingBox(sourcePath);
  const side = Math.max(bbox.width, bbox.height);

  const squareBuffer = await sharp(sourcePath)
    .extract(bbox)
    .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  fs.mkdirSync(publicDir, { recursive: true });

  const icoPngs = await Promise.all(
    icoSizes.map((size) => sharp(squareBuffer).resize(size, size).png().toBuffer())
  );
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), buildIco(icoPngs, icoSizes));

  await sharp(squareBuffer).resize(32, 32).png().toFile(path.join(publicDir, "favicon-32x32.png"));
  await sharp(squareBuffer).resize(16, 16).png().toFile(path.join(publicDir, "favicon-16x16.png"));
  await sharp(squareBuffer).resize(180, 180).png().toFile(path.join(publicDir, "apple-touch-icon.png"));

  console.log(
    `Generated favicons from ${path.relative(projectRoot, sourcePath)} ` +
    `(content ${bbox.width}x${bbox.height} -> ${side}x${side} square)`
  );
}

main();
