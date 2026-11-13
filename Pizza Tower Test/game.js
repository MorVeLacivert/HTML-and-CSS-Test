// John Gutter: a small fan-made level inspired by Pizza Tower.
// Everything is drawn with shapes, so there are no copied assets.

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;
const T = 40, LEVEL_W = 30000, PILLAR_X = LEVEL_W - 140, GROUND = 460;
const TOPPING_COLORS = ['#ff4d3d', '#ffd84a', '#e8e0c8', '#9b5a2b', '#f5a623'];
const MACH_SPEEDS = [4.5, 6, 8, 11];
const POWER_NAMES = { ghost: 'GHOST!', speed: 'SPEED!', wings: 'WINGS!' };
// time = escape countdown in seconds
// laps = laps needed in one escape for a P rank
// speedup = how much faster the countdown ticks after every finished lap (0.3 = +30% per lap)
const DIFFS = {
  easy:   { time: 210, laps: 2, speedup: 0.15 },
  medium: { time: 360, laps: 3, speedup: 0.3 },
  hard:   { time: 720, laps: 4, speedup: 0.6 }
};
const ZONE_BRICKS = ['#2a1640', '#3b1a33', '#1a2a45', '#2f3a1c', '#452a18'];

const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Enter' && state === 'end') start();
  if (e.code === 'KeyM' && state === 'end') showMenu();
  if (e.code === 'KeyN') Music.toggle();
  if (e.code === 'KeyT' && state === 'play') p.taunt = 40;
});
addEventListener('keyup', e => { keys[e.code] = false; });

let state = 'menu', diff = 'easy', solids, toppings, enemies, parts, popups, pickups, p;
let score, combo, comboT, got, kills, escape, timer, shake, camX, result, laps = 0, lapCool = 0, safeX = 120;

const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// The level is generated from a fixed seed, so it is the same every time you play.
function build() {
  solids = []; toppings = []; enemies = []; parts = []; popups = []; pickups = [];
  const rnd = mulberry32(7);
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const TYPES = ['ghost', 'wings', 'speed'];

  const ground = (a, b) => solids.push({ x: a, y: GROUND, w: b - a, h: 300, type: 'solid' });
  const plat = (x, y, w) => { solids.push({ x, y, w, h: 20, type: 'plat' }); row(x + 20, x + w - 20, y - 30, 40); };
  const wall = x => {
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < 3; i++)
        solids.push({ x: x + c * T, y: GROUND - T * (i + 1), w: T, h: T, type: 'block', alive: true });
  };
  const foe = (x, r = 100) =>
    enemies.push({ x, y: GROUND - 44, w: 34, h: 44, dir: 1, min: x - r, max: x + r, alive: true });
  const pick = (type, x) => pickups.push({ x, y: GROUND - 50, type, got: false });

  // Level edges
  solids.push({ x: -40, y: -400, w: 40, h: 1200, type: 'solid' });
  solids.push({ x: LEVEL_W, y: -400, w: 40, h: 1200, type: 'solid' });

  // Build the level as a chain of ground sections separated by pits
  let a = 0, idx = 0;
  for (;;) {
    const last = LEVEL_W - a <= 2300;
    const b = last ? LEVEL_W : a + (idx === 0 ? 1100 : Math.round(between(750, 1400) / 10) * 10);
    const len = b - a;
    ground(a, b);

    if (idx === 0) {                       // warm-up section
      row(250, 900, GROUND - 30, 65); plat(420, 370, 160); pick('speed', 350); foe(700);
    } else if (last) {                     // approach to the John pillar
      row(a + 150, b - 450, GROUND - 30, 50);
      foe(a + 300); foe(a + len * 0.5); foe(b - 450);
    } else {
      row(a + 100, a + 260, GROUND - 30, 40);
      const r = rnd();
      if (r < 0.35 && len > 850) {         // block wall: smash it for toppings
        wall(a + len / 2 - 40);
        row(a + len / 2 + 70, a + len / 2 + 190, GROUND - 30, 40);
        foe(a + len * 0.22); foe(a + len * 0.76);
      } else if (r < 0.65) {               // stepping platforms
        const w = 160 + (rnd() * 60 | 0), px = a + len * between(0.25, 0.4), py = 370 - (rnd() * 3 | 0) * 20;
        plat(px, py, w);
        if (px + w + 80 + 140 < b - 20) plat(px + w + 80, py - 60, 140);
        foe(a + len * 0.2); foe(a + len * 0.78);
      } else if (r < 0.8 && len > 1000) {  // high road
        for (let k = 0; k < 4; k++) plat(a + 150 + k * 230, 350 - (k % 2) * 40, 150);
        foe(a + len * 0.3); foe(a + len * 0.7);
      } else {                             // long flat run for building Mach speed
        row(a + 300, b - 150, GROUND - 30, 50);
        foe(a + len * 0.45); foe(b - 260, 80);
      }
      if (idx % 2 === 1) pick(TYPES[(idx >> 1) % 3], a + 70);
    }

    if (last) break;
    const gap = Math.round(between(120, 150));
    row(b + 30, b + gap - 30, GROUND - 120, 40);   // toppings arc over the pit
    a = b + gap; idx++;
  }
}

function row(x1, x2, y, step) {
  for (let x = x1; x <= x2; x += step)
    toppings.push({ x, y, got: false, c: TOPPING_COLORS[toppings.length % TOPPING_COLORS.length] });
}

function newPlayer(x) {
  return { x, y: GROUND - 46, w: 30, h: 46, vx: 0, vy: 0, face: 1, onGround: false,
           machT: 0, mach: 0, inv: 0, taunt: 0, jumpHeld: false,
           ghost: 0, speedT: 0, wings: 0, flap: 0 };
}

function start() {
  Music.start();
  build();
  p = newPlayer(120);
  score = 0; combo = 0; comboT = 0; got = 0; kills = 0;
  escape = false; timer = 0; shake = 0; camX = 0; result = null; laps = 0; lapCool = 0; safeX = 120;
  state = 'play';
}

function addScore(n, x, y) {
  combo++; comboT = 150;
  const pts = Math.round(n * (1 + Math.floor(combo / 5) * 0.5));
  score += pts;
  popups.push({ x, y, t: 50, txt: '+' + pts });
}

function burst(x, y, color) {
  for (let i = 0; i < 8; i++)
    parts.push({ x, y, vx: (Math.random() - 0.5) * 8, vy: -Math.random() * 7, life: 40, c: color });
}

function hurt() {
  score = Math.max(0, score - 100); combo = 0; comboT = 0;
  p.inv = 90; p.vy = -8; p.vx = -p.face * 6; shake = 10;
}

function respawn() {
  // Back up a little from the last ground you stood on, keeping your power-ups
  const x = Math.max(60, Math.min(LEVEL_W - 100, safeX - p.face * 100));
  p = Object.assign(newPlayer(x), { inv: 90, face: p.face, speedT: p.speedT, wings: p.wings });
  combo = 0; score = Math.max(0, score - 50);
}

// Ghost potion lets you pass through blocks and floating platforms
const solidFor = (a, s) => s.alive !== false && !(a.ghost > 0 && (s.type === 'plat' || s.type === 'block')) && hit(a, s);

function finish(timeUp) {
  const pct = got / toppings.length;
  let rank = pct < 0.3 ? 'D' : pct < 0.5 ? 'C' : pct < 0.7 ? 'B' : pct < 0.9 ? 'A' : 'S';
  // P rank: every topping, every Forknight, and all required laps in one escape
  if (pct === 1 && kills === enemies.length && laps >= DIFFS[diff].laps) rank = 'P';
  result = { won: true, rank, timeUp };
  state = 'end';
}

function nextLap() {
  solids.forEach(s => { if (s.type === 'block') s.alive = true; });
  pickups.forEach(u => { u.got = false; });
  enemies.forEach(e => { e.alive = true; e.x = (e.min + e.max) / 2; });
  p.x = PILLAR_X - 110; p.y = GROUND - p.h; p.vy = 0; p.face = -1; safeX = p.x;
  lapCool = 120;
  popups.push({ x: p.x - 60, y: p.y - 60, t: 90, txt: 'LAP ' + (laps + 1) });
  popups.push({ x: p.x - 60, y: p.y - 20, t: 90, txt: 'TIMER x' + (1 + laps * DIFFS[diff].speedup).toFixed(2) });
}

function update() {
  if (state !== 'play') return;

  const L = keys.ArrowLeft || keys.KeyA, R = keys.ArrowRight || keys.KeyD;
  const dir = (R ? 1 : 0) - (L ? 1 : 0);
  const run = keys.ShiftLeft || keys.ShiftRight || keys.KeyX;

  // Mach run: hold a direction and Shift to build speed
  if (dir && dir !== p.face) { p.face = dir; p.machT = 0; }
  if (dir && run) p.machT += p.speedT > 0 ? 3 : 1;
  else if (p.onGround) p.machT = 0;
  p.mach = p.machT > 70 ? 3 : p.machT > 40 ? 2 : p.machT > 10 ? 1 : 0;

  const target = dir ? dir * MACH_SPEEDS[p.mach] * (p.speedT > 0 ? 1.3 : 1) : 0;
  p.vx += (target - p.vx) * (dir ? 0.25 : 0.2);

  // Jump (release early for a shorter hop)
  const jump = keys.Space || keys.KeyZ || keys.ArrowUp || keys.KeyW;
  if (jump && !p.jumpHeld) {
    if (p.onGround) p.vy = -13.5;
    else if (p.wings > 0) { p.vy = -12; p.flap = 12; burst(p.x + p.w / 2, p.y + p.h, '#fff7e0'); }
  }
  if (!jump && p.vy < -5) p.vy = -5;
  p.jumpHeld = jump;
  p.vy = Math.min(p.vy + 0.65, 16);

  // Horizontal move and collisions
  p.x += p.vx;
  for (const s of solids) {
    if (!solidFor(p, s)) continue;
    if (s.type === 'block' && p.mach >= 3) {
      s.alive = false; score += 10; shake = 6;
      burst(s.x + T / 2, s.y + T / 2, '#c98a4b');
      continue;
    }
    if (p.vx > 0) p.x = s.x - p.w; else if (p.vx < 0) p.x = s.x + s.w;
    p.vx = 0; p.machT = 0;
  }

  // Vertical move and collisions
  p.y += p.vy; p.onGround = false;
  for (const s of solids) {
    if (!solidFor(p, s)) continue;
    if (p.vy > 0) { p.y = s.y - p.h; p.onGround = true; } else p.y = s.y + s.h;
    p.vy = 0;
  }

  if (p.onGround && Math.abs(p.y + p.h - GROUND) < 1) safeX = p.x;
  if (p.y > H + 200) respawn();
  if (p.inv) p.inv--;
  if (p.taunt) p.taunt--;
  if (comboT > 0 && --comboT === 0) combo = 0;
  if (shake > 0) shake--;

  // Toppings
  for (const t of toppings) {
    if (t.got) continue;
    if (Math.hypot(t.x - (p.x + p.w / 2), t.y - (p.y + p.h / 2)) < 28) {
      t.got = true; got++; addScore(10, t.x, t.y); burst(t.x, t.y, t.c);
    }
  }

  // Power-ups
  for (const u of pickups) {
    if (u.got || !hit(p, { x: u.x - 14, y: u.y - 18, w: 28, h: 36 })) continue;
    u.got = true; Music.pickup();
    if (u.type === 'ghost') p.ghost = 600;
    if (u.type === 'speed') p.speedT = 720;
    if (u.type === 'wings') p.wings = 900;
    popups.push({ x: u.x, y: u.y - 20, t: 70, txt: POWER_NAMES[u.type] });
  }
  if (p.speedT > 0) p.speedT--;
  if (p.wings > 0) p.wings--;
  if (p.flap > 0) p.flap--;
  if (p.ghost > 0) {
    // Stay a ghost until you are out of any block or platform
    const inside = solids.some(s => s.alive !== false && (s.type === 'block' || s.type === 'plat') && hit(p, s));
    if (!(p.ghost === 1 && inside)) p.ghost--;
  }

  // Forknights: stomp them or smash them at Mach 2+
  for (const e of enemies) {
    if (!e.alive) continue;
    e.x += e.dir * 1.2;
    if (e.x < e.min) e.dir = 1;
    if (e.x > e.max) e.dir = -1;
    if (!hit(p, e)) continue;
    if (p.mach >= 2 || (p.vy > 1 && p.y + p.h - e.y < 24)) {
      e.alive = false; if (!e.done) { e.done = true; kills++; } addScore(100, e.x, e.y); burst(e.x, e.y, '#9aa0b4');
      if (p.mach < 2) p.vy = -9;
    } else if (!p.inv) hurt();
  }

  // The John pillar starts the escape
  if (!escape && p.x + p.w > PILLAR_X) {
    escape = true; timer = DIFFS[diff].time * 60; laps = 0; shake = 40;
    popups.push({ x: p.x - 80, y: p.y - 60, t: 120, txt: 'ESCAPE!' });
  }
  if (lapCool > 0) lapCool--;
  if (escape) {
    timer -= 1 + laps * DIFFS[diff].speedup;   // ticks faster after every lap
    if (timer <= 0) {
      if (laps > 0) finish(true);
      else { result = { won: false }; state = 'end'; }
    } else if (p.x < 110 && !lapCool) {
      // Reaching the exit completes a lap
      laps++; score += 500;
      if (laps >= DIFFS[diff].laps || keys.ArrowDown || keys.KeyS) finish(false);
      else nextLap();
    }
  }

  parts.forEach(q => { q.x += q.vx; q.y += q.vy; q.vy += 0.4; q.life--; });
  parts = parts.filter(q => q.life > 0);
  popups.forEach(q => { q.y -= 0.8; q.t--; });
  popups = popups.filter(q => q.t > 0);
}

// ---------- Drawing ----------

function drawBackground() {
  ctx.fillStyle = '#1d0f2e';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ZONE_BRICKS[Math.floor((camX + W / 2) / 6000) % ZONE_BRICKS.length];
  const off = -(camX * 0.5) % 120;
  for (let row = 0; row < 14; row++)
    for (let x = off - 120; x < W + 120; x += 120)
      ctx.fillRect(x + (row % 2) * 60, row * 40, 112, 32);
  if (escape) {
    ctx.fillStyle = `rgba(217, 38, 28, ${0.15 + 0.08 * Math.sin(Date.now() / 120)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawSolids() {
  for (const s of solids) {
    if (s.alive === false) continue;
    const x = s.x - camX;
    if (x > W || x + s.w < 0) continue;
    if (s.type === 'block') {
      ctx.fillStyle = '#c98a4b'; ctx.fillRect(x, s.y, s.w, s.h);
      ctx.strokeStyle = '#7a3e17'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);
      ctx.beginPath(); ctx.moveTo(x + 8, s.y + 8); ctx.lineTo(x + 18, s.y + 18); ctx.stroke();
    } else if (s.type === 'plat') {
      ctx.fillStyle = '#7a3e17'; ctx.fillRect(x, s.y, s.w, s.h);
      ctx.fillStyle = '#ffc61a'; ctx.fillRect(x, s.y, s.w, 6);
    } else if (s.y >= 0) {
      ctx.fillStyle = '#4a2a72'; ctx.fillRect(x, s.y, s.w, s.h);
      ctx.fillStyle = '#ffc61a'; ctx.fillRect(x, s.y, s.w, 8);
      ctx.fillStyle = '#3a2058';
      for (let bx = Math.max(x, -80); bx < Math.min(x + s.w, W); bx += 80) ctx.fillRect(bx + 6, s.y + 24, 64, 4);
    }
  }
}

function drawDoor() {
  const x = 30 - camX;
  ctx.fillStyle = '#7a3e17'; ctx.fillRect(x, GROUND - 100, 70, 100);
  ctx.fillStyle = '#d9261c'; ctx.fillRect(x + 6, GROUND - 94, 58, 88);
  ctx.fillStyle = '#fff7e0'; ctx.font = '20px Impact, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('EXIT', x + 35, GROUND - 60);
}

function drawJohn() {
  const x = PILLAR_X - camX, y = GROUND - 220;
  ctx.fillStyle = '#6f6a85'; ctx.fillRect(x, y, 80, 220);
  ctx.fillStyle = '#85809c'; ctx.fillRect(x, y, 14, 220);
  ctx.fillStyle = '#1b0f26';
  ctx.fillRect(x + 18, y + 60, 16, 20); ctx.fillRect(x + 46, y + 60, 16, 20);
  ctx.fillStyle = escape ? '#ff4d3d' : '#fff7e0';
  ctx.fillRect(x + 24, y + 66, 6, 8); ctx.fillRect(x + 52, y + 66, 6, 8);
  ctx.fillStyle = '#1b0f26'; ctx.fillRect(x + 20, y + 110, 40, 12);
}

function drawToppings() {
  const bob = Math.sin(Date.now() / 200);
  for (const t of toppings) {
    if (t.got || t.x - camX < -20 || t.x - camX > W + 20) continue;
    ctx.fillStyle = t.c;
    ctx.beginPath(); ctx.arc(t.x - camX, t.y + bob * 3, 9, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1b0f26'; ctx.lineWidth = 2; ctx.stroke();
  }
}

function drawPickups() {
  const bob = Math.sin(Date.now() / 250) * 4;
  for (const u of pickups) {
    if (u.got) continue;
    const x = u.x - camX, y = u.y + bob;
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x, y, 24, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1b0f26'; ctx.lineWidth = 2;
    if (u.type === 'wings') {
      ctx.fillStyle = '#fff7e0';
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + d * 11, y - 2, 13, 6, d * -0.6, 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = '#ffc61a'; ctx.beginPath(); ctx.arc(x, y + 2, 5, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 6, y - 19, 12, 4);
      ctx.fillStyle = u.type === 'ghost' ? '#bfe8ff' : '#5fe36b';
      ctx.fillRect(x - 5, y - 16, 10, 8);
      ctx.beginPath(); ctx.arc(x, y + 2, 13, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b0f26';
      if (u.type === 'ghost') { ctx.fillRect(x - 6, y - 2, 4, 6); ctx.fillRect(x + 2, y - 2, 4, 6); }
      else { ctx.beginPath(); ctx.moveTo(x + 3, y - 7); ctx.lineTo(x - 4, y + 3); ctx.lineTo(x, y + 3); ctx.lineTo(x - 3, y + 11); ctx.lineTo(x + 5, y); ctx.lineTo(x + 1, y); ctx.fill(); }
    }
  }
}

function drawEnemies() {
  for (const e of enemies) {
    if (!e.alive) continue;
    const x = e.x - camX;
    ctx.fillStyle = '#9aa0b4'; ctx.fillRect(x, e.y + 12, e.w, e.h - 12);
    ctx.fillStyle = '#6f748a'; ctx.fillRect(x - 2, e.y, e.w + 4, 16);
    ctx.fillStyle = '#1b0f26'; ctx.fillRect(x + (e.dir > 0 ? 18 : 4), e.y + 5, 12, 5);
    ctx.fillStyle = '#ffc61a'; ctx.fillRect(x + (e.dir > 0 ? 34 : -8), e.y + 14, 5, 30);
    ctx.fillRect(x + (e.dir > 0 ? 31 : -11), e.y + 10, 11, 4);
  }
}

function drawPlayer() {
  if (p.inv && Math.floor(p.inv / 5) % 2) return;
  const x = p.x - camX, y = p.y;
  if (p.mach >= 2 || (p.speedT > 0 && Math.abs(p.vx) > 3)) {
    ctx.fillStyle = p.speedT > 0 ? '#5fe36b' : p.mach === 3 ? '#ff4d3d' : '#ffc61a';
    for (let i = 1; i <= 3; i++) { ctx.globalAlpha = 0.2; ctx.fillRect(x - p.face * i * 14, y, p.w, p.h); }
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = p.ghost > 0 ? 0.5 : 1;
  ctx.save();
  ctx.translate(x + p.w / 2, y + p.h / 2);
  ctx.scale(p.face, 1);
  if (p.taunt) ctx.rotate(Math.sin(p.taunt * 0.6) * 0.25);
  const step = p.onGround && Math.abs(p.vx) > 0.5 ? Math.sin(Date.now() / (110 - p.mach * 20)) * 5 : 0;
  if (p.wings > 0) {
    ctx.fillStyle = '#fff7e0'; ctx.strokeStyle = '#1b0f26'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(-14, -6, 6, 16, p.flap > 0 ? -0.9 : -0.3, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#2b4fa8';
  ctx.fillRect(-12 + step, 8, 10, 15); ctx.fillRect(2 - step, 8, 10, 15);
  ctx.fillStyle = '#fff7e0'; ctx.fillRect(-13, -2, 26, 14);
  ctx.fillStyle = '#f2b28c'; ctx.beginPath(); ctx.arc(0, -6, 11, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(10, -4, 5, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff7e0'; ctx.beginPath(); ctx.ellipse(0, -18, 14, 8, 0, 0, 7); ctx.fill();
  ctx.fillRect(-10, -18, 20, 8);
  ctx.fillStyle = '#1b0f26'; ctx.fillRect(2, -10, 4, 4); ctx.fillRect(-6, -1, 12, 3);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawHUD() {
  ctx.textAlign = 'left'; ctx.fillStyle = '#ffc61a';
  ctx.font = '36px Impact, sans-serif'; ctx.fillText(String(score).padStart(5, '0'), 20, 46);
  ctx.fillStyle = '#fff7e0'; ctx.font = '18px "Trebuchet MS", sans-serif';
  ctx.fillText(`Toppings ${got}/${toppings.length}`, 20, 72);
  if (combo > 1) {
    ctx.fillStyle = '#ff4d3d'; ctx.font = '28px Impact, sans-serif';
    ctx.fillText(`Combo x${combo}`, 20, 108);
    ctx.fillStyle = '#ffc61a'; ctx.fillRect(20, 116, 120 * (comboT / 150), 6);
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = p.mach > i ? ['#ffc61a', '#f5a623', '#ff4d3d'][i] : 'rgba(255,255,255,0.2)';
    ctx.fillRect(20 + i * 34, H - 36, 28, 14);
  }
  const active = [['Ghost', p.ghost, 600, '#bfe8ff'], ['Speed', p.speedT, 720, '#5fe36b'], ['Wings', p.wings, 900, '#fff7e0']]
    .filter(a => a[1] > 0);
  ctx.textAlign = 'right'; ctx.font = '18px "Trebuchet MS", sans-serif';
  active.forEach((a, i) => {
    const y = 34 + i * 34;
    ctx.fillStyle = '#fff7e0'; ctx.fillText(a[0], W - 20, y);
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(W - 140, y + 6, 120, 8);
    ctx.fillStyle = a[3]; ctx.fillRect(W - 140, y + 6, 120 * a[1] / a[2], 8);
  });
  ctx.fillStyle = 'rgba(255,247,224,0.6)'; ctx.font = '14px "Trebuchet MS", sans-serif';
  ctx.fillText('N: music on/off', W - 16, H - 16);
  // Level progress bar: left marker is the exit door, right marker is the pillar
  const bx = W / 2 - 160, by = H - 24;
  ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(bx, by, 320, 6);
  ctx.fillStyle = '#d9261c'; ctx.fillRect(bx + 317, by - 8, 6, 22);
  ctx.fillStyle = '#fff7e0'; ctx.fillRect(bx - 3, by - 8, 6, 22);
  ctx.fillStyle = '#ffc61a'; ctx.fillRect(bx + 320 * Math.max(0, Math.min(1, p.x / LEVEL_W)) - 4, by - 5, 8, 16);
  if (escape) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ff4d3d'; ctx.font = '48px Impact, sans-serif';
    const sec = Math.max(0, Math.ceil(timer / 60)), need = DIFFS[diff].laps, rate = 1 + laps * DIFFS[diff].speedup;
    ctx.fillText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, W / 2, 56);
    ctx.fillStyle = '#fff7e0'; ctx.font = '20px "Trebuchet MS", sans-serif';
    ctx.fillText(`Lap ${Math.min(laps + 1, need)}/${need}` + (rate > 1 ? `    Timer x${rate.toFixed(2)}` : ''), W / 2, 82);
    ctx.font = '14px "Trebuchet MS", sans-serif'; ctx.fillText('Hold S at the exit to finish early', W / 2, 102);
  }
}

function overlay(title, lines) {
  ctx.fillStyle = 'rgba(27, 15, 38, 0.82)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffc61a'; ctx.font = '84px Impact, sans-serif';
  ctx.fillText(title, W / 2, 200);
  ctx.fillStyle = '#fff7e0'; ctx.font = '22px "Trebuchet MS", sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 262 + i * 34));
}

function draw() {
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  camX = Math.max(0, Math.min(LEVEL_W + 40 - W, p.x - W * 0.4));
  ctx.save(); ctx.translate(sx, 0);
  drawBackground(); drawDoor(); drawJohn(); drawSolids(); drawToppings(); drawPickups(); drawEnemies(); drawPlayer();
  for (const q of parts) { ctx.fillStyle = q.c; ctx.fillRect(q.x - camX, q.y, 6, 6); }
  ctx.textAlign = 'center'; ctx.font = '26px Impact, sans-serif'; ctx.fillStyle = '#fff7e0';
  for (const q of popups) ctx.fillText(q.txt, q.x - camX, q.y);
  ctx.restore();
  if (state === 'play' || state === 'end') drawHUD();

  if (state === 'end' && result.won)
    overlay(`RANK ${result.rank}`, [`Score ${score}  |  Laps ${laps}/${DIFFS[diff].laps}  |  ${diff}`,
      `Toppings ${got}/${toppings.length}  |  Forknights ${kills}/${enemies.length}`,
      result.rank === 'P' ? 'Perfect run!' : result.timeUp ? "Time's up! Finish all laps for a P rank." : 'P rank needs everything, plus all laps.',
      'Enter: play again  |  M: menu']);
  if (state === 'end' && !result.won)
    overlay('TOO SLOW', ['The tower caught you.', 'Enter: try again  |  M: menu']);
}

// ---------- Music (synthesized with the Web Audio API, no files needed) ----------

const Music = (() => {
  let ac, master, noiseBuf, timer = null, step = 0, next = 0, on = true;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  // Chords as MIDI notes: calm for exploring, rush for the escape
  const CH = {
    calm: [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]],
    rush: [[38, 41, 45], [34, 38, 41], [36, 40, 43], [37, 40, 44]]
  };
  const ARP = [0, 1, 2, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1];

  function tone(t, f, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, vol, hp) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
  }
  function kick(t) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
  }
  const rushing = () => escape && state === 'play';

  function playStep(s, t) {
    const rush = rushing(), i = s % 16;
    const ch = (rush ? CH.rush : CH.calm)[Math.floor(s / 16) % 4];
    if (i % 4 === 0) kick(t);
    if (i === 4 || i === 12) noise(t, 0.12, 0.25, 1500);
    if (i % 2 === 0 || rush) noise(t, 0.04, 0.08, 7000);
    if ([0, 3, 6, 8, 11, 14].includes(i)) tone(t, mtof(ch[0]), 0.16, 'sawtooth', 0.16);
    tone(t, mtof(ch[ARP[i]] + 24), 0.12, 'square', 0.05);
    if (rush && i % 2 === 1) tone(t, mtof(ch[ARP[i]] + 36), 0.08, 'triangle', 0.06);
  }
  function tick() {
    const dur = 60 / (rushing() ? 190 : 150) / 4;
    while (next < ac.currentTime + 0.15) { playStep(step++, next); next += dur; }
  }

  return {
    start() {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = on ? 0.5 : 0; master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
      if (!timer) { next = ac.currentTime + 0.05; timer = setInterval(tick, 40); }
    },
    toggle() { on = !on; if (master) master.gain.value = on ? 0.5 : 0; },
    pickup() {
      if (!ac || !on) return;
      const t = ac.currentTime;
      [660, 880, 1320].forEach((f, i) => tone(t + i * 0.06, f, 0.14, 'triangle', 0.2));
    }
  };
})();

// ---------- Main loop (fixed 60 updates per second) ----------

build();
p = newPlayer(120);
score = 0; combo = 0; comboT = 0; got = 0; kills = 0; escape = false; timer = 0; shake = 0; camX = 0;

// ---------- Menu wiring ----------
const $ = id => document.getElementById(id);
function showMenu() {
  state = 'menu'; build(); p = newPlayer(120); camX = 0; escape = false; laps = 0;
  $('difficulty').classList.add('hidden');
  $('menu').classList.remove('hidden');
}
$('startBtn').onclick = () => { Music.start(); $('menu').classList.add('hidden'); $('difficulty').classList.remove('hidden'); };
$('backBtn').onclick = () => { $('difficulty').classList.add('hidden'); $('menu').classList.remove('hidden'); };
document.querySelectorAll('[data-diff]').forEach(b => {
  b.onclick = () => { diff = b.dataset.diff; $('difficulty').classList.add('hidden'); cv.focus(); start(); };
});

let last = 0, acc = 0;
function frame(t) {
  acc += Math.min(100, t - last); last = t;
  while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);