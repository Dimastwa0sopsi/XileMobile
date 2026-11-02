// Ввод: клавиатура + мышь (pointer lock) и сенсорное управление для телефона.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.joystick = { x: 0, y: 0 };
    this.pressed = new Set();
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 0.0022;
    this.touchSensitivity = 0.0042;
    this.isTouch = false;
    this.touchButtons = new Map(); // action -> bool
    this.buttons = new Map();
    this._setupKeyboard();
    this._setupMouse();
    this._setupTouch();
  }

  _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      if (['KeyE', 'KeyF', 'KeyM', 'KeyC', 'Enter', 'Escape', 'Tab', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) this.pressed.add(this._actionFor(e.code));
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  _actionFor(code) {
    switch (code) {
      case 'KeyE': return 'interact';
      case 'KeyF': return 'torch';
      case 'KeyM': case 'Tab': return 'map';
      case 'KeyC': case 'ControlLeft': return 'crouchToggle';
      case 'Enter': return 'chat';
      case 'Escape': return 'pause';
      case 'Space': return 'jump';
      default: return code;
    }
  }

  _setupMouse() {
    this.dragging = false;
    this.lastDrag = { x: 0, y: 0 };
    this.lockBlocked = false;

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.lockBlocked = false;
    });
    document.addEventListener('pointerlockerror', () => {
      // Например, iframe без разрешения pointer-lock — переходим на обзор «drag».
      this.lockBlocked = true;
      this.locked = false;
      this.emitLockError?.();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        this.lookDX += e.movementX * this.sensitivity;
        this.lookDY += e.movementY * this.sensitivity;
      } else if (this.dragging) {
        const dx = e.movementX || e.clientX - this.lastDrag.x;
        const dy = e.movementY || e.clientY - this.lastDrag.y;
        this.lastDrag.x = e.clientX;
        this.lastDrag.y = e.clientY;
        this.lookDX += dx * this.sensitivity * 1.35;
        this.lookDY += dy * this.sensitivity * 1.35;
      }
    });
    document.addEventListener('mouseup', () => { this.dragging = false; });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.isTouch || this.locked) return;
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastDrag.x = e.clientX;
      this.lastDrag.y = e.clientY;
      if (!this.lockBlocked) this.requestLock();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    if (this.isTouch || this.lockBlocked) return;
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockBlocked = true; });
    } catch (e) {
      this.lockBlocked = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _setupTouch() {
    const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.isTouch = touch;
    if (!touch) return;
    document.body.classList.add('is-touch');

    const state = { moveId: null, lookId: null, moveStart: { x: 0, y: 0 }, lookLast: { x: 0, y: 0 } };
    const stick = document.createElement('div');
    stick.className = 'touch-stick';
    stick.innerHTML = '<div class="touch-stick-knob"></div>';
    document.body.appendChild(stick);
    this.stickEl = stick;
    const knob = stick.querySelector('.touch-stick-knob');

    const onDown = (e) => {
      if (!this.enabled) return;
      if (e.target && e.target.closest && e.target.closest('.tbtn')) return;
      const isLeft = e.clientX < window.innerWidth * 0.45;
      if (isLeft && state.moveId === null) {
        state.moveId = e.pointerId;
        state.moveStart.x = e.clientX;
        state.moveStart.y = e.clientY;
        stick.style.left = `${e.clientX}px`;
        stick.style.top = `${e.clientY}px`;
        stick.classList.add('active');
        knob.style.transform = 'translate(-50%, -50%)';
      } else if (!isLeft && state.lookId === null) {
        state.lookId = e.pointerId;
        state.lookLast.x = e.clientX;
        state.lookLast.y = e.clientY;
      }
    };
    const onMove = (e) => {
      if (e.pointerId === state.moveId) {
        const dx = e.clientX - state.moveStart.x;
        const dy = e.clientY - state.moveStart.y;
        const max = 62;
        const len = Math.hypot(dx, dy) || 1;
        const clamped = Math.min(1, len / max);
        const nx = (dx / len) * clamped;
        const ny = (dy / len) * clamped;
        this.joystick.x = nx;
        this.joystick.y = ny;
        knob.style.transform = `translate(calc(-50% + ${nx * 42}px), calc(-50% + ${ny * 42}px))`;
      } else if (e.pointerId === state.lookId) {
        this.lookDX += (e.clientX - state.lookLast.x) * this.touchSensitivity;
        this.lookDY += (e.clientY - state.lookLast.y) * this.touchSensitivity;
        state.lookLast.x = e.clientX;
        state.lookLast.y = e.clientY;
      }
    };
    const onUp = (e) => {
      if (e.pointerId === state.moveId) {
        state.moveId = null;
        this.joystick.x = 0;
        this.joystick.y = 0;
        stick.classList.remove('active');
      }
      if (e.pointerId === state.lookId) state.lookId = null;
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
  }

  // Кнопки на экране (мобилки): удержание/нажатие.
  bindButton(el, action) {
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      this.touchButtons.set(action, true);
      this.pressed.add(action);
      el.classList.add('active');
    };
    const up = (e) => {
      e.preventDefault();
      this.touchButtons.delete(action);
      el.classList.remove('active');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  held(action) {
    if (this.touchButtons.get(action)) return true;
    switch (action) {
      case 'forward': return this.keys.has('KeyW') || this.keys.has('ArrowUp');
      case 'back': return this.keys.has('KeyS') || this.keys.has('ArrowDown');
      case 'left': return this.keys.has('KeyA') || this.keys.has('ArrowLeft');
      case 'right': return this.keys.has('KeyD') || this.keys.has('ArrowRight');
      case 'sprint': return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchButtons.get('sprint') === true;
      case 'crouch': return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.touchButtons.get('crouch') === true;
      default: return this.touchButtons.get(action) || false;
    }
  }

  pressedOnce(action) {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  consumeLook() {
    const l = { x: this.lookDX, y: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return l;
  }

  clearPressed() {
    this.pressed.clear();
  }

  get moveVector() {
    let x = 0;
    let y = 0;
    if (this.held('forward')) y -= 1;
    if (this.held('back')) y += 1;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (Math.abs(this.joystick.x) > 0.12 || Math.abs(this.joystick.y) > 0.12) {
      x = this.joystick.x * 1.2;
      y = this.joystick.y * 1.2;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y, magnitude: Math.min(1, len) };
  }
}
