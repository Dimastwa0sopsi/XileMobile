// Сборка трёхмерного бункера: геометрия, свет, предметы, интерактивные объекты.
import * as THREE from 'three';
import { getTextures } from './textures.js';
import { cellToWorld } from './maze.js';
import { MAZE, COLORS, OBJECTIVE } from './config.js';
import { mulberry32 } from './util.js';

const CELL = MAZE.cell;

export class World {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.grid = level.grid;
    this.tex = getTextures();
    this.rnd = mulberry32(level.seed ^ 0x9e3779b9);
    this.time = 0;
    this.powered = false;
    this.exitOpen = false;
    this.exitAnim = 0;

    this.items = [];
    this.lockers = [];
    this.lamps = [];
    this.lampLights = [];
    this.dust = null;
    this.pickups = new Map();

    scene.fog = new THREE.FogExp2(COLORS.fog, 0.047);
    scene.background = new THREE.Color(COLORS.fog);

    this._buildStatic();
    this._buildLamps();
    this._buildProps();
    this._buildDecals();
    this._buildItems();
    this._buildLockers();
    this._buildGenerator();
    this._buildExit();
    this._buildDust();
    this._buildLights();
  }

  // ---------------------------------------------------------------- геометрия
  _buildStatic() {
    const { level, tex } = this;
    const size = level.size;
    const cells = [];
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        if (this.grid.isSolid(x, z)) cells.push([x, z]);
      }
    }

    const dummy = new THREE.Object3D();

    // Стены
    const wallGeo = new THREE.BoxGeometry(CELL, MAZE.wallHeight, CELL);
    const wallMat = new THREE.MeshStandardMaterial({
      map: tex.wall,
      color: 0x8d8a82,
      roughness: 0.94,
      metalness: 0.04,
    });
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, cells.length);
    walls.castShadow = true;
    walls.receiveShadow = true;
    cells.forEach(([x, z], i) => {
      const p = cellToWorld(x, z);
      dummy.position.set(p.x, MAZE.wallHeight / 2, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      walls.setMatrixAt(i, dummy.matrix);
    });
    walls.instanceMatrix.needsUpdate = true;
    this.scene.add(walls);

    // Плинтус / ржавая окантовка у пола
    const trimGeo = new THREE.BoxGeometry(CELL * 1.01, 0.34, CELL * 1.01);
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.9, metalness: 0.35 });
    const trims = new THREE.InstancedMesh(trimGeo, trimMat, cells.length);
    trims.receiveShadow = true;
    cells.forEach(([x, z], i) => {
      const p = cellToWorld(x, z);
      dummy.position.set(p.x, 0.17, p.z);
      dummy.updateMatrix();
      trims.setMatrixAt(i, dummy.matrix);
    });
    trims.instanceMatrix.needsUpdate = true;
    this.scene.add(trims);

    // Пол
    const span = size * CELL;
    const floorMat = new THREE.MeshStandardMaterial({
      map: tex.floor,
      color: 0x7c7f83,
      roughness: 0.86,
      metalness: 0.28,
    });
    tex.floor.repeat.set(size, size);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Потолок
    tex.ceiling.repeat.set(size * 1.5, size * 1.5);
    const ceilMat = new THREE.MeshStandardMaterial({ map: tex.ceiling, color: 0x555a60, roughness: 1 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(span, span), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = MAZE.wallHeight;
    this.scene.add(ceil);

    // Балки на потолке для объёма
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.85, metalness: 0.5 });
    const beamCount = 0;
    this.beams = [];
    for (let i = 0; i < beamCount; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.25, 0.3, span), beamMat);
      this.scene.add(beam);
    }

    this.walls = walls;
  }

  // ----------------------------------------------------------------- свет
  _buildLights() {
    this.ambient = new THREE.AmbientLight(COLORS.ambient, 1.15);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0x2b3f52, 0x0f0b08, 0.55);
    this.scene.add(this.hemi);

    // Пул фонарных источников — переезжают к ближайшим лампам.
    for (let i = 0; i < 6; i++) {
      const light = new THREE.PointLight(COLORS.lamp, 0, 16, 1.8);
      light.castShadow = false;
      this.scene.add(light);
      this.lampLights.push(light);
    }

    // Фонарик игрока
    this.flashlight = new THREE.SpotLight(COLORS.flashlight, 55, 38, 0.45, 0.6, 1.5);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.4;
    this.flashlight.shadow.camera.far = 40;
    this.flashlight.shadow.bias = -0.0012;
    this.flashlight.shadow.normalBias = 0.03;
    this.flashlightTarget = new THREE.Object3D();
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    // Слабый "блик" от фонарика вокруг игрока, чтобы видеть ноги.
    this.flashlightFill = new THREE.PointLight(0xffe8c0, 0, 7, 2);
    this.scene.add(this.flashlightFill);

    // Свет монстра.
    this.monsterLight = new THREE.PointLight(0xff1a0a, 0, 9, 2);
    this.scene.add(this.monsterLight);
  }

  _buildLamps() {
    const dummy = new THREE.Object3D();
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x24282c, metalness: 0.7, roughness: 0.55 });
    const housingGeo = new THREE.BoxGeometry(1.5, 0.16, 0.46);
    this.lampHousings = new THREE.InstancedMesh(housingGeo, housingMat, this.level.lamps.length);
    this.lampHousings.castShadow = false;
    this.scene.add(this.lampHousings);

    this.tubeGeo = new THREE.BoxGeometry(1.24, 0.09, 0.24);
    this.tubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.tubes = new THREE.InstancedMesh(this.tubeGeo, this.tubeMat, this.level.lamps.length);
    this.scene.add(this.tubes);

    this.level.lamps.forEach((lamp, i) => {
      const p = cellToWorld(lamp.x, lamp.z);
      const broken = this.rnd() < 0.32;
      lamp.pos = new THREE.Vector3(p.x, MAZE.wallHeight - 0.25, p.z);
      lamp.broken = broken;
      lamp.phase = this.rnd() * 100;
      lamp.flicker = this.rnd() < 0.45;
      lamp.color = new THREE.Color(lamp.cold ? COLORS.lampCold : COLORS.lamp);
      lamp.index = i;

      dummy.position.copy(lamp.pos);
      dummy.position.y += 0.12;
      dummy.updateMatrix();
      this.lampHousings.setMatrixAt(i, dummy.matrix);

      dummy.position.copy(lamp.pos);
      dummy.updateMatrix();
      this.tubes.setMatrixAt(i, dummy.matrix);
      this.tubes.setColorAt(i, new THREE.Color(broken ? 0x0a0c0e : 0xffe6bb));
      this.lamps.push(lamp);
    });
    this.tubes.instanceColor.needsUpdate = true;
    this.lampHousings.instanceMatrix.needsUpdate = true;
    this.tubes.instanceMatrix.needsUpdate = true;

    // Индикатор выхода и генератора
    this.exitLight = new THREE.PointLight(COLORS.emergency, 6, 12, 1.8);
    this.scene.add(this.exitLight);
    this.genLight = new THREE.PointLight(0x66ccff, 0, 14, 1.8);
    this.scene.add(this.genLight);
  }

  // ----------------------------------------------------------------- декор
  _buildProps() {
    const { tex } = this;
    const rnd = this.rnd;
    const crateMat = new THREE.MeshStandardMaterial({ map: tex.wall, color: 0x6b543c, roughness: 0.92 });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5c2b1e, roughness: 0.72, metalness: 0.45 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.7 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95 });

    this.props = new THREE.Group();
    this.scene.add(this.props);

    for (const prop of this.level.props) {
      const p = cellToWorld(prop.x, prop.z);
      const x = p.x + (prop.ox || 0);
      const z = p.z + (prop.oz || 0);
      if (prop.type === 'crate') {
        const h = 0.7 + rnd() * 0.6;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 1.0), crateMat);
        mesh.position.set(x, h / 2, z);
        mesh.rotation.y = prop.rot;
        mesh.castShadow = mesh.receiveShadow = true;
        this.props.add(mesh);
        if (rnd() < 0.4) {
          const small = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), crateMat);
          small.position.set(x + 0.15, h + 0.25, z - 0.1);
          small.rotation.y = prop.rot + 0.6;
          small.castShadow = true;
          this.props.add(small);
        }
      } else if (prop.type === 'barrel') {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12), barrelMat);
        mesh.position.set(x, 0.55, z);
        mesh.rotation.y = prop.rot;
        mesh.castShadow = mesh.receiveShadow = true;
        this.props.add(mesh);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.03, 6, 14), metalMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(x, 0.35, z);
        this.props.add(ring);
      } else if (prop.type === 'pipe') {
        const len = 1.4 + rnd() * 1.4;
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 8), metalMat);
        mesh.position.set(x, 0.12, z);
        mesh.rotation.z = Math.PI / 2;
        mesh.rotation.y = prop.rot;
        mesh.castShadow = true;
        this.props.add(mesh);
      } else if (prop.type === 'body') {
        const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 3, 6), bodyMat);
        mesh.position.set(x, 0.32, z);
        mesh.rotation.z = Math.PI / 2.1;
        mesh.rotation.y = prop.rot;
        mesh.castShadow = true;
        this.props.add(mesh);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), bodyMat);
        head.position.set(x + Math.cos(prop.rot) * 0.8, 0.25, z + Math.sin(prop.rot) * 0.8);
        this.props.add(head);
        const decal = new THREE.Mesh(
          new THREE.PlaneGeometry(1.8, 1.8),
          new THREE.MeshBasicMaterial({ map: tex.blood, transparent: true, opacity: 0.85, depthWrite: false })
        );
        decal.rotation.x = -Math.PI / 2;
        decal.position.set(x, 0.03, z);
        this.props.add(decal);
      } else {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 1.6), metalMat);
        mesh.position.set(x, 0.02, z);
        mesh.receiveShadow = true;
        this.props.add(mesh);
      }
    }
  }

  _buildDecals() {
    const rnd = this.rnd;
    const group = new THREE.Group();
    this.scene.add(group);
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex.blood,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    for (let i = 0; i < 46; i++) {
      const x = 1 + Math.floor(rnd() * (this.level.size - 2));
      const z = 1 + Math.floor(rnd() * (this.level.size - 2));
      if (this.grid.isSolid(x, z)) continue;
      const p = cellToWorld(x, z);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 + rnd() * 3.5, 2 + rnd() * 3.5), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rnd() * Math.PI * 2;
      mesh.position.set(p.x + (rnd() - 0.5) * 2, 0.02, p.z + (rnd() - 0.5) * 2);
      group.add(mesh);
    }
  }

  // --------------------------------------------------------------- предметы
  _makeGlowSprite(color, scale = 1.4, opacity = 0.75) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex.glow,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sprite.scale.set(scale, scale, 1);
    return sprite;
  }

  _buildItems() {
    const add = (item) => {
      this.items.push(item);
      this.pickups.set(item.id, item);
      this.scene.add(item.group);
    };

    // Предохранители
    this.level.fuses.forEach((cell, i) => {
      const p = cellToWorld(cell.x, cell.z);
      const group = new THREE.Group();
      group.position.set(p.x + (this.rnd() - 0.5) * 0.9, 0.55, p.z + (this.rnd() - 0.5) * 0.9);
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.42, 12),
        new THREE.MeshStandardMaterial({
          color: 0xffcf7a,
          emissive: 0xff8a00,
          emissiveIntensity: 1.6,
          roughness: 0.4,
          metalness: 0.3,
        })
      );
      group.add(body);
      const glow = this._makeGlowSprite(0xffa030, 2.2, 0.8);
      group.add(glow);
      add({ id: `fuse_${i}`, type: 'fuse', index: i, group, cell, taken: false, baseY: 0.55, bob: this.rnd() * 7, glow });
    });

    // Записки
    this.level.notes.forEach((cell, i) => {
      const p = cellToWorld(cell.x, cell.z);
      const group = new THREE.Group();
      group.position.set(p.x + (this.rnd() - 0.5) * 1.2, 0.42, p.z + (this.rnd() - 0.5) * 1.2);
      const paper = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.46),
        new THREE.MeshStandardMaterial({ color: 0xd9d2bf, emissive: 0x2a2418, roughness: 0.9, side: THREE.DoubleSide })
      );
      paper.rotation.x = -Math.PI / 2.4;
      paper.rotation.z = this.rnd() * Math.PI;
      group.add(paper);
      const glow = this._makeGlowSprite(0x88bbff, 0.9, 0.35);
      group.add(glow);
      add({ id: `note_${i}`, type: 'note', index: i, group, cell, taken: false, baseY: 0.42, bob: this.rnd() * 7, glow });
    });

    // Батарейки
    this.level.batteries.forEach((cell, i) => {
      const p = cellToWorld(cell.x, cell.z);
      const group = new THREE.Group();
      group.position.set(p.x + (this.rnd() - 0.5) * 1.4, 0.2, p.z + (this.rnd() - 0.5) * 1.4);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.32, 0.16),
        new THREE.MeshStandardMaterial({
          color: 0xf0d24a,
          emissive: 0x8a6a00,
          emissiveIntensity: 0.9,
          roughness: 0.5,
          metalness: 0.4,
        })
      );
      group.add(body);
      const glow = this._makeGlowSprite(0xffe066, 1.0, 0.45);
      group.add(glow);
      add({ id: `battery_${i}`, type: 'battery', index: i, group, cell, taken: false, baseY: 0.2, bob: 0, glow });
    });

    // Аптечки
    this.level.medkits.forEach((cell, i) => {
      const p = cellToWorld(cell.x, cell.z);
      const group = new THREE.Group();
      group.position.set(p.x + (this.rnd() - 0.5) * 1.3, 0.16, p.z + (this.rnd() - 0.5) * 1.3);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.3, 0.3),
        new THREE.MeshStandardMaterial({ map: this.tex.medkit, roughness: 0.7 })
      );
      group.add(body);
      const glow = this._makeGlowSprite(0x88ff99, 0.8, 0.3);
      group.add(glow);
      add({ id: `medkit_${i}`, type: 'medkit', index: i, group, cell, taken: false, baseY: 0.16, bob: 0, glow });
    });
  }

  _buildLockers() {
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2c3a33, roughness: 0.7, metalness: 0.55 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b2220, roughness: 0.8, metalness: 0.5 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x8b8b7a, metalness: 0.9, roughness: 0.35 });

    this.level.lockers.forEach((locker, i) => {
      const p = cellToWorld(locker.x, locker.z);
      const group = new THREE.Group();
      // Шкаф стоит вплотную к стене; нормаль стены = (locker.dx, locker.dz)
      const wallX = p.x + locker.dx * (CELL / 2 - 0.35);
      const wallZ = p.z + locker.dz * (CELL / 2 - 0.35);
      group.position.set(wallX, 0, wallZ);
      group.rotation.y = Math.atan2(-locker.dx, -locker.dz);

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.25, 0.6), frameMat);
      body.position.y = 1.12;
      body.castShadow = body.receiveShadow = true;
      group.add(body);

      const door = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.1, 0.05), doorMat);
      door.position.set(0, 1.12, 0.32);
      group.add(door);

      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), handleMat);
      handle.position.set(0.35, 1.2, 0.37);
      group.add(handle);

      for (let v = 0; v < 4; v++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.02), frameMat);
        slot.position.set(0, 1.55 + v * 0.15, 0.35);
        group.add(slot);
      }

      this.scene.add(group);
      this.lockers.push({
        id: i,
        group,
        pos: new THREE.Vector3(wallX, 0, wallZ),
        front: new THREE.Vector3(
          wallX - locker.dx * 0.95,
          0,
          wallZ - locker.dz * 0.95
        ),
        door,
        occupied: false,
        // взгляд наружу от стены
        yaw: Math.atan2(locker.dx, locker.dz),
      });
    });
  }

  _buildGenerator() {
    const p = cellToWorld(this.level.generator.x, this.level.generator.z);
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.rotation.y = Math.PI / 2;

    const metal = new THREE.MeshStandardMaterial({ color: 0x2f3a3a, roughness: 0.55, metalness: 0.8 });
    const warnMat = new THREE.MeshStandardMaterial({ map: this.tex.warning, roughness: 0.8 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 1.5), metal);
    base.position.y = 0.5;
    base.castShadow = base.receiveShadow = true;
    group.add(base);

    const top = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.35, 1.7), warnMat);
    top.position.y = 1.15;
    top.castShadow = true;
    group.add(top);

    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 10), metal);
    pipe.position.set(-1.2, 1.9, 0);
    group.add(pipe);

    // Гнёзда предохранителей
    this.sockets = [];
    for (let i = 0; i < OBJECTIVE.fusesNeeded; i++) {
      const socket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.26, 10),
        new THREE.MeshStandardMaterial({
          color: 0x1a1d1e,
          emissive: 0x001100,
          emissiveIntensity: 1,
          roughness: 0.5,
          metalness: 0.6,
        })
      );
      socket.rotation.x = Math.PI / 2;
      socket.position.set(-0.9 + i * 0.45, 0.85, 0.8);
      group.add(socket);
      this.sockets.push(socket);
    }

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.45, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x11181a, emissive: 0x110000, emissiveIntensity: 1, roughness: 0.4 })
    );
    panel.position.set(1.0, 1.05, 0.85);
    group.add(panel);
    this.genPanel = panel;

    this.scene.add(group);
    this.generator = {
      group,
      pos: new THREE.Vector3(p.x, 0, p.z),
      front: new THREE.Vector3(p.x, 0, p.z + 2.2),
    };
    this.genLight.position.set(p.x, 1.8, p.z);
  }

  _buildExit() {
    const level = this.level;
    const p = cellToWorld(level.exit.x, level.exit.z);
    // Направление к коридору — открытый сосед.
    const neighbour = this.grid.neighbors(level.exit.x, level.exit.z)[0] || [level.exit.x, level.exit.z - 1];
    const dir = { x: Math.sign(neighbour[0] - level.exit.x), z: Math.sign(neighbour[1] - level.exit.z) };
    const facing = Math.atan2(dir.x, dir.z);

    const group = new THREE.Group();
    group.position.set(p.x - dir.x * 1.2, 0, p.z - dir.z * 1.2);
    group.rotation.y = facing;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 0.5, metalness: 0.85 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x37403f, roughness: 0.45, metalness: 0.8 });
    const warnMat = new THREE.MeshStandardMaterial({ map: this.tex.warning, roughness: 0.7 });

    const left = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 1.2), frameMat);
    left.position.set(-1.7, 1.6, 0);
    left.castShadow = left.receiveShadow = true;
    group.add(left);
    const right = left.clone();
    right.position.x = 1.7;
    group.add(right);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.45, 1.2), warnMat);
    beam.position.set(0, 3.35, 0);
    group.add(beam);

    this.doorPanel = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.9, 0.22), doorMat);
    this.doorPanel.position.set(0, 1.45, 0);
    this.doorPanel.castShadow = this.doorPanel.receiveShadow = true;
    group.add(this.doorPanel);
    this.doorBaseY = 1.45;

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 0.02), warnMat);
    stripe.position.set(0, 0.5, 0.13);
    group.add(stripe);

    this.exitSignMat = new THREE.MeshBasicMaterial({ color: 0x5a0d08 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.42), this.exitSignMat);
    sign.position.set(0, 3.05, 0.62);
    group.add(sign);

    this.scene.add(group);
    this.exitLight.position.set(p.x, 2.8, p.z);
    this.exit = {
      group,
      pos: new THREE.Vector3(p.x, 0, p.z),
      front: new THREE.Vector3(p.x + dir.x * 1.6, 0, p.z + dir.z * 1.6),
      yaw: facing,
    };
  }

  _buildDust() {
    const count = 1400;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 44;
      positions[i * 3 + 1] = Math.random() * MAZE.wallHeight;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 44;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.045,
      map: this.tex.glow,
      color: 0xb9c6d6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  // ------------------------------------------------------------- интерфейс
  setPowered(on) {
    this.powered = on;
    this.genLight.intensity = on ? 22 : 0;
    this.genPanel.material.emissive.setHex(on ? 0x1a6b3a : 0x220000);
    this.genPanel.material.emissiveIntensity = on ? 1.6 : 0.7;
    this.exitSignMat.color.setHex(on ? 0x1fbb55 : 0x5a0d08);
  }

  setDoorOpen(open, dt) {
    this.exitOpen = open;
    const target = open ? this.doorBaseY + 2.95 : this.doorBaseY;
    this.doorPanel.position.y += (target - this.doorPanel.position.y) * Math.min(1, dt * 2.2);
  }

  setFusesInstalled(count) {
    this.sockets.forEach((socket, i) => {
      const on = i < count;
      socket.material.emissive.setHex(on ? 0x33ff88 : 0x001100);
      socket.material.emissiveIntensity = on ? 1.8 : 0.4;
    });
  }

  takeItem(id) {
    const item = this.pickups.get(id);
    if (!item || item.taken) return null;
    item.taken = true;
    item.group.visible = false;
    return item;
  }

  restoreItem(id) {
    const item = this.pickups.get(id);
    if (!item) return;
    item.taken = false;
    item.group.visible = true;
  }

  nearestItem(pos, range) {
    let best = null;
    let bestD = range;
    for (const item of this.items) {
      if (item.taken) continue;
      const d = Math.hypot(item.group.position.x - pos.x, item.group.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }

  nearestLocker(pos, range) {
    let best = null;
    let bestD = range;
    for (const locker of this.lockers) {
      if (locker.occupied) continue;
      const d = Math.hypot(locker.front.x - pos.x, locker.front.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = locker;
      }
    }
    return best;
  }

  update(dt, camera, headPos, elapsed, camDir) {
    this.time += dt;

    // Фонарь
    if (camera) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      this.flashlight.position.copy(camera.position);
      this.flashlightTarget.position.copy(camera.position).add(dir.multiplyScalar(12));
      this.flashlightFill.position.copy(camera.position);
    }

    // Мерцание ламп + выбор ближайших источников
    const candidates = [];
    for (const lamp of this.lamps) {
      if (lamp.broken) continue;
      const d = lamp.pos.distanceTo(headPos);
      if (d < 30) candidates.push({ lamp, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    const active = candidates.slice(0, this.lampLights.length);
    for (let i = 0; i < this.lampLights.length; i++) {
      const light = this.lampLights[i];
      const entry = active[i];
      if (!entry) {
        light.intensity = 0;
        continue;
      }
      const lamp = entry.lamp;
      let f = 1;
      if (lamp.flicker) {
        const t = this.time * (3 + (lamp.index % 5)) + lamp.phase;
        f = Math.sin(t) * Math.sin(t * 2.7) > 0.1 ? 1 : 0.12 + 0.1 * Math.sin(t * 11);
      } else {
        f = 0.9 + 0.1 * Math.sin(this.time * 2 + lamp.phase);
      }
      light.position.copy(lamp.pos);
      light.color.copy(lamp.color);
      light.intensity = (lamp.cold ? 9 : 15) * f;
      const col = new THREE.Color(lamp.color).multiplyScalar(0.25 + f * 0.8);
      this.tubes.setColorAt(lamp.index, col);
    }
    // Погасшие/битые лампы
    for (const lamp of this.lamps) {
      if (lamp.broken) this.tubes.setColorAt(lamp.index, new THREE.Color(0x090b0d));
    }
    if (this.tubes.instanceColor) this.tubes.instanceColor.needsUpdate = true;

    // Пыль вокруг игрока
    if (this.dust) {
      const posAttr = this.dust.geometry.attributes.position;
      const arr = posAttr.array;
      const px = headPos.x;
      const pz = headPos.z;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += Math.sin(this.time * 0.6 + i) * 0.0012 + 0.0025;
        if (arr[i + 1] > MAZE.wallHeight) arr[i + 1] = 0.1;
        if (arr[i] - px > 22) arr[i] -= 44;
        else if (arr[i] - px < -22) arr[i] += 44;
        if (arr[i + 2] - pz > 22) arr[i + 2] -= 44;
        else if (arr[i + 2] - pz < -22) arr[i + 2] += 44;
      }
      posAttr.needsUpdate = true;
    }

    // Покачивание предметов + пульсация
    for (const item of this.items) {
      if (item.taken || !item.bob) continue;
      const t = elapsed * 1.6 + item.bob;
      item.group.position.y = item.baseY + Math.sin(t) * 0.08;
      item.group.rotation.y += dt * 0.6;
      if (item.glow) {
        const s = 1 + Math.sin(t * 2.2) * 0.18;
        item.glow.scale.set(s * (item.type === 'fuse' ? 2.2 : 1.0), s * (item.type === 'fuse' ? 2.2 : 1.0), 1);
      }
    }

    // Мигание индикатора выхода
    if (this.exitSignMat) {
      const pulse = this.exitOpen ? 1 : 0.45 + 0.25 * Math.sin(this.time * 3);
      this.exitSignMat.color.multiplyScalar(1).lerp(
        new THREE.Color(this.exitOpen ? 0x2aff77 : 0x8a1208),
        Math.min(1, dt * 4)
      );
      this.exitLight.intensity = (this.exitOpen ? 9 : 3.5) * (0.6 + pulse * 0.6);
    }
    this.setDoorOpen(this.exitOpen, dt);
  }
}
