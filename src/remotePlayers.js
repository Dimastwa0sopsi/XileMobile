// Аватары напарников по сети.
import * as THREE from 'three';
import { angleLerp } from './util.js';

function makeLabel(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 12, 256, 40);
  ctx.fillStyle = '#cfe3f2';
  ctx.fillText(name.slice(0, 14).toUpperCase(), 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 })
  );
  sprite.scale.set(1.9, 0.48, 1);
  return sprite;
}

class RemoteAvatar {
  constructor(scene, id, name) {
    this.id = id;
    this.name = name || 'ВЫЖИВШИЙ';
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.visible = false;
    this.health = 100;
    this.downed = false;
    this.dead = false;
    this.torchOn = true;
    this.crouched = false;
    this.hidden = false;
    this.lastSeen = performance.now();
    this.bobPhase = 0;
    this.speed = 0;

    const group = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x2b3a44,
      roughness: 0.85,
      metalness: 0.15,
      emissive: 0x0a141a,
      emissiveIntensity: 1,
    });
    const vestMat = new THREE.MeshStandardMaterial({ color: 0x1a232a, roughness: 0.9 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.85, 4, 10), suitMat);
    body.position.y = 1.02;
    body.castShadow = true;
    group.add(body);

    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.42), vestMat);
    vest.position.y = 1.2;
    group.add(vest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), suitMat);
    head.position.y = 1.7;
    head.castShadow = true;
    group.add(head);

    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    this.shoulderLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), lampMat);
    this.shoulderLamp.position.set(0.22, 1.48, 0.12);
    group.add(this.shoulderLamp);

    const beacon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0x6fc8ff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    beacon.position.set(0, 1.35, 0);
    beacon.scale.set(1.5, 1.5, 1);
    group.add(beacon);
    this.beacon = beacon;

    // Конус «фонаря»
    const coneGeo = new THREE.ConeGeometry(1.5, 7, 12, 1, true);
    coneGeo.translate(0, -3.5, 0);
    coneGeo.rotateX(Math.PI / 2);
    this.beam = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffe3b0,
        transparent: true,
        opacity: 0.055,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.beam.position.set(0, 1.3, 0.2);
    group.add(this.beam);

    this.label = makeLabel(this.name);
    this.label.position.y = 2.15;
    group.add(this.label);

    group.visible = false;
    this.group = group;
    scene.add(group);
  }

  applyState(s) {
    this.target.set(s.p[0], 0, s.p[1]);
    this.targetYaw = s.y ?? 0;
    this.health = s.hp ?? 100;
    this.downed = !!s.dn;
    this.dead = !!s.dd;
    this.torchOn = !!s.f;
    this.crouched = !!s.c;
    this.hidden = !!s.h;
    this.lastSeen = performance.now();
    if (!this.visible) {
      this.visible = true;
      this.group.visible = true;
      this.pos.copy(this.target);
      this.yaw = this.targetYaw;
    }
  }

  update(dt) {
    const before = this.pos.clone();
    const k = 1 - Math.exp(-10 * dt);
    this.pos.lerp(this.target, k);
    this.yaw = angleLerp(this.yaw, this.targetYaw, Math.min(1, dt * 10));
    this.speed = this.pos.distanceTo(before) / Math.max(dt, 0.001);

    const g = this.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    g.rotation.z = this.downed ? Math.PI * 0.44 : 0;
    g.position.y = this.downed ? 0.35 : 0;

    this.bobPhase += dt * (this.speed > 0.4 ? 7 : 1.5);
    const bob = Math.sin(this.bobPhase) * (this.speed > 0.4 ? 0.04 : 0.01);
    g.position.y += this.downed ? 0 : bob;

    if (this.dead) {
      this.beacon.material.opacity = 0.05;
      this.beam.visible = false;
      this.shoulderLamp.material.color.setHex(0x201010);
    } else if (this.downed) {
      this.beacon.material.color.setHex(0xff5a3a);
      this.beacon.material.opacity = 0.6;
      this.beam.visible = false;
      this.shoulderLamp.material.color.setHex(0x402020);
    } else {
      this.beacon.material.color.setHex(0x6fc8ff);
      this.beacon.material.opacity = 0.45 + Math.sin(this.bobPhase * 0.6) * 0.1;
      this.beam.visible = this.torchOn;
      this.shoulderLamp.material.color.setHex(this.torchOn ? 0xfff0c0 : 0x202020);
    }
    this.label.visible = !this.dead;
    const camDist = this.label.position.length();
    this.label.material.opacity = 0.92;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.avatars = new Map();
  }

  ensure(id, name) {
    if (!this.avatars.has(id)) {
      this.avatars.set(id, new RemoteAvatar(this.scene, id, name));
    } else if (name) {
      const av = this.avatars.get(id);
      if (av.name !== name) {
        av.name = name;
        av.group.remove(av.label);
        av.label = makeLabel(name);
        av.label.position.y = 2.15;
        av.group.add(av.label);
      }
    }
    return this.avatars.get(id);
  }

  applyState(id, name, state) {
    const av = this.ensure(id, name);
    av.applyState(state);
    return av;
  }

  remove(id) {
    const av = this.avatars.get(id);
    if (!av) return;
    this.scene.remove(av.group);
    av.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.avatars.delete(id);
  }

  list() {
    return [...this.avatars.values()];
  }

  get(id) {
    return this.avatars.get(id);
  }

  update(dt) {
    const now = performance.now();
    for (const [id, av] of [...this.avatars.entries()]) {
      if (now - av.lastSeen > 9000) {
        this.remove(id);
        continue;
      }
      av.update(dt);
    }
  }

  nearestDowned(pos, range) {
    let best = null;
    let bestD = range;
    for (const av of this.avatars.values()) {
      if (!av.downed || av.dead) continue;
      const d = Math.hypot(av.pos.x - pos.x, av.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = av;
      }
    }
    return best;
  }

  clear() {
    for (const id of [...this.avatars.keys()]) this.remove(id);
  }
}
