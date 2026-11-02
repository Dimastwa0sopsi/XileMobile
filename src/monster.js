// «СМОТРИТЕЛЬ» — хост-управляемый монстр: слух, зрение, погоня.
import * as THREE from 'three';
import { MONSTER, COLORS } from './config.js';
import { clamp, damp, angleDelta, angleLerp, mulberry32 } from './util.js';

export class Monster {
  constructor(scene, grid, level, rndSeed = 1) {
    this.scene = scene;
    this.grid = grid;
    this.level = level;
    this.rnd = mulberry32(rndSeed * 7919 + 13);

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'dormant';
    this.speed = 0;
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.target = new THREE.Vector3();
    this.lastSeen = 0;
    this.attackCooldown = 0;
    this.screamCooldown = 2;
    this.stuckTimer = 0;
    this.lastPos = new THREE.Vector3();
    this.grace = MONSTER.grace;
    this.difficulty = 1;
    this.extraSpeedBonus = 0;
    this.elapsed = 0;
    this.walkPhase = 0;
    this.interpTarget = null;
    this.interpYaw = 0;
    this.alerted = false;

    this._buildModel();
  }

  _buildModel() {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({
      color: 0x0d0d10,
      roughness: 0.95,
      metalness: 0.05,
      emissive: 0x0a0204,
      emissiveIntensity: 1,
    });
    const skinLite = new THREE.MeshStandardMaterial({ color: 0x151317, roughness: 1 });

    // Торс — вытянутый, сгорбленный
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.95, 4, 10), skin);
    torso.position.y = 1.55;
    torso.scale.set(1, 1, 0.72);
    torso.castShadow = true;
    group.add(torso);
    this.torso = torso;

    // Грудная клетка / рёбра
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.28 - i * 0.02, 0.026, 5, 12, Math.PI), skinLite);
      rib.rotation.x = Math.PI / 2;
      rib.rotation.z = Math.PI * 0.5;
      rib.position.set(0, 1.75 - i * 0.16, 0.13);
      group.add(rib);
    }

    // Голова — вытянутый череп
    const head = new THREE.Group();
    head.position.set(0, 2.28, 0.02);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), skin);
    skull.scale.set(0.92, 1.28, 0.95);
    skull.castShadow = true;
    head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.24), skin);
    jaw.position.set(0, -0.2, 0.06);
    head.add(jaw);
    this.jaw = jaw;

    const eyeMat = new THREE.MeshBasicMaterial({ color: COLORS.monsterEye });
    for (const sx of [-0.09, 0.09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), eyeMat);
      eye.position.set(sx, 0.04, 0.2);
      head.add(eye);
    }
    // Свечение глаз
    const glowTex = null;
    const glowMat = new THREE.SpriteMaterial({
      color: COLORS.monsterEye,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(0.9, 0.5, 1);
    glow.position.set(0, 0.04, 0.22);
    head.add(glow);
    this.eyeGlow = glow;
    group.add(head);
    this.head = head;

    // Руки — длинные, до колен
    this.arms = [];
    for (const [sx, phase] of [[-0.34, 0], [0.34, Math.PI]]) {
      const arm = new THREE.Group();
      arm.position.set(sx, 2.0, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.75, 3, 6), skin);
      upper.position.y = -0.42;
      upper.castShadow = true;
      arm.add(upper);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.75, 3, 6), skinLite);
      fore.position.y = -1.15;
      fore.castShadow = true;
      arm.add(fore);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), skinLite);
      claw.position.y = -1.6;
      claw.rotation.x = Math.PI;
      arm.add(claw);
      arm.userData.phase = phase;
      group.add(arm);
      this.arms.push(arm);
    }

    // Ноги
    this.legs = [];
    for (const [sx, phase] of [[-0.16, 0], [0.16, Math.PI]]) {
      const leg = new THREE.Group();
      leg.position.set(sx, 1.0, 0);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.6, 3, 6), skin);
      thigh.position.y = -0.35;
      thigh.castShadow = true;
      leg.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 3, 6), skinLite);
      shin.position.y = -0.95;
      shin.castShadow = true;
      leg.add(shin);
      leg.userData.phase = phase;
      group.add(leg);
      this.legs.push(leg);
    }

    // Тёмный «плащ» из плоскости
    const cloak = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.7, 8, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x08080a,
        roughness: 1,
        side: THREE.DoubleSide,
      })
    );
    cloak.position.y = 1.25;
    group.add(cloak);
    this.cloak = cloak;

    group.visible = false;
    this.group = group;
    this.scene.add(group);
  }

  spawnAt(cell) {
    const p = this.grid.size;
    const cx = (cell.x - (p - 1) / 2) * this.grid.cell;
    const cz = (cell.z - (p - 1) / 2) * this.grid.cell;
    this.pos.set(cx, 0, cz);
    this.lastPos.copy(this.pos);
    this.group.position.copy(this.pos);
  }

  setActive(on) {
    if (on && this.state === 'dormant') {
      this.state = 'patrol';
      this._pickPatrolTarget();
      this.group.visible = true;
    }
  }

  hearNoise(x, z, radius) {
    if (this.state === 'dormant' || this.state === 'chase') return;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > radius) return;
    this.target.set(x, 0, z);
    this.state = 'investigate';
    this.repathTimer = 0;
    this.lastSeen = Math.max(this.lastSeen, this.elapsed * 0.5);
  }

  _pickPatrolTarget() {
    // Случайная точка недалеко от текущей
    const cell = this.grid.nearestOpen(this.pos.x, this.pos.z);
    for (let i = 0; i < 40; i++) {
      const x = clamp(cell.x + Math.floor((this.rnd() - 0.5) * 18), 1, this.grid.size - 2);
      const z = clamp(cell.z + Math.floor((this.rnd() - 0.5) * 18), 1, this.grid.size - 2);
      if (this.grid.isOpen(x, z)) {
        const w = (x - (this.grid.size - 1) / 2) * this.grid.cell;
        const w2 = (z - (this.grid.size - 1) / 2) * this.grid.cell;
        this.target.set(w, 0, w2);
        this.path = null;
        this.repathTimer = 0;
        return;
      }
    }
  }

  _repath() {
    const from = this.grid.nearestOpen(this.pos.x, this.pos.z);
    const to = this.grid.nearestOpen(this.target.x, this.target.z);
    const path = this.grid.findPath(from.x, from.z, to.x, to.z);
    this.path = path;
    this.pathIndex = 0;
    if (!path || path.length === 0) {
      this.path = null;
      return false;
    }
    return true;
  }

  _canSee(player) {
    if (player.dead || player.hidden) return false;
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3.2) {
      return this.grid.lineOfSight(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
    }
    const lit = player.torchOn && player.battery > 0;
    const range = lit ? MONSTER.sightRangeLit : MONSTER.sightRange;
    if (dist > range) return false;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    if (dot < MONSTER.sightFov) return false;
    return this.grid.lineOfSight(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
  }

  // Хост-симуляция. playerList: [{id, pos, torchOn, battery, dead, hidden, downed}]
  update(dt, playerList, elapsed, onAttack) {
    this.elapsed = elapsed;
    this.difficulty = 1 + Math.min(MONSTER.speedRampCap, (elapsed / 60) * MONSTER.speedRampPerMin);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.screamCooldown = Math.max(0, this.screamCooldown - dt);

    if (this.state === 'dormant') {
      const near = playerList.some((p) => !p.dead && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 11);
      if (elapsed > this.grace || near) {
        this.setActive(true);
        this.screamCooldown = 0;
      } else {
        return;
      }
    }

    // --- Восприятие
    let seen = null;
    let seenDist = Infinity;
    for (const p of playerList) {
      if (this._canSee(p)) {
        const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        if (d < seenDist) {
          seenDist = d;
          seen = p;
        }
      }
    }

    if (seen) {
      if (this.state !== 'chase') {
        this.state = 'chase';
        this.alerted = true;
        this.path = null;
        this.repathTimer = 0;
      }
      this.target.set(seen.pos.x, 0, seen.pos.z);
      this.lastSeen = elapsed;
      this.chasingId = seen.id;
      if (this.screamCooldown <= 0 && seenDist < 22) {
        this.screamCooldown = 6 + this.rnd() * 5;
        if (onAttack) onAttack({ type: 'scream' });
      }
    } else if (this.state === 'chase' && elapsed - this.lastSeen > MONSTER.loseInterest) {
      this.state = 'investigate';
      this.path = null;
      this.repathTimer = 0;
    } else if (this.state === 'chase') {
      // Идём в последнюю точку, где видели
      const lx = this.lastSeenX ?? this.target.x;
      const lz = this.lastSeenZ ?? this.target.z;
      this.target.set(lx, 0, lz);
    }

    // --- Атака
    if (this.attackCooldown <= 0 && onAttack) {
      for (const p of playerList) {
        if (p.dead || p.escaped || p.hidden || p.downed) continue;
        const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        if (d < MONSTER.attackRange && this.grid.lineOfSight(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
          this.attackCooldown = MONSTER.attackCooldown;
          onAttack({ type: 'hit', id: p.id, damage: MONSTER.attackDamage, downed: p.downed });
          break;
        }
      }
    }

    // --- Навигация
    this.patrolWait = Math.max(0, (this.patrolWait || 0) - dt);
    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = 0.45 + this.rnd() * 0.25;
      if (!this._repath()) {
        if (this.state === 'investigate') {
          this.state = 'patrol';
          this.patrolWait = 0.8;
        }
        this._pickPatrolTarget();
      }
    }

    let speed = MONSTER.patrolSpeed;
    if (this.state === 'investigate') speed = MONSTER.investigateSpeed;
    if (this.state === 'chase') speed = MONSTER.chaseSpeed * (seenDist < 5 ? 1.1 : 1);
    speed *= this.difficulty * (1 + this.extraSpeedBonus);

    let movePoint = null;
    if (this.path && this.path.length) {
      while (this.pathIndex < this.path.length) {
        const cell = this.path[this.pathIndex];
        const cx = (cell.x - (this.grid.size - 1) / 2) * this.grid.cell;
        const cz = (cell.z - (this.grid.size - 1) / 2) * this.grid.cell;
        if (Math.hypot(cx - this.pos.x, cz - this.pos.z) < 0.9) {
          this.pathIndex++;
          continue;
        }
        movePoint = { x: cx, z: cz };
        break;
      }
      if (this.pathIndex >= this.path.length) {
        this.path = null;
        if (this.state === 'chase') {
          this.repathTimer = 0;
        } else if (this.state === 'investigate') {
          this.state = 'patrol';
          this.patrolWait = 1 + this.rnd() * 1.8;
        } else if (this.state === 'patrol') {
          this.patrolWait = 0.5 + this.rnd() * 1.4;
        }
      }
    }

    if (!this.path && this.patrolWait <= 0 && this.state !== 'chase') {
      if (this.state === 'patrol') {
        this._pickPatrolTarget();
      } else {
        this.repathTimer = 0;
      }
    }

    if (movePoint && this.patrolWait <= 0) {
      const dx = movePoint.x - this.pos.x;
      const dz = movePoint.z - this.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      // сглаженное движение — без резких поворотов на 90°
      const stepLen = speed * dt;
      this.pos.x += (dx / len) * stepLen;
      this.pos.z += (dz / len) * stepLen;
      const targetYaw = Math.atan2(-dx, -dz);
      this.yaw = angleLerp(this.yaw, targetYaw, Math.min(1, dt * 8));
      this.speed = speed;
      this.walkPhase += dt * (this.state === 'chase' ? 9 : 5.2);
    } else {
      this.speed = damp(this.speed, 0, 6, dt);
      // лёгкое дыхание/покачивание
      this.walkPhase += dt * 1.2;
    }

    // Застревание
    if (this.pos.distanceTo(this.lastPos) < 0.02) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.6) {
        this.stuckTimer = 0;
        this.path = null;
        this.repathTimer = 0;
        if (this.state === 'patrol') this._pickPatrolTarget();
      }
    } else {
      this.stuckTimer = 0;
      this.lastPos.copy(this.pos);
    }

    if (seen) {
      this.lastSeenX = seen.pos.x;
      this.lastSeenZ = seen.pos.z;
    }

    this._animate(dt);
  }

  _animate(dt) {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    const moving = Math.min(1, this.speed / 2);
    const swing = Math.sin(this.walkPhase) * 0.9 * moving;
    if (this.legs) {
      this.legs[0].rotation.x = swing;
      this.legs[1].rotation.x = -swing;
    }
    if (this.arms) {
      this.arms[0].rotation.x = -swing * 0.8 + 0.15;
      this.arms[1].rotation.x = swing * 0.8 + 0.15;
      this.arms[0].rotation.z = 0.08 + Math.sin(this.walkPhase * 0.7) * 0.05;
      this.arms[1].rotation.z = -0.08 - Math.sin(this.walkPhase * 0.7) * 0.05;
    }
    if (this.torso) {
      this.torso.position.y = 1.55 + Math.sin(this.walkPhase * 2) * 0.02 * moving;
      this.torso.rotation.x = 0.12 + moving * 0.06;
    }
    if (this.head) {
      this.head.rotation.x = -0.1 + Math.sin(this.walkPhase * 0.6) * 0.06;
      this.head.rotation.z = Math.sin(this.walkPhase * 0.4) * 0.05;
    }
    if (this.cloak) {
      this.cloak.rotation.y = Math.sin(this.walkPhase * 0.5) * 0.1;
    }
    if (this.eyeGlow) {
      const pulse = this.state === 'chase' ? 0.7 + Math.sin(this.walkPhase * 3) * 0.25 : 0.35;
      this.eyeGlow.material.opacity = pulse;
    }
  }

  // Сетевой режим: плавно тянемся к позиции с хоста.
  applyNetState(state, dt) {
    if (!state) return;
    const netState = state.state || 'patrol';
    this.group.visible = netState !== 'dormant';
    if (netState === 'dormant') {
      this.state = 'dormant';
      this.pos.set(state.x, 0, state.z);
      return;
    }
    if (this.state === 'dormant') {
      this.pos.set(state.x, 0, state.z);
    }
    this.interpTarget = { x: state.x, z: state.z };
    this.interpYaw = state.yaw;
    this.state = netState;
    const k = 1 - Math.exp(-12 * dt);
    this.pos.x += (this.interpTarget.x - this.pos.x) * k;
    this.pos.z += (this.interpTarget.z - this.pos.z) * k;
    this.yaw = angleLerp(this.yaw, this.interpYaw, Math.min(1, dt * 12));
    this.speed = 2.4;
    this.walkPhase += dt * 5.5;
    this._animate(dt);
  }

  get netState() {
    return { x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(2), state: this.state };
  }
}
