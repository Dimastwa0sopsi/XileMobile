// Локальный игрок: движение, стамина, фонарь, камера.
import * as THREE from 'three';
import { PLAYER } from './config.js';
import { clamp, damp, lerp } from './util.js';

export class Player {
  constructor(camera, grid, spawn, options = {}) {
    this.camera = camera;
    this.grid = grid;
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.vel = new THREE.Vector2();
    this.health = PLAYER.healthMax;
    this.stamina = PLAYER.staminaMax;
    this.battery = PLAYER.batteryMax;
    this.torchOn = true;
    this.crouched = false;
    this.downed = false;
    this.dead = false;
    this.escaped = false;
    this.hidden = false;
    this.hideLocker = null;
    this.hideT = 0;
    this.bleed = 0;
    this.staminaLock = 0;
    this.eye = PLAYER.eyeHeight;
    this.bobPhase = 0;
    this.stepDist = 0;
    this.walked = 0;
    this.speed = 0;
    this.hurtFlash = 0;
    this.lastHurt = 0;
    this.sprintHeld = false;
    this.baseFov = options.fov ?? 74;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.nickname = options.nickname || 'ВЫ';
    this.spawnPoint = { x: spawn.x, z: spawn.z, yaw: this.yaw };
  }

  get headPos() {
    return new THREE.Vector3(this.pos.x, this.eye + (this.downed ? -0.9 : 0), this.pos.z);
  }

  get forward() {
    return new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
  }

  get noiseRadius() {
    if (this.hidden || this.dead) return 0;
    if (this.speed > 3.6) return 18;
    if (this.crouched || this.speed < 1.4) return 5;
    return 10;
  }

  look(dx, dy) {
    if (this.dead) return;
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.32, 1.32);
  }

  toggleTorch() {
    if (this.dead) return false;
    if (!this.torchOn && this.battery <= 0.5) return false;
    this.torchOn = !this.torchOn;
    return true;
  }

  damage(amount) {
    if (this.dead || this.escaped) return;
    if (this.downed) return;
    this.health -= amount;
    this.hurtFlash = 1;
    this.lastHurt = 0;
    if (this.health <= 0) {
      this.health = 0;
      this.downed = true;
      this.bleed = PLAYER.bleedOut;
      this.vel.set(0, 0);
    }
  }

  heal(amount) {
    if (this.downed || this.dead) return false;
    if (this.health >= PLAYER.healthMax) return false;
    this.health = Math.min(PLAYER.healthMax, this.health + amount);
    return true;
  }

  revive(amount = 100) {
    if (!this.downed) return false;
    this.downed = false;
    this.bleed = 0;
    this.health = amount;
    return true;
  }

  update(dt, input, allowInput = true) {
    const events = { steps: [], done: '' };
    if (this.dead || this.escaped) {
      this._applyCamera(dt, 0);
      return events;
    }

    const look = allowInput ? input.consumeLook() : input.consumeLook();
    if (allowInput) this.look(look.x, look.y);

    let moveX = 0;
    let moveZ = 0;
    let mag = 0;
    if (allowInput && !this.hidden) {
      const mv = input.moveVector;
      mag = mv.magnitude;
      moveX = mv.x;
      moveZ = mv.y;
    }

    const wantCrouch = allowInput && input.held('crouch') && !this.downed;
    this.crouched = wantCrouch;
    this.sprintHeld = allowInput && input.held('sprint') && !this.crouched && !this.downed;

    let targetSpeed = this.crouched ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
    const sprinting = this.sprintHeld && mag > 0.1 && this.stamina > 1;
    if (sprinting) targetSpeed = PLAYER.runSpeed;
    if (this.downed) targetSpeed = 0.95;
    if (this.hidden) targetSpeed = 0;

    // Стамина
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      this.staminaLock = PLAYER.staminaDelay;
      if (this.stamina <= 0) targetSpeed = PLAYER.walkSpeed;
    } else {
      this.staminaLock = Math.max(0, this.staminaLock - dt);
      if (this.staminaLock <= 0) {
        const regen = this.crouched ? PLAYER.staminaRegen * 1.5 : PLAYER.staminaRegen;
        this.stamina = Math.min(PLAYER.staminaMax, this.stamina + regen * dt);
      }
    }

    // Движение относительно взгляда
    const fwd = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(Math.cos(this.yaw), -Math.sin(this.yaw));
    const desired = new THREE.Vector2();
    desired.x = fwd.x * -moveZ + right.x * moveX;
    desired.y = fwd.y * -moveZ + right.y * moveX;
    const desiredLen = desired.length();
    if (desiredLen > 0.001) desired.multiplyScalar(1 / Math.max(1, desiredLen));

    const accel = PLAYER.accel * (this.downed ? 0.4 : 1);
    if (mag > 0.05 && desiredLen > 0.01) {
      this.vel.x = damp(this.vel.x, desired.x * targetSpeed * mag, accel * 0.35, dt);
      this.vel.y = damp(this.vel.y, desired.y * targetSpeed * mag, accel * 0.35, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, PLAYER.friction, dt);
      this.vel.y = damp(this.vel.y, 0, PLAYER.friction, dt);
    }

    const before = { x: this.pos.x, z: this.pos.z };
    this.grid.move(this.pos, this.vel.x * dt, this.vel.y * dt, PLAYER.radius);
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.speed = moved / Math.max(dt, 0.0001);
    this.walked += moved;

    // Шаги
    if (!this.hidden) {
      const stride = sprinting ? 1.55 : this.crouched ? 2.6 : 2.0;
      this.stepDist += moved;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const kind = sprinting ? 'run' : this.crouched ? 'crouch' : 'walk';
        events.steps.push({ kind, noise: kind === 'run' ? 18 : this.crouched ? 4.5 : 10 });
      }
      this.bobPhase += moved * (sprinting ? 2.6 : 2.1);
    }

    // Фонарь
    if (this.torchOn) {
      this.battery = Math.max(0, this.battery - PLAYER.batteryDrain * dt);
      if (this.battery <= 0) this.torchOn = false;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);

    // Кровотечение в беспомощном состоянии
    if (this.downed) {
      this.bleed -= dt;
      if (this.bleed <= 0) {
        this.downed = false;
        this.dead = true;
        events.done = 'dead';
      }
    }

    // Высота глаз
    const targetEye = this.downed ? 0.55 : this.crouched ? PLAYER.crouchEye : PLAYER.eyeHeight;
    this.eye = damp(this.eye, targetEye, 9, dt);

    this._applyCamera(dt, moved);
    return events;
  }

  _applyCamera(dt, moved) {
    const cam = this.camera;
    const walkBob = Math.sin(this.bobPhase) * (this.speed > 4 ? 0.055 : 0.032);
    const sideBob = Math.cos(this.bobPhase * 0.5) * 0.018;
    const breathe = Math.sin(performance.now() * 0.0016) * 0.008;
    cam.position.set(this.pos.x, this.eye + walkBob + breathe, this.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch, this.yaw, this.hidden ? 0 : sideBob * 0.4);
    const targetFov = this.baseFov + (this.speed > 3.7 ? 5 : 0);
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov = damp(cam.fov, targetFov, 6, dt);
      cam.updateProjectionMatrix();
    }
  }
}
