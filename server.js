// ОБЪЕКТ 12 — статический сервер сборки + WebSocket-релей комнат.
// Запуск: node server.js  (порт из PORT, по умолчанию 3000)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const rooms = new Map(); // room -> Set<client>

function roomOf(name) {
  if (!rooms.has(name)) rooms.set(name, new Set());
  return rooms.get(name);
}

function peersOf(room, except) {
  const out = [];
  for (const c of roomOf(room)) {
    if (c !== except && c.name) out.push({ id: c.id, name: c.name });
  }
  return out;
}

function broadcast(room, payload, except) {
  const data = JSON.stringify(payload);
  for (const c of roomOf(room)) {
    if (c === except) continue;
    if (c.ws.readyState === 1) {
      try { c.ws.send(data); } catch (e) { /* ignore */ }
    }
  }
}

function hostOf(room) {
  for (const c of roomOf(room)) return c.id;
  return null;
}

// ------------------------------------------------------------------ HTTP
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    const stats = { ok: true, rooms: rooms.size, clients: [...rooms.values()].reduce((a, s) => a + s.size, 0) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  let filePath = path.join(DIST, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Сборка не найдена</h1><p>Выполните <code>npm run build</code>, затем перезапустите сервер.</p>');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

// ------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const client = { ws, id: null, room: null, name: null, alive: true };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'pong') return;

    if (msg.t === 'ping') {
      try {
        ws.send(JSON.stringify({ t: 'pong', id: msg.id, room: msg.room, ts: msg.ts }));
      } catch (e) { /* ignore */ }
      return;
    }

    if (msg.t === 'hello' || msg.t === 'hi') {
      const roomName = String(msg.room || 'MAIN').toUpperCase().slice(0, 8);
      const clientId = String(msg.id || Math.random().toString(36).slice(2, 10)).slice(0, 24);
      const name = String(msg.name || 'ВЫЖИВШИЙ').slice(0, 16);

      if (client.room && client.room !== roomName) {
        // смена комнаты
        leaveRoom(client);
      }
      client.id = clientId;
      client.name = name;
      if (!client.room) {
        client.room = roomName;
        roomOf(roomName).add(client);
        const hostId = hostOf(roomName);
        try {
          ws.send(JSON.stringify({ t: 'welcome', id: clientId, room: roomName, hostId, peers: peersOf(roomName, client) }));
        } catch (e) { /* ignore */ }
        broadcast(roomName, { t: 'join', id: clientId, name }, client);
        broadcast(roomName, { t: 'peers', list: [...roomOf(roomName)].map((c) => ({ id: c.id, name: c.name })).filter((p) => p.id !== clientId) }, client);
      }
      return;
    }

    if (!client.room) return;

    // Проверка «своего» id: сообщение должно принадлежать отправителю.
    if (msg.id && msg.id !== client.id) return;

    if (msg.t === 'mon' && hostOf(client.room) !== client.id) return;

    if (['p', 'mon', 'ev', 'chat', 'noise'].includes(msg.t)) {
      broadcast(client.room, { ...msg, room: client.room }, client);
    }
  });

  ws.on('close', () => leaveRoom(client));
  ws.on('error', () => leaveRoom(client));

  function leaveRoom(c) {
    if (!c.room) return;
    const room = rooms.get(c.room);
    if (room) {
      const wasHost = hostOf(c.room) === c.id;
      room.delete(c);
      broadcast(c.room, { t: 'leave', id: c.id }, c);
      if (room.size === 0) rooms.delete(c.room);
      else if (wasHost) broadcast(c.room, { t: 'host', hostId: hostOf(c.room) }, c);
    }
    c.room = null;
  }
});

// Держим соединения живыми (ngrok/прокси рвут «тихие» сокеты)
const keepalive = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 25000);

wss.on('close', () => clearInterval(keepalive));

server.listen(PORT, HOST, () => {
  console.log(`ОБЪЕКТ 12 · сервер слушает http://${HOST}:${PORT} (ws: /ws)`);
});
