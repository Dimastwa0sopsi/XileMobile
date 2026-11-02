// Генерация планировки бункера и навигация по сетке.
import { MAZE, OBJECTIVE } from './config.js';
import { mulberry32, shuffle, hashString } from './util.js';

export const key = (x, z, size = MAZE.size) => z * size + x;

export function cellToWorld(cx, cz, size = MAZE.size, cell = MAZE.cell) {
  return { x: (cx - (size - 1) / 2) * cell, z: (cz - (size - 1) / 2) * cell };
}

export function worldToCell(x, z, size = MAZE.size, cell = MAZE.cell) {
  return {
    x: Math.round(x / cell + (size - 1) / 2),
    z: Math.round(z / cell + (size - 1) / 2),
  };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class Grid {
  constructor(size, cell, solid) {
    this.size = size;
    this.cell = cell;
    this.solid = solid;
  }

  isSolid(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return true;
    return this.solid[key(cx, cz, this.size)] === 1;
  }

  isOpen(cx, cz) {
    return !this.isSolid(cx, cz);
  }

  isSolidWorld(x, z) {
    const c = worldToCell(x, z, this.size, this.cell);
    return this.isSolid(c.x, c.z);
  }

  // Разрешение столкновений по одной оси (квадратный "коллайдер" игрока).
  _resolveAxis(pos, radius, axis) {
    const cell = this.cell;
    const half = (this.size - 1) / 2;
    const cxMin = Math.floor((pos.x - radius) / cell + half);
    const cxMax = Math.floor((pos.x + radius) / cell + half);
    const czMin = Math.floor((pos.z - radius) / cell + half);
    const czMax = Math.floor((pos.z + radius) / cell + half);
    for (let cz = czMin; cz <= czMax; cz++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        if (!this.isSolid(cx, cz)) continue;
        const centerX = (cx - half) * cell;
        const centerZ = (cz - half) * cell;
        const minX = centerX - cell / 2;
        const maxX = centerX + cell / 2;
        const minZ = centerZ - cell / 2;
        const maxZ = centerZ + cell / 2;
        const overlapX = pos.x + radius > minX && pos.x - radius < maxX;
        const overlapZ = pos.z + radius > minZ && pos.z - radius < maxZ;
        if (!overlapX || !overlapZ) continue;
        if (axis === 'x') {
          if (pos.x < centerX) pos.x = minX - radius;
          else pos.x = maxX + radius;
        } else {
          if (pos.z < centerZ) pos.z = minZ - radius;
          else pos.z = maxZ + radius;
        }
      }
    }
  }

  move(pos, dx, dz, radius) {
    if (dx) {
      pos.x += dx;
      this._resolveAxis(pos, radius, 'x');
    }
    if (dz) {
      pos.z += dz;
      this._resolveAxis(pos, radius, 'z');
    }
    return pos;
  }

  // Есть ли прямая видимость между двумя точками мира.
  lineOfSight(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const step = this.cell * 0.28;
    const n = Math.ceil(dist / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.isSolidWorld(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  neighbors(cx, cz) {
    const out = [];
    for (const [dx, dz] of DIRS) {
      if (this.isOpen(cx + dx, cz + dz)) out.push([cx + dx, cz + dz]);
    }
    return out;
  }

  degree(cx, cz) {
    return this.neighbors(cx, cz).length;
  }

  // BFS-волна расстояний от клетки. Возвращает Int32Array (в шагах, -1 недостижимо).
  distanceField(cx, cz) {
    const n = this.size * this.size;
    const dist = new Int32Array(n).fill(-1);
    if (this.isSolid(cx, cz)) return dist;
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    dist[key(cx, cz, this.size)] = 0;
    queue[tail++] = key(cx, cz, this.size);
    while (head < tail) {
      const cur = queue[head++];
      const x = cur % this.size;
      const z = (cur / this.size) | 0;
      const d = dist[cur];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (this.isSolid(nx, nz)) continue;
        const k = key(nx, nz, this.size);
        if (dist[k] !== -1) continue;
        dist[k] = d + 1;
        queue[tail++] = k;
      }
    }
    return dist;
  }

  // Путь по клеткам от (sx,sz) до (tx,tz), включая целевую, без стартовой.
  findPath(sx, sz, tx, tz) {
    if (this.isSolid(tx, tz) || this.isSolid(sx, sz)) return null;
    if (sx === tx && sz === tz) return [];
    const n = this.size * this.size;
    const prev = new Int32Array(n).fill(-2);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const start = key(sx, sz, this.size);
    const goal = key(tx, tz, this.size);
    prev[start] = -1;
    queue[tail++] = start;
    let found = false;
    while (head < tail) {
      const cur = queue[head++];
      if (cur === goal) { found = true; break; }
      const x = cur % this.size;
      const z = (cur / this.size) | 0;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (this.isSolid(nx, nz)) continue;
        const k = key(nx, nz, this.size);
        if (prev[k] !== -2) continue;
        prev[k] = cur;
        queue[tail++] = k;
      }
    }
    if (!found) return null;
    const path = [];
    let cur = goal;
    while (cur !== start && cur !== -1) {
      path.push({ x: cur % this.size, z: (cur / this.size) | 0 });
      cur = prev[cur];
    }
    path.reverse();
    return path;
  }

  // Соседняя открытая клетка, ближайшая к точке (для "застрявших" позиций).
  nearestOpen(x, z) {
    const c = worldToCell(x, z, this.size, this.cell);
    if (this.isOpen(c.x, c.z)) return c;
    for (let r = 1; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (this.isOpen(c.x + dx, c.z + dz)) return { x: c.x + dx, z: c.z + dz };
        }
      }
    }
    return { x: 1, z: 1 };
  }
}

function carveRoom(solid, cx, cz, radius, size) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x <= 0 || z <= 0 || x >= size - 1 || z >= size - 1) continue;
      solid[key(x, z, size)] = 0;
    }
  }
}

export function generateLevel(seedStr) {
  const seed = hashString(String(seedStr));
  const rnd = mulberry32(seed);
  const size = MAZE.size;
  const solid = new Uint8Array(size * size).fill(1);

  // 1. Лабиринт «рекурсивный откат» по нечётным узлам.
  const startNode = { x: 1, z: 1 };
  solid[key(startNode.x, startNode.z, size)] = 0;
  const stack = [[startNode.x, startNode.z]];
  const visited = new Set([key(startNode.x, startNode.z, size)]);
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], rnd);
    let advanced = false;
    for (const [dx, dz] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx <= 0 || nz <= 0 || nx >= size - 1 || nz >= size - 1) continue;
      if (visited.has(key(nx, nz, size))) continue;
      solid[key(cx + dx / 2, cz + dz / 2, size)] = 0;
      solid[key(nx, nz, size)] = 0;
      visited.add(key(nx, nz, size));
      stack.push([nx, nz]);
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }

  // 2. Петли: часть тупиков прорубаем, чтобы можно было убегать по кругу.
  for (let z = 1; z < size - 1; z += 2) {
    for (let x = 1; x < size - 1; x += 2) {
      if (solid[key(x, z, size)] !== 0) continue;
      let deg = 0;
      for (const [dx, dz] of DIRS) {
        if (solid[key(x + dx, z + dz, size)] === 0) deg++;
      }
      if (deg > 1 || rnd() > MAZE.braid) continue;
      const options = [];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx * 2;
        const nz = z + dz * 2;
        if (nx <= 0 || nz <= 0 || nx >= size - 1 || nz >= size - 1) continue;
        if (solid[key(nx, nz, size)] !== 0) continue;
        if (solid[key(x + dx, z + dz, size)] !== 1) continue;
        options.push([dx, dz]);
      }
      if (!options.length) continue;
      const [dx, dz] = options[Math.floor(rnd() * options.length)];
      solid[key(x + dx, z + dz, size)] = 0;
    }
  }

  // 3. Залы: один большой технический + несколько боковых.
  const rooms = [];
  const roomAttempts = 40;
  const bigRoom = { x: 0, z: 0 };
  for (let i = 0; i < roomAttempts && rooms.length < 5; i++) {
    const cx = 5 + 2 * Math.floor(rnd() * ((size - 11) / 2));
    const cz = 5 + 2 * Math.floor(rnd() * ((size - 11) / 2));
    if (solid[key(cx, cz, size)] !== 0) continue;
    if (rooms.some((r) => Math.hypot(r.x - cx, r.z - cz) < 10)) continue;
    const radius = rooms.length === 0 ? 3 : 2;
    carveRoom(solid, cx, cz, radius, size);
    const room = { x: cx, z: cz, radius };
    rooms.push(room);
    if (rooms.length === 1) { bigRoom.x = cx; bigRoom.z = cz; }
  }

  // 4. Старт — в углу, генератор — в большом зале, выход — самый дальний тупик.
  const grid = new Grid(size, MAZE.cell, solid);
  const distFromStart = grid.distanceField(startNode.x, startNode.z);

  let exitCell = startNode;
  let bestDist = -1;
  const deadEnds = [];
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid.isSolid(x, z)) continue;
      const d = distFromStart[key(x, z, size)];
      if (d < 0) continue;
      const deg = grid.degree(x, z);
      if (deg === 1) deadEnds.push({ x, z, d, deg });
      if (d > bestDist && Math.hypot(x - bigRoom.x, z - bigRoom.z) > 6) {
        bestDist = d;
        exitCell = { x, z };
      }
    }
  }
  if (exitCell === startNode) {
    exitCell = deadEnds.sort((a, b) => b.d - a.d)[0] || { x: size - 3, z: size - 3 };
  }

  const generator = grid.isOpen(bigRoom.x, bigRoom.z)
    ? { x: bigRoom.x, z: bigRoom.z }
    : grid.nearestOpen(cellToWorld(bigRoom.x, bigRoom.z).x, cellToWorld(bigRoom.x, bigRoom.z).z);

  const occupied = new Set();
  const reserve = (c) => occupied.add(key(c.x, c.z, size));
  const isFree = (c, minSep) => {
    if (occupied.has(key(c.x, c.z, size))) return false;
    if (minSep <= 0) return true;
    for (const k of occupied) {
      const ox = k % size;
      const oz = (k / size) | 0;
      if (Math.hypot(ox - c.x, oz - c.z) < minSep) return false;
    }
    return true;
  };

  reserve(startNode);
  reserve(exitCell);
  reserve(generator);
  // Вокруг старта и генератора оставляем свободную зону.
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (grid.isOpen(startNode.x + dx, startNode.z + dz)) {
        occupied.add(key(startNode.x + dx, startNode.z + dz, size));
      }
    }
  }

  const openCells = [];
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid.isSolid(x, z)) continue;
      const d = distFromStart[key(x, z, size)];
      if (d < 0) continue;
      openCells.push({ x, z, d });
    }
  }

  const maxDist = openCells.reduce((m, c) => Math.max(m, c.d), 0);
  const farCells = openCells.filter((c) => c.d > maxDist * 0.28);

  const pick = (count, pool, minSep, prefDeadEnd) => {
    const result = [];
    const candidates = shuffle(pool.slice(), rnd);
    if (prefDeadEnd) {
      candidates.sort((a, b) => {
        const da = grid.degree(a.x, a.z) === 1 ? 0 : 1;
        const db = grid.degree(b.x, b.z) === 1 ? 0 : 1;
        return da - db;
      });
    }
    // Первый проход — со строгим интервалом, второй — мягче.
    for (const pass of [minSep, Math.max(3, minSep * 0.5), 0]) {
      for (const c of candidates) {
        if (result.length >= count) break;
        if (!isFree(c, pass)) continue;
        result.push(c);
        reserve(c);
      }
    }
    return result;
  };

  const fuses = pick(OBJECTIVE.fusesPlaced, farCells, 9, true);
  const notes = pick(OBJECTIVE.notes, openCells.filter((c) => c.d > 6), 7, true);
  const batteries = pick(OBJECTIVE.batteries, openCells.filter((c) => c.d > 3), 5, false);
  const medkits = pick(OBJECTIVE.medkits, openCells.filter((c) => c.d > 5), 8, false);

  // Шкафы — у стен, в которые можно спрятаться.
  const lockers = [];
  const lockerCandidates = shuffle(openCells.filter((c) => c.d > 4), rnd);
  for (const c of lockerCandidates) {
    if (lockers.length >= OBJECTIVE.lockers) break;
    const spots = DIRS.filter(([dx, dz]) => grid.isSolid(c.x + dx, c.z + dz));
    if (!spots.length) continue;
    if (lockers.some((l) => Math.hypot(l.x - c.x, l.z - c.z) < 6)) continue;
    const [dx, dz] = spots[Math.floor(rnd() * spots.length)];
    lockers.push({ x: c.x, z: c.z, dx, dz });
  }

  // Лампы на потолке: редкая неровная сетка + залы.
  const lamps = [];
  const lampTaken = new Set();
  const addLamp = (x, z, cold = false) => {
    if (lamps.length > 90) return;
    if (lamps.some((l) => Math.abs(l.x - x) < 2 && Math.abs(l.z - z) < 2)) return;
    lamps.push({ x, z, cold });
  };
  for (const c of openCells) {
    if (rnd() < 0.05) addLamp(c.x, c.z);
  }
  for (const room of rooms) {
    for (const [dx, dz] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
      if (grid.isOpen(room.x + dx * room.radius, room.z + dz * room.radius)) {
        addLamp(room.x + dx * room.radius, room.z + dz * room.radius, room !== rooms[0]);
      }
    }
  }
  addLamp(generator.x, generator.z);

  // Мусор/декор на полу.
  const props = [];
  for (const c of shuffle(openCells.slice(), rnd)) {
    if (props.length > 90) break;
    if (Math.hypot(c.x - startNode.x, c.z - startNode.z) < 2) continue;
    if (c.x === generator.x && c.z === generator.z) continue;
    const roll = rnd();
    let type = null;
    if (roll < 0.34) type = 'crate';
    else if (roll < 0.6) type = 'barrel';
    else if (roll < 0.76) type = 'pipe';
    else if (roll < 0.88) type = 'body';
    else type = 'grate';
    if (type === 'crate' || type === 'barrel') {
      if (props.some((p) => p.x === c.x && p.z === c.z)) continue;
      // Не перекрываем проходы целиком: ставим у края клетки.
      const off = { x: (rnd() - 0.5) * 2.1, z: (rnd() - 0.5) * 2.1 };
      props.push({ ...c, type, ox: off.x, oz: off.z, rot: rnd() * Math.PI * 2 });
    } else {
      props.push({ ...c, type, ox: (rnd() - 0.5) * 1.4, oz: (rnd() - 0.5) * 1.4, rot: rnd() * Math.PI * 2 });
    }
  }

  return {
    seed,
    size,
    solid,
    grid,
    start: startNode,
    exit: exitCell,
    generator,
    rooms,
    fuses,
    notes,
    batteries,
    medkits,
    lockers,
    lamps,
    props,
    deadEnds,
    maxDist,
  };
}

export { DIRS };
