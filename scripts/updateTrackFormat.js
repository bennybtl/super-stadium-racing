// Script to update track files from full terrainType objects to just name strings
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tracksDir = path.join(__dirname, '..', 'tracks');
const trackFiles = fs.readdirSync(tracksDir).filter(f => f.endsWith('.json'));

console.log(`Found ${trackFiles.length} track files to update`);

trackFiles.forEach(filename => {
  const filePath = path.join(tracksDir, filename);
  console.log(`\nProcessing ${filename}...`);
  
  const content = fs.readFileSync(filePath, 'utf8');
  const track = JSON.parse(content);
  
  let updated = false;
  track.features.forEach((feature, index) => {
    if (feature.terrainType && typeof feature.terrainType === 'object' && feature.terrainType.name) {
      console.log(`  Feature ${index} (${feature.type}): ${JSON.stringify(feature.terrainType.name)}`);
      feature.terrainType = feature.terrainType.name;
      updated = true;
    }
  });
  
  if (updated) {
    const newContent = JSON.stringify(track, null, 2);
    fs.writeFileSync(filePath, newContent);
    console.log(`  ✓ Updated ${filename}`);
  } else {
    console.log(`  - No changes needed for ${filename}`);
  }
});

console.log('\n✓ All track files processed');
