import { EXAMPLE_TRACKS } from '../src/track.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Convert each example track to JSON
const tracks = ['simple', 'crossroads', 'rollercoaster', 'hills', 'mudPit', 'bankedTurn'];

for (const trackKey of tracks) {
  const track = EXAMPLE_TRACKS[trackKey]();
  const json = track.toJSON();
  const filePath = join(__dirname, '..', 'tracks', `${trackKey}.json`);
  writeFileSync(filePath, json, 'utf-8');
  console.log(`Created tracks/${trackKey}.json`);
}

console.log('All tracks exported successfully!');
