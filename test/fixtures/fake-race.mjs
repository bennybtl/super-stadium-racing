// Stand-in race process for test/race-supervisor.test.js. FAKE_MODE picks
// how it behaves: finish | crash | stall | silent.
const mode = process.env.FAKE_MODE;
const config = JSON.parse(process.env.LOBBY_CONFIG);
process.send({ type: 'ready' });
if (mode === 'finish') {
  process.send({ type: 'result', reason: 'finished', rows: [{ id: 'a' }], inputLog: [], seed: config.seed });
  setTimeout(() => process.exit(0), 50);
} else if (mode === 'crash') {
  setTimeout(() => process.exit(3), 50);
} else if (mode === 'stall') {
  // Heartbeats keep coming, but the tick never moves while "racing".
  setInterval(() => process.send({ type: 'heartbeat', tick: 7, phase: 'racing' }), 200);
} else if (mode === 'silent') {
  setInterval(() => {}, 1000); // alive, never heartbeats
}
