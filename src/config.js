// ОБЪЕКТ 12 — конфигурация мира, игрока и сетевого слоя.

export const NET = {
  // Публичный релей, через который идёт кооп по сети.
  remote: 'wss://sandbank-economic-zeppelin.ngrok-free.dev',
  // Локальный релей (тот же сервер, что раздаёт игру) — резервный канал.
  localPath: '/ws',
  roomFromUrl: true,
  pingInterval: 2000,
  stateRate: 14, // пакетов позиции в секунду
  monsterRate: 12,
  reconnectDelay: 2500,
};

export const MAZE = {
  size: 41, // нечётное
  cell: 4.0,
  wallHeight: 3.7,
  braid: 0.34, // доля тупиков, которые прорубаются в петли
};

export const PLAYER = {
  radius: 0.42,
  eyeHeight: 1.68,
  crouchEye: 1.02,
  walkSpeed: 2.95,
  runSpeed: 5.25,
  crouchSpeed: 1.45,
  accel: 26,
  friction: 16,
  staminaMax: 100,
  staminaDrain: 15,
  staminaRegen: 8.5,
  staminaDelay: 0.9,
  healthMax: 100,
  batteryMax: 100,
  batteryDrain: 0.25, // %/сек — 100% ≈ 250 секунд света
  interactRange: 2.7,
  reviveTime: 4.0,
  bleedOut: 75,
};

export const MONSTER = {
  patrolSpeed: 2.05,
  investigateSpeed: 2.85,
  chaseSpeed: 4.4,
  attackRange: 2.0,
  attackDamage: 42,
  attackCooldown: 1.7,
  sightRange: 15,
  sightRangeLit: 26,
  sightFov: 0.62, // cos угла полуконуса (~52°)
  hearSprint: 19,
  hearWalk: 10.5,
  hearCrouch: 4.5,
  loseInterest: 9,
  grace: 28,
  speedRampPerMin: 0.035,
  speedRampCap: 0.5,
};

export const OBJECTIVE = {
  fusesNeeded: 5, // сколько нужно вставить в генератор
  fusesPlaced: 8, // сколько разбросано по бункеру (запас на случай потерь)
  notes: 6,
  batteries: 11,
  medkits: 5,
  lockers: 9,
};

export const COLORS = {
  fog: 0x05070a,
  ambient: 0x0b1017,
  lamp: 0xffd9a0,
  lampCold: 0x9fd6ff,
  emergency: 0xff2a1a,
  flashlight: 0xfff2d0,
  monsterEye: 0xff1e10,
};
