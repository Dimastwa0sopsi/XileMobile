import * as THREE from 'three';
import './style.css';
import { NET, MAZE, PLAYER, MONSTER, OBJECTIVE, COLORS } from './config.js';
import { generateLevel, cellToWorld, worldToCell } from './maze.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Monster } from './monster.js';
import { Net } from './net.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { RemotePlayers } from './remotePlayers.js';
import { clamp, damp, formatTime, makeRoomCode, hashString, randInt } from './util.js';

const CALLSIGNS = ['ВОРОН', 'СОКОЛ', 'ТИХОН', 'ШТИЛЬ', 'ГРОТ', 'ПЕПЕЛ', 'КЛИН', 'МОХ', 'ЗАРЯ', 'ЛЕД'];

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.hud = new HUD(this);
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.remotePlayers = null;
    this.world = null;
    this.player = null;
    this.monster = null;
    this.net = null;
    this.running = false;
    this.paused = true;
    this.deadView = false;
    this.startedAt = 0;
    this.carried = 0;
    this.installed = 0;
    this.notes = 0;
    this.powered = false;
    this.exitOpen = false;
    this.notesSet = new Set();
    this.netMonsterState = null;
    this.interact = null;
    this.revive = { id: null, t: 0 };
    this.lastPromptKey = null;
    this.stateAccum = 0;
    this.monsterAccum = 0;
    this.objectiveAccum = 0;
    this.hudAccum = 0;
    this.elapsed = 0;
    this.fear = 0;
    this.shake = 0;
    this.mobileCrouch = false;
    this.monsterSeenFor = 0;
    this.winShown = false;

    this._initIntro();
  }

  // -------------------------------------------------------------- старт/меню
  _initIntro() {
    const params = new URLSearchParams(location.search);
    const savedName = localStorage.getItem('obj12.name');
    this.room = (params.get('room') || makeRoomCode()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || makeRoomCode();
    this.name = (params.get('name') || savedName || `${CALLSIGNS[randInt(0, CALLSIGNS.length - 1)]}-${randInt(1, 9)}`).toUpperCase().slice(0, 14);

    const nameInput = document.getElementById('input-name');
    const roomInput = document.getElementById('input-room');
    nameInput.value = this.name;
    roomInput.value = this.room;
    this.updateJoinLink();

    document.getElementById('btn-start').disabled = false;
    this.hud.setIntroStatus(`готов к спуску · узел ${NET.remote.replace('wss://', '')}`, 'ok');

    const start = () => this.start();
    document.getElementById('btn-start').addEventListener('click', start);
    document.getElementById('btn-copy').addEventListener('click', () => this.copyLink());
    document.getElementById('btn-copy2').addEventListener('click', () => this.copyLink());
    document.getElementById('btn-resume').addEventListener('click', () => this.resume());
    document.getElementById('btn-quit').addEventListener('click', () => location.reload());
    document.getElementById('btn-restart').addEventListener('click', () => this.restart());
    document.getElementById('btn-again').addEventListener('click', () => this.restart());
    document.getElementById('btn-again2').addEventListener('click', () => this.restart());
    document.getElementById('btn-menu').addEventListener('click', () => location.reload());
    document.getElementById('btn-spectate').addEventListener('click', () => {
      this.hud.showScreen(null);
      this.deadView = true;
      this.hud.setBanners({ hidden: false, downed: false, dead: true });
    });

    nameInput.addEventListener('change', () => {
      this.name = (nameInput.value || 'ВЫЖИВШИЙ').toUpperCase().slice(0, 14);
      nameInput.value = this.name;
      localStorage.setItem('obj12.name', this.name);
    });
    roomInput.addEventListener('change', () => {
      this.room = (roomInput.value || makeRoomCode()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      roomInput.value = this.room;
      this.updateJoinLink();
    });
    document.getElementById('map-screen').addEventListener('click', () => this.toggleMap());
    document.getElementById('input-server').addEventListener('change', (e) => {
      localStorage.setItem('obj12.server', e.target.value);
    });
    const savedServer = localStorage.getItem('obj12.server');
    if (savedServer) document.getElementById('input-server').value = savedServer;
    const savedBright = localStorage.getItem('obj12.bright');
    if (savedBright) document.getElementById('input-bright').value = savedBright;

    this.input.emitLockError = () => {
      this.hud.toast('Захват мыши недоступен: зажмите левую кнопку и ведите мышью', 5000);
    };

    // Чат
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = chatInput.value.trim();
        if (text) {
          this.sendChat(text);
          this.hud.chat(this.name, text);
        }
        this.hud.closeChat();
        this._unlockInputFocus();
        if (!this.input.isTouch) this.input.requestLock();
      } else if (e.code === 'Escape') {
        this.hud.closeChat();
        this._unlockInputFocus();
      }
    });

    // Кнопки на телефоне
    for (const btn of document.querySelectorAll('.tbtn')) {
      const action = btn.dataset.action;
      if (action === 'crouch') {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.mobileCrouch = !this.mobileCrouch;
          btn.classList.toggle('active', this.mobileCrouch);
        });
      } else if (action === 'pause') {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.togglePause();
        });
      } else if (action === 'map') {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.toggleMap();
        });
      } else if (action === 'chat') {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (this.hud.chatOpen) {
            this.hud.closeChat();
            this._unlockInputFocus();
          } else {
            this.hud.openChat();
            this.input.exitLock();
          }
        });
      } else {
        this.input.bindButton(btn, action);
      }
    }

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('pointerlockchange', () => {
      if (this.running && !this.input.isTouch && !document.pointerLockElement && !this.paused
        && !this.hud.chatOpen && !this.hud.mapOpen) {
        this.togglePause(true);
      }
    });
    window.addEventListener('beforeunload', () => this.net?.close());
  }

  _unlockInputFocus() {
    document.activeElement?.blur?.();
    this.hud.closeChat();
  }

  updateJoinLink() {
    const url = `${location.origin}${location.pathname}?room=${this.room}`;
    const el = document.getElementById('join-link');
    if (el) el.textContent = url;
  }

  async copyLink() {
    const url = `${location.origin}${location.pathname}?room=${this.room}`;
    try {
      await navigator.clipboard.writeText(url);
      this.hud.toast('Ссылка скопирована. Отправьте её напарникам.');
    } catch (e) {
      this.hud.toast(url, 6000);
    }
  }

  // ------------------------------------------------------------------ запуск
  start() {
    if (this.running) return;
    this.audio.resume();
    this.audio.startAmbience();

    const nameInput = document.getElementById('input-name');
    const roomInput = document.getElementById('input-room');
    this.name = (nameInput.value || this.name).toUpperCase().slice(0, 14);
    this.room = (roomInput.value || this.room).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || makeRoomCode();
    localStorage.setItem('obj12.name', this.name);

    this.quality = document.getElementById('input-quality').value;
    this.brightness = document.getElementById('input-bright').value || 'normal';
    localStorage.setItem('obj12.bright', this.brightness);
    this.preferredServer = document.getElementById('input-server').value;

    history.replaceState(null, '', `?room=${this.room}`);
    this.hud.setRoom(this.room);
    this.updateJoinLink();

    this.buildRenderer();
    this.buildWorld();
    this.buildNet();

    this.hud.showScreen(null);
    this.hud.showHUD(true);
    this.hud.chat('СИСТЕМА', 'Добро пожаловать на нулевой этаж. Нужно 5 предохранителей.', true);
    this.hud.chat('СИСТЕМА', `Генератор ${this.compassTo(this.world.generator.pos)}. Комната ${this.room}.`, true);
    this.hud.chat('СИСТЕМА', 'Ссылка на комнату — кнопка «скопировать» в паузе.', true);
    this.hud.toast('Смотритель просыпается через 28 секунд. Не стойте на месте.');

    this.running = true;
    this.paused = false;
    this.startedAt = performance.now();
    this.input.clearPressed();
    this.input.requestLock();
    this.input.enabled = true;

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  compassTo(target) {
    const dx = target.x - this.player.pos.x;
    const dz = target.z - this.player.pos.z;
    const ns = dz < -12 ? 'севернее' : dz > 12 ? 'южнее' : '';
    const ew = dx > 12 ? 'восточнее' : dx < -12 ? 'западнее' : '';
    const dist = Math.round(Math.hypot(dx, dz));
    if (!ns && !ew) return `рядом (${dist} м)`;
    return `${[ns, ew].filter(Boolean).join(' и ')} вас, ~${dist} м`;
  }

  restart() {
    const url = new URL(location.href);
    url.searchParams.set('room', this.room);
    if (Math.random() < 0.65) url.searchParams.set('room', makeRoomCode());
    location.href = url.toString();
  }

  buildRenderer() {
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: q !== 'low',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const exposure = { dark: 1.05, normal: 1.3, bright: 1.8 }[this.brightness] ?? 1.3;
    this.renderer.toneMappingExposure = exposure * (q === 'low' ? 1.15 : 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 150);
    this.camera.rotation.order = 'YXZ';
  }

  buildWorld() {
    this.seedString = this.room || 'OBJECT12';
    this.level = generateLevel(this.seedString);
    this.grid = this.level.grid;
    this.size = this.level.size;
    this.cell = MAZE.cell;
    this.world = new World(this.scene, this.level);
    this.world.setPowered(false);
    this.world.setFusesInstalled(0);

    const start = this.level.start;
    const p = cellToWorld(start.x, start.z);
    const neighbour = this.grid.neighbors(start.x, start.z)[0] || [start.x + 1, start.z];
    const dx = neighbour[0] - start.x;
    const dz = neighbour[1] - start.z;
    const yaw = Math.atan2(-dx, -dz);

    this.player = new Player(this.camera, this.grid, {
      x: p.x,
      z: p.z,
      yaw,
    }, { fov: 74, nickname: this.name });

    this.remotePlayers = new RemotePlayers(this.scene);

    // Монстр появляется далеко от старта
    const dist = this.grid.distanceField(start.x, start.z);
    let best = null;
    let bestD = -1;
    for (let z = 1; z < this.size - 1; z++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (this.grid.isSolid(x, z)) continue;
        if (x === this.level.exit.x && z === this.level.exit.z) continue;
        const d = dist[z * this.size + x];
        if (d > bestD) {
          bestD = d;
          best = { x, z };
        }
      }
    }
    this.monster = new Monster(this.scene, this.grid, this.level, hashString(this.seedString));
    this.monster.spawnAt(best || { x: this.size - 3, z: this.size - 3 });
    this.monster.group.visible = false;
    this.monsterLight = this.world.monsterLight;

    this.carried = 0;
    this.installed = 0;
    this.notes = 0;
    this.powered = false;
    this.exitOpen = false;
    this.notesSet.clear();
    this.hud.visited.clear();
  }

  buildNet() {
    this.net = new Net({ room: this.room, name: this.name, preferred: this.preferredServer || 'auto' });
    this.net.on('status', (s) => {
      this.hud.setNet(s.text, s.latency, this.net.peerCount + 1);
      this.hud.el.netStatus.classList.toggle('bad', s.mode === 'offline');
      if (!this.running) this.hud.setIntroStatus(s.text);
    });
    this.net.on('ready', ({ mode, isHost }) => {
      this.isHost = isHost;
      this.hud.chat('СИСТЕМА', mode === 'offline'
        ? 'Связи нет — вы спускаетесь один. Смотритель уже знает о вас.'
        : `Связь установлена (${mode === 'dumb' ? 'релей' : 'узел'}). Ждём напарников…`, true);
      this.hud.toast(mode === 'offline' ? 'Автономный режим: сеть недоступна' : 'Соединение установлено');
      if (isHost) this.broadcastObjective(true);
      this.refreshPeers();
    });
    this.net.on('host', ({ isHost }) => {
      this.isHost = isHost;
      if (isHost) {
        this.hud.chat('СИСТЕМА', 'Вы стали хостом. Смотритель под вашим контролем.', true);
        this.broadcastObjective(true);
      }
    });
    this.net.on('join', (peer) => {
      this.hud.chat('СИСТЕМА', `${peer.name} присоединился`, true);
      this.remotePlayers.ensure(peer.id, peer.name);
      this.refreshPeers();
    });
    this.net.on('leave', (id) => {
      const av = this.remotePlayers.get(id);
      if (av) this.hud.chat('СИСТЕМА', `${av.name} потерян`, true);
      this.remotePlayers.remove(id);
      this.refreshPeers();
    });
    this.net.on('peers', () => this.refreshPeers());
    this.net.on('state', (msg) => {
      this.remotePlayers.applyState(msg.id, msg.name, msg);
    });
    this.net.on('monster', (msg) => {
      if (msg.m) this.netMonsterState = msg.m;
    });
    this.net.on('event', (msg) => this.handleNetEvent(msg));
    this.net.on('chat', (msg) => {
      this.hud.chat(msg.name || 'ВЫЖИВШИЙ', msg.text || '');
    });
    this.net.on('disconnect', () => {
      this.hud.toast('Связь с релеем потеряна. Игра продолжается оффлайн.');
    });
    this.net.connect();
  }

  refreshPeers() {
    if (!this.net || !this.hud) return;
    const list = [{
      id: this.net.id,
      name: `${this.name} (вы)`,
      health: this.player ? this.player.health : 100,
      downed: this.player?.downed,
      dead: this.player?.dead || this.player?.escaped,
    }];
    for (const av of this.remotePlayers?.list() || []) {
      list.push({ id: av.id, name: av.name, health: av.health, downed: av.downed, dead: av.dead });
    }
    this.hud.setPeers(list, this.net.id);
    this.hud.setNet(this.net.lastStatus || 'сеть', this.net.latency, this.net.peerCount + 1);
  }

  // ------------------------------------------------------------------ цикл
  loop(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.running && !this.paused) {
      this.update(dt);
    } else if (this.running) {
      this.player?._applyCamera(dt, 0);
      this.world?.update(dt, this.camera, this.player.headPos, this.elapsed);
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    const input = this.input;
    const player = this.player;
    this.elapsed += dt;

    const allowInput = !this.hud.chatOpen && !this.hud.mapOpen;
    input.enabled = allowInput;
    if (this.mobileCrouch) input.touchButtons.set('crouch', true);
    else input.touchButtons.delete('crouch');

    // ---- действия
    if (allowInput) {
      if (input.pressedOnce('torch')) {
        if (player.toggleTorch()) this.audio.click();
        else if (player.battery <= 0.5) this.hud.toast('Фонарь разряжен. Найдите батарейку.');
      }
      if (input.pressedOnce('map')) this.toggleMap();
      if (input.pressedOnce('chat')) {
        this.hud.openChat();
        this.input.exitLock();
        input.clearPressed();
      }
      if (input.pressedOnce('pause')) {
        if (this.hud.mapOpen) this.toggleMap();
        else this.togglePause();
      }
      if (input.pressedOnce('interact')) this.primaryInteract();
    }

    const events = player.update(dt, input, allowInput);
    for (const step of events.steps) {
      this.audio.step(step.kind);
      if (this.net && this.net.isHost) this.monster.hearNoise(player.pos.x, player.pos.z, step.noise);
      if (this.net && this.net.connected) this.net.sendEvent({ k: 'noise', x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1), r: step.noise });
    }
    if (events.done === 'dead') this.onLocalDeath();

    // ---- сеть и удалённые игроки
    this.net?.update(dt);
    this.remotePlayers?.update(dt);

    // ---- монстр
    const monster = this.monster;
    if (this.net && this.net.isHost) {
      const list = [{
        id: this.net.id,
        pos: player.pos,
        torchOn: player.torchOn,
        battery: player.battery,
        dead: player.dead || player.escaped,
        hidden: player.hidden,
        downed: player.downed,
      }];
      for (const av of this.remotePlayers.list()) {
        list.push({
          id: av.id,
          pos: av.pos,
          torchOn: av.torchOn,
          battery: 100,
          dead: av.dead,
          hidden: av.hidden,
          downed: av.downed,
        });
      }
      monster.update(dt, list, this.elapsed, (evt) => this.onMonsterEvent(evt));
      this.monsterAccum += dt;
      if (this.monsterAccum > 1 / NET.monsterRate && this.net.connected) {
        this.monsterAccum = 0;
        this.net.sendMonster({ m: monster.netState });
      }
      this.objectiveAccum += dt;
      if (this.objectiveAccum > 2 && this.net.connected) {
        this.objectiveAccum = 0;
        this.broadcastObjective(true);
      }
    } else if (this.netMonsterState) {
      monster.applyNetState(this.netMonsterState, dt);
    } else {
      monster.group.visible = false;
    }

    // Свет монстра рядом с игроком
    if (this.world?.monsterLight) {
      const dl = monster.pos.distanceTo(player.pos);
      this.world.monsterLight.position.set(monster.pos.x, 1.6, monster.pos.z);
      this.world.monsterLight.intensity = dl < 16 ? (1 - dl / 16) * 5 : 0;
    }

    // ---- мир
    this.world.update(dt, this.camera, player.headPos, this.elapsed);
    this.world.flashlight.intensity = player.torchOn ? 55 * (0.75 + 0.25 * Math.min(1, player.battery / 25)) : 0;
    this.world.flashlightFill.intensity = player.torchOn ? 1.6 : 0;

    // ---- взаимодействие
    this.updateInteraction(dt);

    // ---- состояние и отправка позиции
    this.stateAccum += dt;
    if (this.net && this.stateAccum > 1 / NET.stateRate) {
      this.stateAccum = 0;
      if (this.net.connected) {
        this.net.sendState({
          p: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)],
          y: +player.yaw.toFixed(2),
          f: player.torchOn,
          c: player.crouched,
          h: player.hidden,
          hp: Math.round(player.health),
          dn: player.downed,
          dd: player.dead || player.escaped,
        });
      }
    }

    // ---- страх, звук, HUD
    const distToMonster = monster.pos.distanceTo(player.pos);
    const chasing = monster.state === 'chase';
    let fear = clamp(1 - distToMonster / 30, 0, 1);
    if (chasing) fear = Math.min(1, fear + 0.35);
    if (player.downed) fear = 1;
    if (monster.group.visible) {
      this.audio.setMonsterProximity(distToMonster, true);
    } else {
      this.audio.setMonsterProximity(Infinity, false);
    }
    this.fear = damp(this.fear, fear, 3, dt);
    this.audio.update(dt, this.fear);
    this.hud.setFear(this.fear * 0.5);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.2;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.2;
    }

    // Пробуждение Смотрителя
    if (!this.graceAnnounced && this.elapsed > MONSTER.grace) {
      this.graceAnnounced = true;
      this.hud.chat('СИСТЕМА', 'Датчики движения: по нулевому этажу кто-то идёт.', true);
      this.hud.toast('Смотритель проснулся. Он слышит шаги.', 5000);
      this.audio.sting();
    }

    this.hud.setBars(player);
    this.hudAccum += dt;
    if (this.hudAccum > 0.15) {
      this.hudAccum = 0;
      this.hud.setObjective({
        fusesInstalled: this.installed,
        fusesCarried: this.carried,
        powered: this.powered,
        escaped: player.escaped,
        notes: this.notes,
        elapsed: this.elapsed,
      });
      this.refreshPeers();
    }

    if (this.hud.mapOpen) {
      this.hud.reveal(player.pos, 5);
      this.hud.drawMap();
    } else {
      this.hud.reveal(player.pos, 4.4);
    }

    this.hud.setBanners({
      hidden: player.hidden,
      downed: player.downed && !player.dead,
      dead: this.deadView,
    });

    // Автосохранение состояния «мертвеца»
    if (player.dead && !this.deadView && this.hud.el.screenDead.classList.contains('hidden')) {
      this.onLocalDeath();
    }

    // Все мертвы — объект снова закрыт
    if (!this.loseShown && player.dead && !this.winShown) {
      const remotesDead = this.remotePlayers.list().every((av) => av.dead);
      if (remotesDead) {
        this.loseShown = true;
        setTimeout(() => {
          if (!this.winShown) {
            this.hud.showScreen('lose');
            this.input.exitLock();
          }
        }, 4000);
      }
    }
  }

  // ------------------------------------------------------------ взаимодействие
  updateInteraction(dt) {
    const player = this.player;
    const world = this.world;
    const input = this.input;
    this.interact = null;

    if (player.dead || player.escaped) {
      this.hud.setPrompt(null);
      this.hud.setProgress(null);
      return;
    }
    if (player.downed) {
      this.hud.setPrompt(null);
      this.hud.setProgress(null);
      return;
    }

    if (player.hidden) {
      this.hud.setPrompt('выйти из шкафа', 'E');
      this.interact = { type: 'locker-exit' };
      this.hud.setProgress(null);
      return;
    }

    // Спасти напарника
    const downed = this.remotePlayers?.nearestDowned(player.pos, 2.8);
    if (downed) {
      this.hud.setPrompt(`поднять ${downed.name}`, 'E');
      this.interact = { type: 'revive', target: downed };
      const holding = input.keys.has('KeyE') || input.touchButtons.get('interact');
      if (holding) {
        if (this.revive.id !== downed.id) this.revive = { id: downed.id, t: 0 };
        this.revive.t += dt;
        this.hud.setProgress(this.revive.t / PLAYER.reviveTime, `стабилизация ${Math.round((this.revive.t / PLAYER.reviveTime) * 100)}%`);
        if (this.revive.t >= PLAYER.reviveTime) {
          this.revive = { id: null, t: 0 };
          this.net?.sendEvent({ k: 'revive', target: downed.id });
          if (this.net?.connected && !this.net.isHost) {
            /* цель применит у себя */
          }
          this.hud.chat('СИСТЕМА', `${downed.name} поднят`, true);
          this.hud.setProgress(null);
        }
      } else {
        this.revive = { id: null, t: 0 };
        this.hud.setProgress(null);
      }
      return;
    }
    this.revive = { id: null, t: 0 };
    this.hud.setProgress(null);

    // Предмет
    const item = world.nearestItem(player.pos, PLAYER.interactRange);
    if (item) {
      const label = item.type === 'fuse' ? 'взять предохранитель'
        : item.type === 'note' ? 'прочитать записку'
          : item.type === 'battery' ? 'взять батарейку'
            : 'взять аптечку';
      this.hud.setPrompt(label, 'E');
      this.interact = { type: 'item', item };
      return;
    }

    // Генератор
    const genDist = Math.hypot(world.generator.pos.x - player.pos.x, world.generator.pos.z - player.pos.z);
    if (genDist < 3.6) {
      if (this.installed >= OBJECTIVE.fusesNeeded) {
        if (!this.powered) {
          this.hud.setPrompt('запустить генератор', 'E');
          this.interact = { type: 'power' };
        } else {
          this.hud.setPrompt('генератор работает', '');
          this.interact = null;
        }
      } else if (this.carried > 0) {
        this.hud.setPrompt(`установить предохранитель (${this.installed}/${OBJECTIVE.fusesNeeded})`, 'E');
        this.interact = { type: 'install' };
      } else {
        this.hud.setPrompt('нет предохранителей — ищите в лабиринте', '');
      }
      return;
    }

    // Шлюз
    const exitDist = Math.hypot(world.exit.pos.x - player.pos.x, world.exit.pos.z - player.pos.z);
    if (exitDist < 4.2) {
      if (this.powered) {
        this.hud.setPrompt('покинуть объект', 'E');
        this.interact = { type: 'escape' };
      } else {
        this.hud.setPrompt('шлюз обесточен', '');
      }
      return;
    }

    // Шкаф
    const locker = world.nearestLocker(player.pos, 2.2);
    if (locker) {
      this.hud.setPrompt('спрятаться в шкаф', 'E');
      this.interact = { type: 'locker-enter', locker };
      return;
    }

    this.hud.setPrompt(null);
  }

  primaryInteract() {
    const it = this.interact;
    if (!it) return;
    const player = this.player;
    switch (it.type) {
      case 'item': {
        const item = it.item;
        this.world.takeItem(item.id);
        this.net?.sendEvent({ k: 'pickup', i: item.id, ty: item.type, who: this.net.id });
        this.audio.pickup(item.type);
        if (item.type === 'fuse') {
          this.carried++;
          this.hud.chat('СИСТЕМА', `Предохранитель найден (${this.carried} при себе)`, true);
        } else if (item.type === 'note') {
          if (!this.notesSet.has(item.id)) {
            this.notesSet.add(item.id);
            this.notes++;
          }
          this.showNote(item.index);
        } else if (item.type === 'battery') {
          player.battery = Math.min(PLAYER.batteryMax, player.battery + 45);
          this.hud.toast('Батарейка: +45% заряда фонаря');
        } else if (item.type === 'medkit') {
          if (!player.heal(40)) {
            player.health = Math.min(PLAYER.healthMax, player.health + 40);
          }
          this.hud.toast('Аптечка: +40 здоровья');
        }
        break;
      }
      case 'install': {
        if (this.carried <= 0) return;
        this.carried--;
        this.installed = Math.min(OBJECTIVE.fusesNeeded, this.installed + 1);
        this.world.setFusesInstalled(this.installed);
        this.audio.pickup('fuse');
        this.net?.sendEvent({ k: 'install' });
        this.hud.chat('СИСТЕМА', `Предохранитель установлен: ${this.installed}/${OBJECTIVE.fusesNeeded}`, true);
        if (this.installed >= OBJECTIVE.fusesNeeded) {
          this.hud.toast('Все предохранители на месте. Запустите генератор.');
          if (this.net?.isHost) this.broadcastObjective(true);
        }
        break;
      }
      case 'power': {
        if (this.installed < OBJECTIVE.fusesNeeded || this.powered) return;
        this.setPowered(true);
        if (this.net?.isHost) this.broadcastObjective(true);
        break;
      }
      case 'escape': {
        this.escapeLocal();
        break;
      }
      case 'locker-enter': {
        const locker = it.locker;
        player.hidden = true;
        player.hideLocker = locker;
        locker.occupied = true;
        // Встаём вплотную к шкафу и смотрим наружу
        player.pos.set(locker.front.x, 0, locker.front.z);
        player.yaw = locker.yaw;
        player.pitch = 0;
        player.vel.set(0, 0);
        this.hud.chat('СИСТЕМА', 'Вы в шкафу. Двигайтесь тихо — Смотритель слышит дыхание.', true);
        this.audio.click();
        break;
      }
      case 'locker-exit': {
        const locker = player.hideLocker;
        if (locker) {
          locker.occupied = false;
          player.pos.set(locker.front.x, 0, locker.front.z);
        }
        player.hidden = false;
        player.hideLocker = null;
        this.audio.click();
        break;
      }
      default:
        break;
    }
  }

  showNote(index) {
    const text = NOTES[index % NOTES.length];
    this.hud.chat('ЗАПИСКА', text, true);
    this.hud.toast(`Записка ${index + 1}/${OBJECTIVE.notes}: ${text.slice(0, 70)}…`, 6000);
  }

  setPowered(on) {
    if (this.powered === on) return;
    this.powered = on;
    this.world.setPowered(on);
    if (on) {
      this.audio.powerOn();
      this.hud.chat('СИСТЕМА', 'Питание подано. Шлюз разблокирован — уходите.', true);
      this.hud.toast('Шлюз открыт. Смотритель в ярости.', 5000);
      this.exitOpen = true;
      this.world.exitOpen = true;
      this.monster.extraSpeedBonus = 0.12;
    }
  }

  escapeLocal() {
    const player = this.player;
    if (player.escaped) return;
    player.escaped = true;
    this.net?.sendEvent({ k: 'escape', name: this.name });
    this.audio.win();
    this.audio.setMonsterProximity(Infinity, false);
    const stats = document.getElementById('win-stats');
    stats.innerHTML = `
      <div>Время <b>${formatTime(this.elapsed)}</b></div>
      <div>Предохранители <b>${this.installed}/${OBJECTIVE.fusesNeeded}</b></div>
      <div>Записки <b>${this.notes}/${OBJECTIVE.notes}</b></div>
      <div>Напарники <b>${this.net ? this.net.peerCount : 0}</b></div>
      <div>Здоровье <b>${Math.round(player.health)}%</b></div>
      <div>Фонарь <b>${Math.round(player.battery)}%</b></div>`;
    document.getElementById('win-text').textContent =
      this.net && this.net.peerCount > 0
        ? 'Вы вышли к шлюзу. Остальные ещё внизу — вы можете дождаться их в лобби.'
        : 'Вы вышли к шлюзу. Объект 12 остался позади — но вы слышали, как он дышит.';
    this.hud.showScreen('win');
    this.winShown = true;
    this.input.exitLock();
  }

  onLocalDeath() {
    if (this.hud.el.screenDead.classList.contains('hidden') === false) return;
    this.player.dead = true;
    this.net?.sendEvent({ k: 'dead' });
    if (this.player.hideLocker) {
      this.player.hideLocker.occupied = false;
      this.player.hideLocker = null;
      this.player.hidden = false;
    }
    this.audio.lose();
    this.audio.sting();
    this.hud.setBanners({ hidden: false, downed: false, dead: false });
    document.getElementById('dead-text').textContent =
      'Датчик вашего костюма замолчал на отметке ' + formatTime(this.elapsed) + '. Смотритель вернулся в темноту.';
    this.hud.showScreen('dead');
    this.input.exitLock();
    this.deadView = false;
    this.hud.setBanners({ hidden: false, downed: false, dead: false });
  }

  // ------------------------------------------------------------- сетевые события
  handleNetEvent(msg) {
    if (!msg || !msg.k) return;
    switch (msg.k) {
      case 'pickup': {
        this.world.takeItem(msg.i);
        if (msg.ty === 'note' && !this.notesSet.has(msg.i)) {
          this.notesSet.add(msg.i);
          this.notes++;
        }
        break;
      }
      case 'install': {
        if (this.net.isHost) {
          this.installed = Math.min(OBJECTIVE.fusesNeeded, this.installed + 1);
          this.world.setFusesInstalled(this.installed);
          this.broadcastObjective(true);
          if (this.installed >= OBJECTIVE.fusesNeeded) {
            this.hud.chat('СИСТЕМА', 'Все предохранители на месте. Запустите генератор.', true);
          }
        }
        break;
      }
      case 'obj': {
        if (this.net.isHost) break;
        this.applyObjective(msg);
        break;
      }
      case 'hit': {
        if (msg.target === this.net.id) {
          this.applyDamage(msg.damage || MONSTER.attackDamage);
        }
        break;
      }
      case 'noise': {
        if (this.net.isHost) this.monster.hearNoise(msg.x, msg.z, msg.r);
        break;
      }
      case 'scream': {
        const d = this.monster.pos.distanceTo(this.player.pos);
        if (d < 34) this.audio.monsterScream(1 + Math.max(0, 1 - d / 34) * 0.2);
        break;
      }
      case 'down': {
        const av = this.remotePlayers.get(msg.id);
        if (av) av.downed = true;
        break;
      }
      case 'revive': {
        if (msg.target === this.net.id && this.player.downed) {
          this.player.revive(45);
          this.hud.toast('Напарник поднял вас. Не подведите.');
        }
        break;
      }
      case 'escape': {
        this.hud.chat('СИСТЕМА', `${msg.name || 'Напарник'} выбрался к шлюзу`, true);
        break;
      }
      case 'dead': {
        const av = this.remotePlayers.get(msg.id);
        if (av) av.dead = true;
        break;
      }
      default:
        break;
    }
  }

  broadcastObjective(force = false) {
    if (!this.net || !this.net.connected) return;
    this.net.sendEvent({
      k: 'obj',
      fuses: this.installed,
      powered: this.powered,
      notes: this.notes,
      elapsed: +this.elapsed.toFixed(1),
    });
  }

  applyObjective(msg) {
    if (typeof msg.fuses === 'number' && msg.fuses !== this.installed) {
      this.installed = msg.fuses;
      this.world.setFusesInstalled(this.installed);
    }
    if (typeof msg.notes === 'number' && msg.notes > this.notes) this.notes = msg.notes;
    if (msg.powered && !this.powered) {
      this.setPowered(true);
    }
  }

  applyDamage(amount) {
    const player = this.player;
    if (player.dead || player.escaped || player.downed) return;
    player.damage(amount);
    this.audio.hurt();
    this.audio.sting();
    this.hud.damageFlash();
    this.shake = 1.2;
    if (player.downed) {
      this.net?.sendEvent({ k: 'down' });
      this.hud.chat('СИСТЕМА', 'Вы тяжело ранены. Кричите напарникам — они рядом?', true);
      this.audio.monsterScream(0.8);
      if (this.player.hideLocker) {
        this.player.hideLocker.occupied = false;
        this.player.hideLocker = null;
        this.player.hidden = false;
      }
    }
  }

  onMonsterEvent(evt) {
    if (evt.type === 'hit') {
      if (evt.id === this.net.id) {
        this.applyDamage(evt.damage);
      } else {
        this.net.sendEvent({ k: 'hit', target: evt.id, damage: evt.damage });
      }
    } else if (evt.type === 'scream') {
      this.audio.monsterScream(1);
      if (this.net.connected) this.net.sendEvent({ k: 'scream' });
    }
  }

  // ------------------------------------------------------------------ прочее
  toggleMap() {
    this.hud.toggleMap();
    if (this.hud.mapOpen) {
      this.hud.reveal(this.player.pos, 5);
      this.hud.drawMap();
      this.input.exitLock();
    } else {
      if (!this.input.isTouch) this.input.requestLock();
    }
  }

  togglePause(forcePause) {
    if (!this.running) return;
    if (this.hud.chatOpen) {
      this.hud.closeChat();
      this._unlockInputFocus();
      return;
    }
    const next = forcePause === true ? true : !this.paused;
    this.paused = next;
    if (next) {
      this.hud.showScreen('pause');
      this.input.consumeLook();
      this.input.exitLock();
      this.input.clearPressed();
      this.audio.setMuted(false);
      document.getElementById('pause-net').textContent =
        `комната ${this.room} · ${this.net?.lastStatus || 'нет сети'} · ${(this.net?.peerCount || 0) + 1} в сети`;
      this.hud.setPrompt(null);
    } else {
      this.hud.showScreen(null);
      if (!this.input.isTouch) this.input.requestLock();
      this.lastTime = performance.now();
    }
  }

  resume() {
    this.togglePause(false);
  }

  onResize() {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  sendChat(text) {
    if (this.net?.connected) this.net.sendChat(text);
  }
}

// Записки — короткие куски истории, которые собираются по бункеру.
const NOTES = [
  'Смена 12.11.87. В 03:40 датчик движения на нулевом этаже сработал 14 раз подряд. Людей там нет.',
  'Он не выходит на свет. Он идёт на звук. Инструкция: не бегать в темноте, не светить в коридор без нужды.',
  'Мы заперли его за шлюзом. Он перестал стучать через сутки. Через двое — стучать начали мы.',
  'Предохранители пришлось вынести вглубь, к дальним постам. Иначе он вырубает питание каждый час.',
  'Если слышишь дыхание за спиной — не оборачивайся. Просто иди к генератору. Он не любит шум генератора.',
  'Объект 12 не закрывали. Его просто перестали считать открытым. Если ты это читаешь — значит, тебя тоже посчитали.',
];

const game = new Game();
window.__obj12 = game;
