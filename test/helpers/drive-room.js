import { DriveRoom } from '../../server/DriveRoom.js';

/**
 * DriveRoom driven directly, no network: its message handlers are captured and
 * the Colyseus transport (broadcast / metadata / lock) is stubbed.
 *
 *   const { room, sent, client, msg } = makeRoom({ laps: 2 });
 *   const a = client('a'); room.onJoin(a, { playerName: 'A' });
 *   msg(a, 'start');
 *   sent.filter(m => m.type === 'raceOver')
 */
export function makeRoom(options = {}) {
  const room = new DriveRoom();
  const handlers = {};
  const sent = [];
  room.onMessage = (type, fn) => { handlers[type] = fn; };
  room.broadcast = (type, payload) => sent.push({ type, payload });
  // Colyseus exposes metadata as a getter; shadow it with a plain field.
  Object.defineProperty(room, 'metadata', { value: undefined, writable: true });
  room.setMetadata = (m) => { room.metadata = m; };
  room.lock = () => {};
  room.onCreate(options);
  const client = (id) => ({ sessionId: id, send: () => {} });
  const msg = (c, type, data) => handlers[type](c, data);
  return { room, sent, client, msg };
}
