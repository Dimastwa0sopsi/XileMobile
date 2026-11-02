// Сетевой слой: WebSocket-релей, комнаты, хосты, синхронизация.
import { NET } from './config.js';
import { makeId } from './util.js';

export class Net {
  constructor({ room, name, preferred = 'auto' }) {
    this.room = room.toUpperCase();
    this.name = name;
    this.preferred = preferred;
    this.id = makeId();
    this.ws = null;
    this.mode = 'offline'; // smart | dumb | offline
    this.connected = false;
    this.hostId = null;
    this.peers = new Map();
    this.latency = 0;
    this.handlers = new Map();
    this.rttSent = 0;
    this.peerTimeout = 7;
    this.reconnectAttempts = 0;
    this.closedByUser = false;
    this.connecting = false;
    this.lastStatus = '';
  }

  on(evt, cb) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, []);
    this.handlers.get(evt).push(cb);
    return this;
  }

  emit(evt, payload) {
    const list = this.handlers.get(evt);
    if (!list) return;
    for (const cb of list) {
      try {
        cb(payload);
      } catch (e) {
        console.error('[net] handler error', evt, e);
      }
    }
  }

  get isHost() {
    return this.hostId === this.id;
  }

  get peerCount() {
    return this.peers.size;
  }

  get peerList() {
    return [...this.peers.values()];
  }

  _status(text, extra = {}) {
    this.lastStatus = text;
    this.emit('status', { text, mode: this.mode, connected: this.connected, latency: this.latency, ...extra });
  }

  _candidates() {
    const list = [];
    const local = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${NET.localPath}?room=${this.room}`;
    if (this.preferred !== 'local' && NET.remote) {
      list.push({ kind: 'remote', url: `${NET.remote}/?room=${this.room}` });
    }
    list.push({ kind: 'local', url: local });
    return list;
  }

  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    this.closedByUser = false;

    for (const candidate of this._candidates()) {
      this._status(`подключение · ${candidate.kind === 'remote' ? 'ngrok' : 'локальный'} узел`);
      const result = await this._tryConnect(candidate);
      if (result) {
        this.connecting = false;
        return true;
      }
    }

    this.connecting = false;
    this.mode = 'offline';
    this.connected = false;
    this.hostId = this.id;
    this._status('автономный режим', { solo: true });
    this.emit('ready', { mode: 'offline', isHost: true, solo: true });
    return false;
  }

  _tryConnect(candidate) {
    return new Promise((resolve) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(candidate.url);
      } catch (e) {
        resolve(false);
        return;
      }
      ws.binaryType = 'arraybuffer';

      const openTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (e) { /* ignore */ }
        resolve(false);
      }, 5000);

      const welcomeTimer = { id: 0 };

      ws.onopen = () => {
        clearTimeout(openTimer);
        this.ws = ws;
        this.connected = true;
        this.currentUrl = candidate.url;
        this._send({ t: 'hello', id: this.id, room: this.room, name: this.name });
        // Ждём приветствие умного сервера; если его нет — работаем как через «глупый» релей.
        welcomeTimer.id = setTimeout(() => {
          if (settled) return;
          if (this.mode === 'offline') {
            this.mode = 'dumb';
            this.peers.clear();
            this._electHost();
            this._status(candidate.kind === 'remote' ? 'релей ngrok' : 'локальный релей');
            this.emit('ready', { mode: this.mode, isHost: this.isHost });
          }
          settled = true;
          resolve(true);
        }, 1400);
      };

      ws.onmessage = (ev) => {
        clearTimeout(welcomeTimer.id);
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data));
        } catch (e) {
          return;
        }
        this._handleMessage(msg);
        if (!settled && msg.t === 'welcome') {
          settled = true;
          this.mode = 'smart';
          clearTimeout(openTimer);
          this._status(candidate.kind === 'remote' ? 'релей ngrok' : 'локальный релей');
          this.emit('ready', { mode: this.mode, isHost: this.isHost });
          resolve(true);
        }
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        clearTimeout(welcomeTimer.id);
        resolve(false);
      };

      ws.onclose = () => {
        clearTimeout(welcomeTimer.id);
        clearTimeout(openTimer);
        const wasConnected = this.ws === ws;
        if (wasConnected) {
          this.ws = null;
          this.connected = false;
          this.peers.clear();
          this.emit('peers', []);
          this.emit('disconnect');
          this._status('связь потеряна');
          if (!this.closedByUser) this._scheduleReconnect();
        }
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };
    });
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= 3) {
      this._status('автономный режим');
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => {
      if (this.closedByUser) return;
      if (!this.connected) this.connect();
    }, NET.reconnectDelay * this.reconnectAttempts);
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  _handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.room && msg.room !== this.room) return;
    if (msg.id && msg.id === this.id && msg.t !== 'welcome' && msg.t !== 'pong') return;

    switch (msg.t) {
      case 'welcome': {
        this.mode = 'smart';
        this.hostId = msg.hostId || this.id;
        if (Array.isArray(msg.peers)) {
          for (const p of msg.peers) {
            this._addPeer(p);
          }
        }
        this.emit('host', { hostId: this.hostId, isHost: this.isHost });
        break;
      }
      case 'peers': {
        if (Array.isArray(msg.list)) {
          const seen = new Set();
          for (const p of msg.list) {
            seen.add(p.id);
            this._addPeer(p);
          }
          for (const id of [...this.peers.keys()]) {
            if (!seen.has(id)) this._removePeer(id);
          }
        }
        break;
      }
      case 'host': {
        if (msg.hostId) {
          this.hostId = msg.hostId;
          this.emit('host', { hostId: this.hostId, isHost: this.isHost });
        }
        break;
      }
      case 'join': {
        this._addPeer({ id: msg.id, name: msg.name });
        break;
      }
      case 'leave': {
        this._removePeer(msg.id);
        if (this.hostId === msg.id) this._electHost();
        break;
      }
      case 'hello': {
        if (msg.id && msg.id !== this.id) {
          const known = this.peers.has(msg.id);
          this._addPeer({ id: msg.id, name: msg.name });
          if (!known) this._send({ t: 'hi', id: this.id, room: this.room, name: this.name });
          if (this.mode === 'dumb') this._electHost();
        }
        break;
      }
      case 'hi': {
        if (msg.id && msg.id !== this.id) {
          this._addPeer({ id: msg.id, name: msg.name });
          if (this.mode === 'dumb') this._electHost();
        }
        break;
      }
      case 'ping': {
        this._send({ t: 'pong', id: this.id, room: this.room, ts: msg.ts });
        break;
      }
      case 'pong': {
        if (msg.ts) this.latency = Math.max(1, Math.round(performance.now() - msg.ts));
        break;
      }
      case 'p': {
        this._addPeer({ id: msg.id, name: msg.name }, false);
        if (msg.id !== this.id) this.emit('state', msg);
        break;
      }
      case 'mon': {
        this.emit('monster', msg);
        break;
      }
      case 'ev': {
        this.emit('event', msg);
        break;
      }
      case 'chat': {
        this.emit('chat', msg);
        break;
      }
      default:
        break;
    }
  }

  _addPeer(info, announce = true) {
    if (!info || !info.id || info.id === this.id) return;
    const existing = this.peers.get(info.id);
    if (existing) {
      existing.lastSeen = performance.now();
      if (info.name) existing.name = info.name;
      return;
    }
    const peer = { id: info.id, name: info.name || 'Выживший', lastSeen: performance.now() };
    this.peers.set(info.id, peer);
    if (this.mode === 'dumb') this._electHost();
    this.emit('join', peer);
    this.emit('peers', this.peerList);
    if (announce && this.mode === 'smart') { /* сервер сам разошлёт join */ }
  }

  _removePeer(id) {
    if (!this.peers.has(id)) return;
    this.peers.delete(id);
    this.emit('leave', id);
    this.emit('peers', this.peerList);
  }

  _electHost() {
    const ids = [this.id, ...this.peers.keys()].sort();
    const hostId = ids[0];
    if (hostId !== this.hostId) {
      this.hostId = hostId;
      this.emit('host', { hostId, isHost: this.isHost });
    }
  }

  sendState(payload) {
    this._send({ t: 'p', id: this.id, room: this.room, name: this.name, ...payload });
  }

  sendMonster(payload) {
    if (!this.isHost) return;
    this._send({ t: 'mon', id: this.id, room: this.room, ...payload });
  }

  sendEvent(payload) {
    this._send({ t: 'ev', id: this.id, room: this.room, name: this.name, ...payload });
  }

  sendChat(text) {
    this._send({ t: 'chat', id: this.id, room: this.room, name: this.name, text });
  }

  ping() {
    this._send({ t: 'ping', id: this.id, room: this.room, ts: performance.now() });
    this._send({ t: 'hello', id: this.id, room: this.room, name: this.name });
  }

  update(dt) {
    this.pingTimer = (this.pingTimer || 0) + dt;
    if (this.pingTimer > NET.pingInterval / 1000 && this.connected) {
      this.pingTimer = 0;
      this.ping();
    }
    const now = performance.now();
    let changed = false;
    for (const [id, peer] of [...this.peers.entries()]) {
      if (now - peer.lastSeen > this.peerTimeout * 1000) {
        this.peers.delete(id);
        changed = true;
        this.emit('leave', id);
        if (this.hostId === id) this._electHost();
      }
    }
    if (changed) this.emit('peers', this.peerList);
  }

  close() {
    this.closedByUser = true;
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
    }
    this.ws = null;
    this.connected = false;
  }
}
