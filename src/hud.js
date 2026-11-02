// HUD, карта и экраны.
import { OBJECTIVE } from './config.js';
import { formatTime, escapeHtml } from './util.js';

export class HUD {
  constructor(game) {
    this.game = game;
    this.visited = new Set();
    this.messages = [];
    this.toastTimer = null;
    this.mapOpen = false;

    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      objFuses: $('obj-fuses'),
      objGen: $('obj-gen'),
      objExit: $('obj-exit'),
      objNotes: $('obj-notes'),
      objTimer: $('obj-timer'),
      rowFuse: $('obj-row-fuse'),
      rowGen: $('obj-row-gen'),
      rowExit: $('obj-row-exit'),
      netStatus: $('net-status'),
      roomCode: $('room-code'),
      peers: $('peers'),
      barHealth: $('bar-health'),
      barStamina: $('bar-stamina'),
      barBattery: $('bar-battery'),
      valHealth: $('val-health'),
      valStamina: $('val-stamina'),
      valBattery: $('val-battery'),
      prompt: $('prompt'),
      promptText: $('prompt-text'),
      progressWrap: $('progress-wrap'),
      progressFill: $('progress-fill'),
      progressLabel: $('progress-label'),
      chatLog: $('chat-log'),
      chatBar: $('chat-bar'),
      chatInput: $('chat-input'),
      hiddenBanner: $('hidden-banner'),
      downedBanner: $('downed-banner'),
      spectateBanner: $('spectate-banner'),
      mapScreen: $('map-screen'),
      mapCanvas: $('map-canvas'),
      damage: $('damage'),
      fear: $('fear'),
      toast: $('toast'),
      introStatus: $('intro-status'),
      screenIntro: $('screen-intro'),
      screenPause: $('screen-pause'),
      screenDead: $('screen-dead'),
      screenWin: $('screen-win'),
      screenLose: $('screen-lose'),
    };
    this.ctx = this.el.mapCanvas.getContext('2d');
    this.lastPrompt = null;
  }

  showHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  setIntroStatus(text, cls = '') {
    this.el.introStatus.textContent = text;
    this.el.introStatus.className = `intro-status ${cls}`;
  }

  setNet(text, latency, count) {
    this.el.netStatus.textContent = latency > 0 ? `${text} · ${latency} мс · ${count} в сети` : `${text} · ${count} в сети`;
  }

  setRoom(code) {
    this.el.roomCode.textContent = code;
  }

  setObjective(state) {
    const installed = state.fusesInstalled;
    const carried = state.fusesCarried;
    this.el.objFuses.textContent = `${installed} / ${OBJECTIVE.fusesNeeded}${carried ? ` (+${carried})` : ''}`;
    this.el.objNotes.textContent = `Записки: ${state.notes} / ${OBJECTIVE.notes}`;
    this.el.objTimer.textContent = formatTime(state.elapsed);

    const fuseDone = installed >= OBJECTIVE.fusesNeeded;
    this.el.rowFuse.classList.toggle('done', fuseDone);
    this.el.rowFuse.classList.toggle('active', !fuseDone);

    this.el.rowGen.classList.toggle('done', state.powered);
    this.el.rowGen.classList.toggle('active', fuseDone && !state.powered);
    this.el.objGen.textContent = state.powered ? 'запущен' : fuseDone ? 'готов' : '—';

    this.el.rowExit.classList.toggle('done', state.escaped);
    this.el.rowExit.classList.toggle('active', state.powered && !state.escaped);
    this.el.objExit.textContent = state.powered ? 'открыт' : 'заблокирован';
  }

  setBars(player) {
    const hp = Math.max(0, Math.round(player.health));
    this.el.barHealth.style.width = `${hp}%`;
    this.el.valHealth.textContent = hp;
    const st = Math.round(player.stamina);
    this.el.barStamina.style.width = `${st}%`;
    this.el.valStamina.textContent = st;
    const bt = Math.round(player.battery);
    this.el.barBattery.style.width = `${bt}%`;
    this.el.valBattery.textContent = bt;
  }

  setPrompt(text, key = 'E') {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    if (!text) {
      this.el.prompt.classList.add('hidden');
      return;
    }
    this.el.prompt.classList.remove('hidden');
    this.el.prompt.querySelector('b').textContent = key;
    this.el.promptText.textContent = text;
  }

  setProgress(ratio, label) {
    if (ratio === null) {
      this.el.progressWrap.classList.add('hidden');
      return;
    }
    this.el.progressWrap.classList.remove('hidden');
    this.el.progressFill.style.width = `${Math.round(ratio * 100)}%`;
    this.el.progressLabel.textContent = label || '';
  }

  setBanners({ hidden, downed, dead }) {
    this.el.hiddenBanner.classList.toggle('hidden', !hidden);
    this.el.downedBanner.classList.toggle('hidden', !downed);
    this.el.spectateBanner.classList.toggle('hidden', !dead);
  }

  setPeers(list, localId) {
    const html = [];
    for (const p of list) {
      const cls = p.dead ? 'peer dead' : p.downed ? 'peer downed' : 'peer';
      const hp = Math.max(0, Math.min(100, p.health ?? 100));
      html.push(
        `<div class="${cls}"><span class="php"><i style="width:${hp}%"></i></span><span class="pname">${escapeHtml(p.name || 'ВЫЖИВШИЙ')}</span></div>`
      );
    }
    this.el.peers.innerHTML = html.join('');
  }

  chat(who, text, system = false) {
    const div = document.createElement('div');
    div.className = `chat-msg${system ? ' system' : ''}`;
    if (!system) {
      div.innerHTML = `<span class="who">${escapeHtml(who)}:</span>${escapeHtml(text)}`;
    } else {
      div.textContent = text;
    }
    this.el.chatLog.appendChild(div);
    this.messages.push(div);
    while (this.messages.length > 6) {
      const old = this.messages.shift();
      old.remove();
    }
    setTimeout(() => {
      div.style.transition = 'opacity 0.6s';
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 700);
    }, 9000);
  }

  toast(text, ms = 3200) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }

  damageFlash() {
    this.el.damage.style.opacity = '1';
    setTimeout(() => { this.el.damage.style.opacity = '0'; }, 160);
  }

  setFear(v) {
    this.el.fear.style.opacity = String(Math.max(0, Math.min(0.85, v)));
  }

  // -------------------------------------------------------------- экраны
  showScreen(name) {
    for (const key of ['intro', 'pause', 'dead', 'win', 'lose']) {
      const el = this.el[`screen${key[0].toUpperCase()}${key.slice(1)}`];
      if (el) el.classList.toggle('hidden', key !== name);
    }
  }

  hideScreens() {
    this.showScreen(null);
  }

  toggleMap(force) {
    this.mapOpen = force !== undefined ? force : !this.mapOpen;
    this.el.mapScreen.classList.toggle('hidden', !this.mapOpen);
  }

  openChat() {
    this.el.chatBar.classList.remove('hidden');
    this.el.chatInput.value = '';
    setTimeout(() => this.el.chatInput.focus(), 30);
  }

  closeChat() {
    this.el.chatBar.classList.add('hidden');
    this.el.chatInput.blur();
  }

  get chatOpen() {
    return !this.el.chatBar.classList.contains('hidden');
  }

  // ---------------------------------------------------------------- карта
  reveal(playerPos, radius = 5) {
    const { grid, size } = this.game;
    const cell = this.game.cell;
    const half = (size - 1) / 2;
    const cx = Math.round(playerPos.x / cell + half);
    const cz = Math.round(playerPos.z / cell + half);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= size || z >= size) continue;
        if (Math.hypot(dx, dz) > radius) continue;
        if (!grid.isSolid(x, z)) this.visited.add(z * size + x);
      }
    }
  }

  drawMap() {
    const { grid, size, cell } = this.game;
    const canvas = this.el.mapCanvas;
    const ctx = this.ctx;
    const W = canvas.width;
    const s = W / size;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#05080b';
    ctx.fillRect(0, 0, W, W);

    // раскрытые полы
    for (const k of this.visited) {
      const x = k % size;
      const z = (k / size) | 0;
      ctx.fillStyle = '#1b2a35';
      ctx.fillRect(x * s, z * s, s + 0.5, s + 0.5);
    }
    // стены рядом с раскрытыми клетками
    ctx.fillStyle = '#2c3d49';
    for (const k of this.visited) {
      const x = k % size;
      const z = (k / size) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        if (grid.isSolid(nx, nz)) ctx.fillRect(nx * s, nz * s, s + 0.5, s + 0.5);
      }
    }

    const world = this.game.world;
    const toMap = (wx, wz) => ({
      x: (wx / cell + (size - 1) / 2) * s,
      y: (wz / cell + (size - 1) / 2) * s,
    });

    // предметы на раскрытых клетках
    if (world) {
      for (const item of world.items) {
        if (item.taken) continue;
        const k = item.cell.z * size + item.cell.x;
        if (!this.visited.has(k)) continue;
        const p = toMap(item.group.position.x, item.group.position.z);
        ctx.fillStyle = item.type === 'fuse' ? '#ffb44d' : item.type === 'note' ? '#88bbff' : item.type === 'battery' ? '#ffe45e' : '#7bffa4';
        const r = item.type === 'fuse' ? 3.4 : 2.4;
        if (Math.floor(performance.now() / 340) % 2 === 0 || item.type !== 'fuse') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, 7);
          ctx.fill();
        }
      }
      if (world.generator) {
        const p = toMap(world.generator.pos.x, world.generator.pos.z);
        ctx.fillStyle = '#34d17a';
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      }
      if (world.exit) {
        const p = toMap(world.exit.pos.x, world.exit.pos.z);
        ctx.fillStyle = '#ff2f21';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 5);
        ctx.lineTo(p.x + 5, p.y + 4);
        ctx.lineTo(p.x - 5, p.y + 4);
        ctx.closePath();
        ctx.fill();
      }
      for (const locker of world.lockers) {
        const c = { x: Math.round(locker.pos.x / cell + (size - 1) / 2), z: Math.round(locker.pos.z / cell + (size - 1) / 2) };
        if (!this.visited.has(c.z * size + c.x)) continue;
        const p = toMap(locker.pos.x, locker.pos.z);
        ctx.fillStyle = '#3d6a52';
        ctx.fillRect(p.x - 1.6, p.y - 1.6, 3.2, 3.2);
      }
    }

    // напарники
    if (this.game.remotePlayers) {
      ctx.fillStyle = '#5ec8ff';
      for (const rp of this.game.remotePlayers.list()) {
        if (!rp.visible) continue;
        const p = toMap(rp.pos.x, rp.pos.z);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, 7);
        ctx.fill();
      }
    }

    // локальный игрок
    const me = this.game.player;
    const p = toMap(me.pos.x, me.pos.z);
    ctx.save();
    ctx.translate(p.x, p.y);
    const angle = Math.atan2(-Math.cos(me.yaw), -Math.sin(me.yaw));
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = '#eaf4ff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
