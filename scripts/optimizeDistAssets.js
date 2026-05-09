import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import sharp from "sharp";
import ffmpegStatic from "ffmpeg-static";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const distAssetsDir = path.join(distDir, "assets");
const sourceTracksDir = path.join(projectRoot, "tracks");
const distTracksDir = path.join(distDir, "tracks");
const ffmpegPath = ffmpegStatic || "ffmpeg";
const pngKeepSourceDirs = [
  path.join(projectRoot, "src", "assets", "brands"),
  path.join(projectRoot, "src", "assets", "decals"),
];

function walkFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

function getTotalBytes(files) {
  return files.reduce((sum, file) => {
    try {
      return sum + fs.statSync(file).size;
    } catch {
      return sum;
    }
  }, 0);
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function replaceInTextFile(filePath, replacements) {
  const original = fs.readFileSync(filePath, "utf8");
  let next = original;

  for (const [from, to] of replacements) {
    if (from !== to) {
      next = next.split(from).join(to);
    }
  }

  if (next !== original) {
    fs.writeFileSync(filePath, next, "utf8");
    return true;
  }

  return false;
}

function loadPngKeepStemSet() {
  const stems = new Set();

  for (const dir of pngKeepSourceDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    for (const file of walkFiles(dir)) {
      if (path.extname(file).toLowerCase() !== ".png") {
        continue;
      }
      stems.add(path.parse(file).name);
    }
  }

  return stems;
}

function getSourceStemFromDistAsset(filePath) {
  const stem = path.parse(filePath).name;
  return stem.replace(/-[A-Za-z0-9_-]{6,}$/, "");
}

function copyTrackStaticFiles() {
  if (!fs.existsSync(sourceTracksDir)) {
    return { copied: 0 };
  }

  const allowedExt = new Set([".json", ".jpg", ".jpeg", ".png", ".webp", ".avif"]);
  fs.mkdirSync(distTracksDir, { recursive: true });

  let copied = 0;
  const files = walkFiles(sourceTracksDir);
  for (const sourcePath of files) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (!allowedExt.has(ext)) {
      continue;
    }

    const targetPath = path.join(distTracksDir, path.basename(sourcePath));
    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  return { copied };
}

async function optimizeImages(files) {
  let optimizedCount = 0;
  let pngToJpegCount = 0;
  let pngToWebpCount = 0;
  let keptBySourceAllowlist = 0;
  let convertedLargerSkipped = 0;
  const renames = [];
  const keepPngStemSet = loadPngKeepStemSet();

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
      continue;
    }

    let input = fs.readFileSync(file);
    let output;

    if (ext === ".png") {
      const metadata = await sharp(input).metadata();
      const hasAlpha = !!metadata.hasAlpha || metadata.channels === 4;
      const sourceStem = getSourceStemFromDistAsset(file);
      const keepAsPng = keepPngStemSet.has(sourceStem);

      output = await sharp(input)
        .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
        .toBuffer();

      if (output.length < input.length) {
        fs.writeFileSync(file, output);
        input = output;
        optimizedCount += 1;
      }

      if (keepAsPng) {
        keptBySourceAllowlist += 1;
        continue;
      }

      if (hasAlpha) {
        const webpBuffer = await sharp(input)
          .webp({ quality: 84, alphaQuality: 90, effort: 5 })
          .toBuffer();

        const parsed = path.parse(file);
        const webpPath = path.join(parsed.dir, `${parsed.name}.webp`);
        fs.mkdirSync(parsed.dir, { recursive: true });
        fs.writeFileSync(webpPath, webpBuffer);
        fs.unlinkSync(file);
        renames.push([path.basename(file), path.basename(webpPath)]);
        pngToWebpCount += 1;
        continue;
      }

      const jpegBuffer = await sharp(input)
        .jpeg({ quality: 82, mozjpeg: true, progressive: true })
        .toBuffer();
      const webpBuffer = await sharp(input)
        .webp({ quality: 84, effort: 5 })
        .toBuffer();

      if (jpegBuffer.length <= webpBuffer.length) {
        const parsed = path.parse(file);
        const jpegPath = path.join(parsed.dir, `${parsed.name}.jpg`);
        fs.mkdirSync(parsed.dir, { recursive: true });
        fs.writeFileSync(jpegPath, jpegBuffer);
        fs.unlinkSync(file);
        renames.push([path.basename(file), path.basename(jpegPath)]);
        pngToJpegCount += 1;
      } else {
        const parsed = path.parse(file);
        const webpPath = path.join(parsed.dir, `${parsed.name}.webp`);
        fs.mkdirSync(parsed.dir, { recursive: true });
        fs.writeFileSync(webpPath, webpBuffer);
        fs.unlinkSync(file);
        renames.push([path.basename(file), path.basename(webpPath)]);
        pngToWebpCount += 1;
      }
    } else {
      output = await sharp(input)
        .jpeg({ quality: 82, mozjpeg: true, progressive: true })
        .toBuffer();

      if (output.length < input.length) {
        fs.writeFileSync(file, output);
        optimizedCount += 1;
      }
    }
  }

  return { optimizedCount, pngToJpegCount, pngToWebpCount, keptBySourceAllowlist, convertedLargerSkipped, renames };
}

function convertWavToOgg(files) {
  const renames = [];
  let convertedCount = 0;

  for (const file of files) {
    if (path.extname(file).toLowerCase() !== ".wav") {
      continue;
    }

    const parsed = path.parse(file);
    const oggPath = path.join(parsed.dir, `${parsed.name}.ogg`);

    try {
      execFileSync(
        ffmpegPath,
        ["-y", "-i", file, "-vn", "-c:a", "libvorbis", "-q:a", "4", oggPath],
        { stdio: "ignore" }
      );
    } catch (error) {
      console.warn(`[optimize-dist-assets] WAV->OGG failed for ${path.basename(file)}: ${error.message}`);
      continue;
    }

    const wavSize = fs.statSync(file).size;
    const oggSize = fs.statSync(oggPath).size;

    if (oggSize < wavSize) {
      fs.unlinkSync(file);
      renames.push([path.basename(file), path.basename(oggPath)]);
      convertedCount += 1;
    } else {
      fs.unlinkSync(oggPath);
    }
  }

  return { renames, convertedCount };
}

function rewriteBundleReferences(renames) {
  if (!renames.length) {
    return 0;
  }

  const files = walkFiles(distDir).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return ext === ".js" || ext === ".css" || ext === ".html";
  });

  let changedCount = 0;
  for (const file of files) {
    const changed = replaceInTextFile(file, renames);
    if (changed) {
      changedCount += 1;
    }
  }

  return changedCount;
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error("[optimize-dist-assets] dist directory does not exist. Run vite build first.");
    process.exit(1);
  }

  if (!fs.existsSync(distAssetsDir)) {
    console.log("[optimize-dist-assets] dist/assets directory not found. Nothing to optimize.");
    return;
  }

  const beforeFiles = walkFiles(distAssetsDir);
  const beforeBytes = getTotalBytes(beforeFiles);

  const imageStats = await optimizeImages(beforeFiles);
  const audioStats = convertWavToOgg(beforeFiles);
  const trackFiles = copyTrackStaticFiles();
  const rewrittenFiles = rewriteBundleReferences([...imageStats.renames, ...audioStats.renames]);

  const afterFiles = walkFiles(distAssetsDir);
  const afterBytes = getTotalBytes(afterFiles);
  const savedBytes = beforeBytes - afterBytes;

  console.log(`[optimize-dist-assets] image files optimized in-place: ${imageStats.optimizedCount}`);
  console.log(`[optimize-dist-assets] png files converted to jpg: ${imageStats.pngToJpegCount}`);
  console.log(`[optimize-dist-assets] png files converted to webp: ${imageStats.pngToWebpCount}`);
  console.log(`[optimize-dist-assets] png files kept by brands/decals allowlist: ${imageStats.keptBySourceAllowlist}`);
  console.log(`[optimize-dist-assets] png conversion skipped (output larger): ${imageStats.convertedLargerSkipped}`);
  console.log(`[optimize-dist-assets] wav files converted to ogg: ${audioStats.convertedCount}`);
  console.log(`[optimize-dist-assets] track files copied to dist/tracks: ${trackFiles.copied}`);
  console.log(`[optimize-dist-assets] bundle files rewritten: ${rewrittenFiles}`);
  console.log(
    `[optimize-dist-assets] size: ${formatMb(beforeBytes)} -> ${formatMb(afterBytes)} (${formatMb(savedBytes)} saved)`
  );
}

main().catch((error) => {
  console.error("[optimize-dist-assets] failed:", error);
  process.exit(1);
});
