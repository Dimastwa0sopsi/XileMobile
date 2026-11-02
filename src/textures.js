// Процедурные текстуры (без внешних ассетов — всё рисуется в canvas).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}

function finish(c, repeat = 1, colorSpace = THREE.SRGBColorSpace) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = colorSpace;
  tex.anisotropy = 4;
  return tex;
}

function grime(ctx, size, rnd, amount = 600) {
  for (let i = 0; i < amount; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.4 + rnd() * 3;
    const a = rnd() * 0.16;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(150,140,120,${a * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cracks(ctx, size, rnd, count = 14) {
  ctx.strokeStyle = 'rgba(12,12,14,0.55)';
  for (let i = 0; i < count; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    ctx.lineWidth = 0.6 + rnd();
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 5 + Math.floor(rnd() * 8);
    for (let s = 0; s < steps; s++) {
      x += (rnd() - 0.5) * 34;
      y += (rnd() - 0.5) * 34;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

let cache = null;

export function getTextures() {
  if (cache) return cache;
  const rnd = mulberry32(9331);

  // Бетон стен
  {
    const { c, ctx } = canvas(256);
    ctx.fillStyle = '#565049';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) {
      const x = rnd() * 256;
      const y = rnd() * 256;
      const w = 20 + rnd() * 90;
      const h = 12 + rnd() * 70;
      const shade = 60 + Math.floor(rnd() * 34);
      ctx.fillStyle = `rgba(${shade},${shade - 4},${shade - 9},0.22)`;
      ctx.fillRect(x, y, w, h);
    }
    grime(ctx, 256, rnd, 1100);
    cracks(ctx, 256, rnd, 18);
    // потёки
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256;
      const w = 1 + rnd() * 5;
      const h = 30 + rnd() * 160;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(20,18,15,0.35)');
      g.addColorStop(1, 'rgba(20,18,15,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, rnd() * 100, w, h);
    }
    cache = { ...(cache || {}) };
    cache.wall = finish(c, 1);
    cache.wall.anisotropy = 8;
  }

  // Пол — металлические плиты
  {
    const { c, ctx } = canvas(256);
    ctx.fillStyle = '#3b3d3f';
    ctx.fillRect(0, 0, 256, 256);
    const tile = 128;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        ctx.fillStyle = (tx + ty) % 2 ? '#33363a' : '#3f4245';
        ctx.fillRect(tx * tile + 3, ty * tile + 3, tile - 6, tile - 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tx * tile + 3, ty * tile + 3, tile - 6, tile - 6);
        // заклёпки
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = 'rgba(120,120,125,0.35)';
          ctx.beginPath();
          ctx.arc(tx * tile + 12 + rnd() * (tile - 24), ty * tile + 12 + rnd() * (tile - 24), 2, 0, 7);
          ctx.fill();
        }
      }
    }
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = `rgba(70,45,30,${0.05 + rnd() * 0.16})`;
      ctx.beginPath();
      ctx.arc(rnd() * 256, rnd() * 256, 4 + rnd() * 26, 0, 7);
      ctx.fill();
    }
    grime(ctx, 256, rnd, 700);
    cache = { ...(cache || {}) };
    cache.floor = finish(c, 1);
  }

  // Потолок
  {
    const { c, ctx } = canvas(128);
    ctx.fillStyle = '#232628';
    ctx.fillRect(0, 0, 128, 128);
    grime(ctx, 128, rnd, 500);
    cracks(ctx, 128, rnd, 8);
    cache.ceiling = finish(c, 1);
  }

  // Кровь
  {
    const { c, ctx } = canvas(128);
    ctx.clearRect(0, 0, 128, 128);
    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 44);
    grad.addColorStop(0, 'rgba(88,6,8,0.95)');
    grad.addColorStop(0.6, 'rgba(64,4,6,0.72)');
    grad.addColorStop(1, 'rgba(40,2,3,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, 7);
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 18 + rnd() * 40;
      ctx.fillStyle = `rgba(${60 + rnd() * 40},4,6,${0.3 + rnd() * 0.5})`;
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.8 + rnd() * 4.5, 0, 7);
      ctx.fill();
    }
    cache.blood = finish(c, 1);
    cache.blood.wrapS = cache.blood.wrapT = THREE.ClampToEdgeWrapping;
  }

  // Аптечка
  {
    const { c, ctx } = canvas(128);
    ctx.fillStyle = '#cfd2cf';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#b02a20';
    ctx.fillRect(52, 24, 24, 80);
    ctx.fillRect(24, 52, 80, 24);
    ctx.strokeStyle = 'rgba(30,30,30,0.6)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
    cache.medkit = finish(c, 1);
  }

  // Предупреждающие полосы
  {
    const { c, ctx } = canvas(128);
    ctx.fillStyle = '#c9a327';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#171717';
    for (let i = -8; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 20, 0);
      ctx.lineTo(i * 20 + 10, 0);
      ctx.lineTo(i * 20 + 10 + 40, 128);
      ctx.lineTo(i * 20 + 40, 128);
      ctx.closePath();
      ctx.fill();
    }
    grime(ctx, 128, rnd, 260);
    cache.warning = finish(c, 1);
  }

  // Мягкое пятно для света/частиц
  {
    const { c, ctx } = canvas(64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    cache.glow = finish(c, 1);
    cache.glow.wrapS = cache.glow.wrapT = THREE.ClampToEdgeWrapping;
  }

  return cache;
}
