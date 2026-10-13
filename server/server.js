// Scrap Club arena server: serves the built game and relays multiplayer rooms.
// The host's browser simulates the match; this server only routes messages.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MAX_PLAYERS = 4;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '');
    let file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error('bad path');
    const st = await stat(file).catch(() => null);
    if (!st || st.isDirectory()) file = join(ROOT, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found — run `npm run build` first.');
  }
});

/** @type {Map<string, {code: string, host: any, peers: any[], started: boolean, settings: any}>} */
const rooms = new Map();

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(c));
  return c;
}

const send = (ws, msg) => ws.readyState === 1 && ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));

function lobby(room) {
  const players = [room.host, ...room.peers].map((ws) => ({ slot: ws.slot, name: ws.name, loadout: ws.loadout, ready: !!ws.ready, host: ws === room.host }));
  const msg = JSON.stringify({ t: 'lobby', code: room.code, players, settings: room.settings, started: room.started });
  for (const ws of [room.host, ...room.peers]) send(ws, msg);
}

function freeSlot(room) {
  const used = new Set([room.host, ...room.peers].map((p) => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  if (room.host === ws) {
    for (const p of room.peers) {
      send(p, { t: 'closed', reason: 'The host closed the arena.' });
      p.room = null;
    }
    rooms.delete(room.code);
    return;
  }
  room.peers = room.peers.filter((p) => p !== ws);
  send(room.host, { t: 'peer-left', slot: ws.slot });
  lobby(room);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const room = ws.room;
    switch (msg.t) {
      case 'create': {
        leave(ws);
        const code = makeCode();
        const r = { code, host: ws, peers: [], started: false, settings: msg.settings ?? {} };
        rooms.set(code, r);
        ws.room = r;
        ws.slot = 0;
        ws.name = String(msg.name ?? 'Host').slice(0, 24);
        ws.loadout = msg.loadout;
        ws.ready = true;
        send(ws, { t: 'joined', code, slot: 0, host: true });
        lobby(r);
        break;
      }
      case 'join': {
        const r = rooms.get(String(msg.code ?? '').toUpperCase());
        if (!r) return send(ws, { t: 'error', reason: 'No arena with that code.' });
        if (r.started) return send(ws, { t: 'error', reason: 'That match already started.' });
        const slot = freeSlot(r);
        if (slot < 0) return send(ws, { t: 'error', reason: 'Arena is full (4 gladiators).' });
        leave(ws);
        ws.room = r;
        ws.slot = slot;
        ws.name = String(msg.name ?? 'Gladiator').slice(0, 24);
        ws.loadout = msg.loadout;
        ws.ready = false;
        r.peers.push(ws);
        send(ws, { t: 'joined', code: r.code, slot, host: false });
        lobby(r);
        break;
      }
      case 'ready':
        if (room) {
          ws.ready = !!msg.on;
          lobby(room);
        }
        break;
      case 'loadout':
        if (room) {
          ws.loadout = msg.loadout;
          ws.name = String(msg.loadout?.name ?? ws.name).slice(0, 24);
          lobby(room);
        }
        break;
      case 'settings':
        if (room && room.host === ws) {
          room.settings = msg.settings;
          lobby(room);
        }
        break;
      case 'start':
        if (room && room.host === ws) {
          room.started = true;
          for (const p of [room.host, ...room.peers]) send(p, { t: 'start', cfg: msg.cfg, slot: p.slot });
        }
        break;
      case 'end':
        if (room && room.host === ws) {
          room.started = false;
          for (const p of room.peers) {
            p.ready = false;
            send(p, { t: 'ended' });
          }
          lobby(room);
        }
        break;
      case 'snap':
      case 'pause':
        // host -> everyone else
        if (room && room.host === ws) {
          const s = JSON.stringify(msg);
          for (const p of room.peers) send(p, s);
        }
        break;
      case 'input':
        // client -> host
        if (room && room.host !== ws) send(room.host, { t: 'input', slot: ws.slot, c: msg.c | 0 });
        break;
      case 'chat':
        if (room) for (const p of [room.host, ...room.peers]) send(p, { t: 'chat', from: ws.name, text: String(msg.text ?? '').slice(0, 120) });
        break;
      case 'leave':
        leave(ws);
        break;
    }
  });
  ws.on('close', () => leave(ws));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Scrap Club arena server on http://localhost:${PORT}`));
