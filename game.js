import { play, playOverlap, unlock } from './sfx.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W, H, dpr;
// responsive viewport in world units (vw x vh) + uniform scale to screen
let vw = 480, vh = 800, scale = 1;
const MIN_VH_PORTRAIT = 820;   // portrait: tall view, player ~12% of height
const MIN_VH_LANDSCAPE = 560;  // landscape: wide, short view
const MAX_VW = 1500;           // keep horizontal span sane on ultrawide

const LEVEL_W = 3400;
const GROUND_Y = 950; // world y of ground top

// gravity / physics
const GRAV = 2800;
const MOVE_SPD = 360;
const MAX_JUMPS = 3;
const JUMP_V = 920;
const SHOT_COOLDOWN = 0.28;
const BULLET_SPD = 820;
const DASH_SPD = 1080;
const DASH_TIME = 0.18;
const DASH_COOLDOWN = 0.6;
const DASH_GHOST_EVERY = 0.024;
const GHOST_LIFE = 0.42;
const PLAYER_H = 96;
const COINS_TO_WIN = 10;
const START_LIVES = 3;
const COIN_R = 18;
const TOTAL_LEVELS = 10;
const BOSS_LEVEL = 10;   // 1-based level where the boss appears
const BOSS_HP = 600;     // shots needed to defeat the boss

let sprites = [];       // prepped (cropped) canvas per frame
let outlines = [];      // same frames with a dark outline so the player pops
let jumpSprites = [];   // jump frames
let jumpOutlines = [];  // jump frames with outline
let sprAspect = 0;      // width/height ratio after crop
let sprH = 0;
let bgImage = null;

// make a version of a frame where all non-transparent pixels are a single dark color
function solidify(frame) {
  const s = document.createElement('canvas');
  s.width = frame.width; s.height = frame.height;
  const sc = s.getContext('2d');
  sc.drawImage(frame, 0, 0);
  const id = sc.getImageData(0, 0, s.width, s.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 12) { d[i] = 25; d[i + 1] = 35; d[i + 2] = 55; }
    else { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
  }
  sc.putImageData(id, 0, 0);
  return s;
}

// frame expanded by an outline ring
function outlined(frame) {
  const solid = solidify(frame);
  const pad = 4;
  const oc = document.createElement('canvas');
  oc.width = frame.width + pad * 2;
  oc.height = frame.height + pad * 2;
  const c = oc.getContext('2d');
  const offsets = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [ox, oy] of offsets) {
    c.drawImage(solid, pad + ox, pad + oy);
  }
  c.drawImage(frame, pad, pad);
  return oc;
}

// find the content bounding box (non-transparent pixels) of an image
function contentBox(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cc = c.getContext('2d');
  cc.drawImage(img, 0, 0);
  const d = cc.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return [x0, y0, x1 + 1, y1 + 1];
}

function prepSprites(frameImages) {
  for (let i = 0; i < frameImages.length; i++) {
    const img = frameImages[i];
    const [x0, y0, x1, y1] = contentBox(img);
    const c = document.createElement('canvas');
    const w = x1 - x0, h = y1 - y0;
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, x0, y0, w, h, 0, 0, w, h);
    sprites.push(c);
    outlines.push(outlined(c));
    if (i === 0) {
      sprAspect = w / h;
      sprH = h;
    }
  }
}

function prepJumpSprites(frameImages) {
  for (const img of frameImages) {
    const [x0, y0, x1, y1] = contentBox(img);
    const c = document.createElement('canvas');
    const w = x1 - x0, h = y1 - y0;
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, x0, y0, w, h, 0, 0, w, h);
    jumpSprites.push(c);
    jumpOutlines.push(outlined(c));
  }
}

// ----- levels: platforms / enemies / coins per level -----
// enemies patrol platform by index; coins (x,y) are coin centers, some on platforms
const LEVELS = [
  {
    platforms: [
      { x: -200, y: GROUND_Y, w: LEVEL_W + 400, h: 400 }, // ground
      { x: 90, y: 720, w: 130, h: 22 },
      { x: 300, y: 620, w: 150, h: 22 },
      { x: 540, y: 480, w: 170, h: 22 },
      { x: 780, y: 640, w: 140, h: 22 },
      { x: 980, y: 500, w: 170, h: 22 },
      { x: 1200, y: 640, w: 150, h: 22 },
      { x: 1420, y: 460, w: 180, h: 22 },
      { x: 1660, y: 620, w: 150, h: 22 },
      { x: 1880, y: 500, w: 170, h: 22 },
      { x: 2120, y: 640, w: 130, h: 22 },
      { x: 2320, y: 470, w: 180, h: 22 },
      { x: 2560, y: 620, w: 150, h: 22 },
      { x: 2780, y: 520, w: 170, h: 22 },
    ],
    enemies: [
      { x: 300, plat: 2, dir: 1 },
      { x: 540, plat: 4, dir: 1 },
      { x: 980, plat: 6, dir: 1 },
      { x: 1420, plat: 8, dir: 1 },
      { x: 1880, plat: 10, dir: 1 },
      { x: 2320, plat: 12, dir: 1 },
      { x: 2780, plat: 13, dir: 1 },
    ],
    coins: [
      { x: 180,  y: GROUND_Y - 45 },
      { x: 365,  y: 620 - 30 },
      { x: 625,  y: 480 - 30 },
      { x: 1190, y: 640 - 30 },
      { x: 1510, y: 460 - 30 },
      { x: 1790, y: 620 - 30 },
      { x: 2020, y: 500 - 30 },
      { x: 2460, y: 470 - 30 },
      { x: 2700, y: 620 - 30 },
      { x: 2870, y: 520 - 30 },
    ],
  },
  {
    platforms: [
      { x: -200, y: GROUND_Y, w: LEVEL_W + 400, h: 400 },
      { x: 120, y: 700, w: 120, h: 22 },
      { x: 340, y: 580, w: 150, h: 22 },
      { x: 570, y: 440, w: 180, h: 22 },
      { x: 830, y: 660, w: 130, h: 22 },
      { x: 1020, y: 480, w: 160, h: 22 },
      { x: 1240, y: 620, w: 150, h: 22 },
      { x: 1460, y: 420, w: 190, h: 22 },
      { x: 1710, y: 640, w: 140, h: 22 },
      { x: 1930, y: 500, w: 170, h: 22 },
      { x: 2180, y: 660, w: 130, h: 22 },
      { x: 2390, y: 450, w: 190, h: 22 },
      { x: 2640, y: 600, w: 150, h: 22 },
      { x: 2870, y: 520, w: 160, h: 22 },
    ],
    enemies: [
      { x: 340, plat: 2, dir: 1 },
      { x: 570, plat: 4, dir: 1 },
      { x: 1020, plat: 6, dir: 1 },
      { x: 1240, plat: 7, dir: 1 },
      { x: 1710, plat: 9, dir: 1 },
      { x: 1930, plat: 10, dir: 1 },
      { x: 2390, plat: 12, dir: 1 },
      { x: 2640, plat: 13, dir: 1 },
    ],
    coins: [
      { x: 220,  y: GROUND_Y - 45 },
      { x: 415,  y: 580 - 30 },
      { x: 660,  y: 440 - 30 },
      { x: 900,  y: 660 - 30 },
      { x: 1110, y: 480 - 30 },
      { x: 1495, y: 420 - 30 },
      { x: 1770, y: 640 - 30 },
      { x: 2010, y: 500 - 30 },
      { x: 2470, y: 450 - 30 },
      { x: 2950, y: 520 - 30 },
    ],
  },
  {
    platforms: [
      { x: -200, y: GROUND_Y, w: LEVEL_W + 400, h: 400 },
      { x: 100, y: 700, w: 110, h: 22 },
      { x: 290, y: 560, w: 150, h: 22 },
      { x: 520, y: 430, w: 190, h: 22 },
      { x: 800, y: 660, w: 120, h: 22 },
      { x: 990, y: 460, w: 170, h: 22 },
      { x: 1210, y: 620, w: 150, h: 22 },
      { x: 1430, y: 400, w: 200, h: 22 },
      { x: 1690, y: 640, w: 130, h: 22 },
      { x: 1910, y: 480, w: 170, h: 22 },
      { x: 2160, y: 660, w: 120, h: 22 },
      { x: 2370, y: 430, w: 200, h: 22 },
      { x: 2620, y: 600, w: 150, h: 22 },
      { x: 2860, y: 500, w: 170, h: 22 },
    ],
    enemies: [
      { x: 100, plat: 1, dir: 1 },
      { x: 290, plat: 2, dir: 1 },
      { x: 520, plat: 4, dir: 1 },
      { x: 990, plat: 6, dir: 1 },
      { x: 1210, plat: 7, dir: 1 },
      { x: 1430, plat: 8, dir: 1 },
      { x: 1910, plat: 10, dir: 1 },
      { x: 2160, plat: 11, dir: 1 },
      { x: 2370, plat: 12, dir: 1 },
      { x: 2620, plat: 13, dir: 1 },
    ],
    coins: [
      { x: 200,  y: GROUND_Y - 45 },
      { x: 365,  y: 560 - 30 },
      { x: 600,  y: 430 - 30 },
      { x: 870,  y: 660 - 30 },
      { x: 1075, y: 460 - 30 },
      { x: 1520, y: 400 - 30 },
      { x: 1755, y: 640 - 30 },
      { x: 1990, y: 480 - 30 },
      { x: 2460, y: 430 - 30 },
      { x: 2945, y: 500 - 30 },
    ],
  },
];

// ----- procedurally build levels 4..10 -----
// reuses the same platform X positions (guarantees reachable layout) but varies heights
const PLAT_X = [90, 300, 540, 780, 980, 1200, 1420, 1660, 1880, 2120, 2320, 2560, 2780];
const PLAT_W = [130, 150, 170, 140, 170, 150, 180, 150, 170, 130, 180, 150, 170];

function genLevel(seed) {
  const platforms = [{ x: -200, y: GROUND_Y, w: LEVEL_W + 400, h: 400 }];
  const heights = [];
  for (let i = 0; i < PLAT_X.length; i++) {
    const y = 700 - ((i * 3 + seed * 5) % 9) * 35;
    heights.push(y);
    platforms.push({ x: PLAT_X[i], y, w: PLAT_W[i], h: 22 });
  }
  const enemies = [];
  const enemyPlats = [2, 4, 6, 7, 9, 11, 12];
  const dirs = [1, -1, 1, -1, 1, -1, 1];
  for (let n = 0; n < enemyPlats.length; n++) {
    const idx = (enemyPlats[n] + seed) % PLAT_X.length;
    enemies.push({ x: PLAT_X[idx], plat: idx + 1, dir: dirs[n] });
  }
  const coins = [];
  for (let n = 0; n < COINS_TO_WIN; n++) {
    const idx = (n + seed * 2) % PLAT_X.length;
    coins.push({ x: PLAT_X[idx] + 30, y: heights[idx] - 30 });
  }
  return { platforms, enemies, coins };
}

// boss arena for level 10: wide open ground, scattered platforms, boss + few minions
function genBossLevel() {
  const platforms = [
    { x: -200, y: GROUND_Y, w: LEVEL_W + 400, h: 400 },
    { x: 900, y: 760, w: 600, h: 70 },
    { x: 1560, y: 700, w: 500, h: 70 },
    { x: 2150, y: 760, w: 500, h: 70 },
  ];
  const enemies = [
    { x: 980, plat: 1, dir: 1 },
    { x: 2300, plat: 3, dir: -1 },
  ];
  const coins = [];
  for (let n = 0; n < COINS_TO_WIN; n++) {
    coins.push({ x: 420 + n * 260, y: GROUND_Y - 45, })
  }
  return { platforms, enemies, coins, boss: true };
}

for (let i = 3; i < TOTAL_LEVELS; i++) {
  if (i + 1 === BOSS_LEVEL) LEVELS[i] = genBossLevel();
  else LEVELS[i] = genLevel(i);
}

// current level data
let platforms = [];
let coins = [];
let enemies = [];
let boss = null;
let levelIndex = 0;
let pendingLevel = null; // level queued after the "level complete" pause

function spawnBoss() {
  boss = {
    x: 2360, y: GROUND_Y - 230,
    w: 260, h: 230,
    dir: -1, minX: 1500, maxX: LEVEL_W - 360,
    spd: 110,
    hp: BOSS_HP, maxHp: BOSS_HP,
    active: true,
  };
}

function loadLevel(i) {
  const L = LEVELS[i];
  platforms = L.platforms;
  enemies = L.enemies.map((e) => Object.assign({ alive: true }, e));
  coins = L.coins.map((c) => Object.assign({ taken: false }, c));
  levelIndex = i;
  coinCount = 0;
  boss = null;
  if (L.boss) spawnBoss();
  player.x = 40;
  player.y = GROUND_Y - player.h;
  player.vx = 0; player.vy = 0;
  player.onGround = false;
  player.jumpsUsed = 0;
  player.facing = 1;
  player.alive = true;
  player.lives = START_LIVES;
  player.shotTimer = 0;
  player.dashT = 0;
  player.dashCd = 0;
  player.ghostT = 0;
  bullets = [];
  particles = [];
  ghosts = [];
  gameState = 'playing';
  updateHud();
}

const player = {
  x: 60, y: GROUND_Y - PLAYER_H,
  w: 60, h: PLAYER_H,
  vx: 0, vy: 0,
  facing: 1,
  onGround: false,
  jumpsUsed: 0,
  anim: 0,
  jumpT: 0,
  alive: true,
  lives: START_LIVES,
  dashT: 0,
  dashCd: 0,
  dashFx: 1,
  ghostT: 0,
};

let bullets = [];
let particles = [];
let ghosts = [];
let coinCount = 0;
let camX = 0, camY = 0;
let time = 0;
let gameState = 'playing'; // 'playing' | 'won' | 'lost'
loadLevel(0);

const input = { left: false, right: false, shooting: false };

// ----- resize / responsive layout -----
function layout() {
  const aspect = W / H;
  let viewH;
  if (aspect < 1) {
    viewH = MIN_VH_PORTRAIT;            // portrait / tall phones
  } else {
    viewH = MIN_VH_LANDSCAPE;           // landscape / desktop
  }
  vh = viewH;
  vw = vh * aspect;
  if (vw > MAX_VW) { vw = MAX_VW; vh = vw / aspect; }
  scale = H / vh;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  layout();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// ----- touch controls -----
function bindButton(id, kind) {
  const el = document.getElementById(id);
  let active = false;
  const press = (e) => {
    e.preventDefault();
    unlock();
    active = true;
    el.classList.add('pressed');
    if (kind === 'jump') doJump();
    if (kind === 'left') input.left = true;
    if (kind === 'right') input.right = true;
    if (kind === 'shoot') input.shooting = true;
    if (kind === 'dash') doDash();
  };
  const release = (e) => {
    e.preventDefault();
    active = false;
    el.classList.remove('pressed');
    if (kind === 'left') input.left = false;
    if (kind === 'right') input.right = false;
    if (kind === 'shoot') input.shooting = false;
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', () => { if (active) release(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindButton('btn-left', 'left');
bindButton('btn-right', 'right');
bindButton('btn-jump', 'jump');
bindButton('btn-shoot', 'shoot');
bindButton('btn-dash', 'dash');

// keyboard for desktop testing
const keys = {};
window.addEventListener('keydown', (e) => {
  unlock();
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
  if (e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') doJump();
  if (e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'ControlLeft') input.shooting = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX') doDash();
  if (['ArrowLeft','ArrowRight','ArrowUp','Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
  if (e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'ControlLeft') input.shooting = false;
});

// ----- game logic -----
function doJump() {
  if (!player.alive) return;
  play('jump');
  if (player.onGround) {
    player.vy = -JUMP_V;
    player.onGround = false;
    player.jumpsUsed = 1;
    player.jumpT = 0;
  } else if (player.jumpsUsed < MAX_JUMPS) {
    player.vy = -JUMP_V;
    player.jumpsUsed++;
  }
}

function doDash() {
  if (!player.alive) return;
  if (player.dashT > 0 || player.dashCd > 0) return;
  playOverlap('dash');
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0) || player.facing;
  player.dashFx = dir;
  player.facing = dir;
  player.dashT = DASH_TIME;
  player.dashCd = DASH_COOLDOWN;
}

// capture the current player frame into a standalone canvas for a ghost silhouette
function bakePlayer() {
  const ph = PLAYER_H;
  const pw = sprAspect ? ph * sprAspect : player.w;
  const frames = player.onGround ? sprites : jumpSprites;
  const frameOutlines = player.onGround ? outlines : jumpOutlines;
  if (!frames.length) return null;
  const idx = Math.floor((player.onGround ? player.anim : player.jumpT) % frames.length);
  const fill = frames[idx];
  const out = frameOutlines[idx];
  const pad = 4;
  const sx = pw / fill.width, sy = ph / fill.height;
  const w = (fill.width + pad * 2) * sx, h = (fill.height + pad * 2) * sy;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cc = c.getContext('2d');
  cc.translate(w / 2, h);
  cc.scale(player.facing, 1);
  cc.drawImage(out, -pw / 2 - pad * sx, -ph - pad * sy, w, h);
  cc.drawImage(fill, -pw / 2, -ph, pw, ph);
  return { c, w, h };
}

function spawnGhost() {
  const baked = bakePlayer();
  if (!baked) return;
  ghosts.push({
    c: baked.c, gw: baked.w, gh: baked.h,
    fx: player.x + player.w / 2,
    fy: player.y + player.h,
    life: GHOST_LIFE, max: GHOST_LIFE,
  });
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function movePlayer(dt) {
  if (player.dashCd > 0) player.dashCd -= dt;
  const mv = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  player.vx = mv * MOVE_SPD;
  if (mv !== 0) player.facing = mv;

  if (player.dashT > 0) {
    player.dashT -= dt;
    player.vx = player.dashFx * DASH_SPD;
    player.facing = player.dashFx;
    player.ghostT -= dt;
    if (player.ghostT <= 0) {
      player.ghostT = DASH_GHOST_EVERY;
      spawnGhost();
    }
  } else {
    player.ghostT = 0;
  }

  if (player.onGround) player.vy =  0; else player.vy += GRAV * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // horizontal collision
  for (const p of platforms) {
    if (rectsOverlap(player, p)) {
      if (player.vy >= 0 && player.y + player.h - p.y < 40) {
        // landing on top
        player.y = p.y - player.h;
        if (!player.onGround) { player.vy = 0; }
        player.onGround = true;
        player.jumpsUsed = 0;
      } else if (player.vy < 0 && p.y + p.h - player.y < 40) {
        player.y = p.y + p.h;
        player.vy = 0;
      } else {
        // side collision
        const fromLeft = player.x + player.w - p.x < p.x + p.w - player.x;
        if (fromLeft) { player.x = p.x - player.w; }
        else { player.x = p.x + p.w; }
        player.vx = 0;
      }
    }
  }

  // toggle onGround off if not standing
  if (player.onGround) {
    // recheck below
    player.onGround = false;
    for (const p of platforms) {
      if (player.vy >= 0 && Math.abs(player.y + player.h - p.y) < 8 &&
          player.x < p.x + p.w && player.x + player.w > p.x) {
        player.onGround = true;
      }
    }
  }

  // bounds
  player.x = Math.max(0, Math.min(LEVEL_W - player.w, player.x));
  if (player.y > GROUND_Y + 300) { respawn(); }

  // animation
  if (player.onGround) {
    player.jumpT = jumpSprites.length;
    time += dt;
    if (Math.abs(player.vx) > 5) {
      player.anim += dt * 10;
    } else {
      player.anim = 0;
    }
  } else {
    player.jumpT = Math.min(player.jumpT + dt * 5, jumpSprites.length);
  }
}

function fire() {
  playOverlap('shoot');
  bullets.push({
    x: player.x + player.w / 2,
    y: player.y + player.h / 2 - 6,
    w: 14, h: 8,
    vx: BULLET_SPD * player.facing,
    alive: true,
  });
}

function updateBullets(dt) {
  for (const b of bullets) {
    if (!b.alive) continue;
    b.x += b.vx * dt;
    if (b.x < camX - 50 || b.x > camX + vw + 50) { b.alive = false; continue; }
    for (const e of enemies) {
      if (!e.alive) continue;
      const eb = enemyBox(e);
      if (rectsOverlap(b, eb)) {
        b.alive = false;
        e.alive = false;
      }
    }
    if (b.alive && boss && boss.active) {
      if (rectsOverlap(b, bossBox())) {
        b.alive = false;
        boss.hp--;
        boss.flash = 0.08;
        if (boss.hp <= 0) bossDefeated();
      }
    }
  }
  bullets = bullets.filter((b) => b.alive);
}

function bossBox() {
  return { x: boss.x, y: boss.y, w: boss.w, h: boss.h };
}

function enemyBox(e) {
  const p = platforms[e.plat];
  return { x: e.x, y: p.y - 48, w: 44, h: 48 };
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) continue;
    const p = platforms[e.plat];
    const spd = 60;
    e.x += e.dir * spd * dt;
    if (e.x < p.x + 4) { e.x = p.x + 4; e.dir = 1; }
    if (e.x + 44 > p.x + p.w) { e.x = p.x + p.w - 44; e.dir = -1; }

    // hit player
    if (!player.alive) continue;
    const eb = enemyBox(e);
    if (rectsOverlap(eb, { x: player.x, y: player.y, w: player.w, h: player.h })) {
      takeDamage();
    }
  }
}

function updateBoss(dt) {
  if (!boss || !boss.active) return;
  if (boss.flash > 0) boss.flash -= dt;
  boss.x += boss.dir * boss.spd * dt;
  if (boss.x < boss.minX) { boss.x = boss.minX; boss.dir = 1; }
  if (boss.x + boss.w > boss.maxX) { boss.x = boss.maxX - boss.w; boss.dir = -1; }

  if (!player.alive) return;
  if (rectsOverlap(bossBox(), { x: player.x, y: player.y, w: player.w, h: player.h })) {
    takeDamage();
  }
}

function bossDefeated() {
  play('boss');
  gameState = 'won';
  player.alive = false;
  boss.active = false;
  document.getElementById('restart').textContent = 'Play again';
  showOverlay('You Win!', 'The boss is defeated!');
}

function respawn() {
  player.x = 40;
  player.y = GROUND_Y - player.h;
  player.vx = 0; player.vy = 0;
  player.onGround = false;
  player.jumpsUsed = 0;
  player.facing = 1;
  player.dashT = 0;
  player.dashCd = 0;
  player.ghostT = 0;
  enemies.forEach((e) => { e.alive = true; });
}

function takeDamage() {
  player.lives--;
  play('hurt');
  updateHud();
  if (player.lives <= 0) {
    play('gameover');
    gameState = 'lost';
    player.alive = false;
    showOverlay('Game Over', 'Run out of lives.');
    return;
  }
  respawn();
}

function collectCoins() {
  for (const c of coins) {
    if (c.taken) continue;
    if (rectsOverlap(player, { x: c.x - COIN_R, y: c.y - COIN_R, w: COIN_R * 2, h: COIN_R * 2 })) {
      c.taken = true;
      coinCount++;
      play('coin');
      updateHud();
      if (coinCount >= COINS_TO_WIN && !boss) {
        if (levelIndex < LEVELS.length - 1) {
          play('win');
          gameState = 'playing';
          player.alive = false;
          pendingLevel = levelIndex + 1;
          document.getElementById('restart').textContent = 'Next Level';
          showOverlay('Level ' + (levelIndex + 1) + ' Complete!', 'Collect everything to advance');
        } else {
          play('win');
          gameState = 'won';
          player.alive = false;
          document.getElementById('restart').textContent = 'Play again';
          showOverlay('You Win!', 'All levels cleared.');
        }
      }
    }
  }
}

function updateHud() {
  document.getElementById('level-count').textContent = levelIndex + 1;
  document.getElementById('coin-count').textContent = Math.min(coinCount, COINS_TO_WIN);
  document.getElementById('lives-count').textContent = player.lives;
  const bar = document.getElementById('bossbar');
  const fill = document.getElementById('boss-fill');
  const hpEl = document.getElementById('boss-hp');
  if (boss && boss.active) {
    bar.classList.remove('hidden');
    const frac = Math.max(0, boss.hp / boss.maxHp);
    fill.style.width = (frac * 100) + '%';
    hpEl.textContent = boss.hp + '/' + boss.maxHp;
  } else {
    bar.classList.add('hidden');
  }
}

function showOverlay(title, sub) {
  document.getElementById('overlay-msg').innerHTML =
    title + '<span class="sub">' + sub + '</span>';
  document.getElementById('overlay').classList.remove('hidden');
}

function restart() {
  pendingLevel = null;
  loadLevel(0);
  document.getElementById('restart').textContent = 'Play again';
  document.getElementById('overlay').classList.add('hidden');
}

document.getElementById('restart').addEventListener('click', () => {
  if (pendingLevel !== null) {
    const next = pendingLevel;
    pendingLevel = null;
    loadLevel(next);
    document.getElementById('restart').textContent = 'Play again';
    document.getElementById('overlay').classList.add('hidden');
  } else {
    restart();
  }
});

function update(dt) {
  if (!player.alive) return;
  if (input.shooting) {
    player.shotTimer = (player.shotTimer || 0) - dt;
    if (player.shotTimer <= 0) { fire(); player.shotTimer = SHOT_COOLDOWN; }
  }
  movePlayer(dt);
  // dust particles while running on the ground
  if (player.onGround && Math.abs(player.vx) > 5) {
    const rate = 14;
    const px = player.x + player.w / 2 - player.facing * (player.w * 0.4);
    if (Math.floor(time * rate * 2) !== Math.floor((time - dt) * rate * 2)) {
      particles.push({
        x: px + (Math.random() - 0.5) * 14,
        y: player.y + player.h - 4,
        vx: -player.facing * (30 + Math.random() * 40) + (Math.random() - 0.5) * 20,
        vy: -(20 + Math.random() * 60),
        life: 0.35 + Math.random() * 0.25,
        max: 0.6,
        r: 3 + Math.random() * 4,
        sand: Math.random() < 0.7,
      });
    }
  }
  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt;
  }
  particles = particles.filter((p) => p.life > 0);
  for (const g of ghosts) g.life -= dt;
  ghosts = ghosts.filter((g) => g.life > 0);
  updateBullets(dt);
  updateEnemies(dt);
  updateBoss(dt);
  collectCoins();

  // camera
  const targetX = player.x + player.w / 2 - vw / 2;
  const targetY = player.y + player.h / 2 - vh / 2;
  camX += (targetX - camX) * Math.min(1, dt * 8);
  camY += (targetY - camY) * Math.min(1, dt * 8);
  camX = Math.max(-80, Math.min(LEVEL_W - vw + 80, camX));
  camY = Math.max(GROUND_Y - vh + 140, Math.min(GROUND_Y - 40, camY));

  updateHud();
}

// ----- rendering -----
function drawCoin(x, y, squash) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(squash, 1);
  ctx.fillStyle = '#f7c53b';
  ctx.beginPath();
  ctx.arc(0, 0, COIN_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c89216';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#e0a81f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, COIN_R * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSprite(idx, ox, oy, w, h, frames, frameOutlines) {
  frames = frames || sprites;
  frameOutlines = frameOutlines || outlines;
  // fallback: if run sprites failed to load, draw a clean visible character
  if (!sprites.length) {
    ctx.save();
    ctx.translate(ox + w / 2, oy + h);
    ctx.scale(player.facing, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-w / 2, -h, w, h);
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(0, -h * 0.82, w * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-w * 0.42, -h * 0.68, w * 0.84, h * 0.68);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(-w * 0.42, -h * 0.30, w * 0.84, h * 0.16);
    ctx.restore();
    return;
  }
  const i = Math.floor((idx % frames.length + frames.length) % frames.length);
  const fill = frames[i];
  const out = frameOutlines[i];
  const pad = 4;                       // outline ring added in prep
  const sx = w / fill.width;           // world px per source px
  const sy = h / fill.height;
  ctx.save();
  ctx.translate(ox + w / 2, oy + h);
  ctx.scale(player.facing, 1);
  ctx.drawImage(out, -w / 2 - pad * sx, -h - pad * sy, (fill.width + pad * 2) * sx, (fill.height + pad * 2) * sy);
  ctx.drawImage(fill, -w / 2, -h, w, h);
  ctx.restore();
}

function draw() {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  ctx.save();

  // sky
  const g = ctx.createLinearGradient(0, 0, 0, vh);
  g.addColorStop(0, '#8ee3f5');
  g.addColorStop(0.6, '#b7ecf7');
  g.addColorStop(1, '#d9f6fb');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vw, vh);

  // parallax background image
  if (bgImage) {
    const cov = Math.max(vw / bgImage.width, vh / bgImage.height);
    const bw = bgImage.width * cov;
    const bh = bgImage.height * cov;
    const ox = -(camX * 0.25) % bw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, vw, vh);
    ctx.clip();
    for (let x = ox - bw; x < vw; x += bw) {
      ctx.drawImage(bgImage, x, (vh - bh) / 2, bw, bh);
    }
    ctx.restore();
  }

  ctx.translate(-camX, -camY);

  // platforms
  for (const p of platforms) {
    const isGround = p.h > 100;
    if (isGround) {
      // ground/floor: solid from its top down to the bottom of the world
      ctx.fillStyle = '#d7a860';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      // grass top edge across the whole floor
      ctx.fillStyle = '#7cc24a';
      ctx.fillRect(p.x, p.y, p.w, 10);
      ctx.fillStyle = '#5ea83a';
      ctx.fillRect(p.x, p.y, p.w, 4);
      // subtle sand shading
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(p.x, p.y + 10, p.w, 6);
    } else {
      // floating wooden platform
      ctx.fillStyle = '#b06f36';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#e8b15f';
      ctx.fillRect(p.x, p.y, p.w, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(p.x, p.y + p.h - 8, p.w, 8);
    }
  }

  // coins
  for (const c of coins) {
    if (c.taken) continue;
    const squash = Math.max(0.25, Math.abs(Math.cos(time * 3)));
    drawCoin(c.x, c.y, squash);
  }

  // bullets
  ctx.fillStyle = '#ffe14d';
  for (const b of bullets) {
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // dust particles
  for (const p of particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.sand ? 'rgba(215,168,96,' + a * 0.55 + ')' : 'rgba(255,255,255,' + a * 0.6 + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.6 + 0.4 * a), 0, Math.PI * 2);
    ctx.fill();
  }

  // enemies
  for (const e of enemies) {
    if (!e.alive) continue;
    const eb = enemyBox(e);
    const ex = eb.x + eb.w / 2 + e.dir * Math.sin(time * 12) * 4;
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(ex, eb.y + eb.h * 0.55, eb.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex - 6, eb.y + eb.h * 0.5, 5, 0, Math.PI * 2);
    ctx.arc(ex + 6, eb.y + eb.h * 0.5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(ex - 6 + e.dir * 2, eb.y + eb.h * 0.5, 2.2, 0, Math.PI * 2);
    ctx.arc(ex + 6 + e.dir * 2, eb.y + eb.h * 0.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // boss
  if (boss && boss.active) {
    const bb = bossBox();
    const bx = bb.x + bb.w / 2 + boss.dir * Math.sin(time * 10) * 5;
    const byc = bb.y + bb.h * 0.5;
    // body
    ctx.fillStyle = '#8e2fa8';
    ctx.beginPath();
    ctx.ellipse(bx, byc, bb.w / 2, bb.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6d1f83';
    ctx.beginPath();
    ctx.ellipse(bx, byc + bb.h * 0.2, bb.w * 0.55, bb.h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bx - 40 + boss.dir * 6, byc - 20, 20, 0, Math.PI * 2);
    ctx.arc(bx + 40 + boss.dir * 6, byc - 20, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(bx - 40 + boss.dir * 12, byc - 20, 8, 0, Math.PI * 2);
    ctx.arc(bx + 40 + boss.dir * 12, byc - 20, 8, 0, Math.PI * 2);
    ctx.fill();
    // flashes red when hit recently
    if (boss.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(bx, byc, bb.w / 2, bb.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // health bar
    const barW = bb.w + 60, barH = 18;
    const barX = bx - barW / 2, barY = bb.y - 34;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    const frac = Math.max(0, boss.hp / boss.maxHp);
    ctx.fillStyle = frac > 0.5 ? '#3ee04f' : frac > 0.25 ? '#f5b524' : '#e03c3c';
    ctx.fillRect(barX + 2, barY + 2, (barW - 4) * frac, barH - 4);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  // dash ghosts (afterimage trail)
  ctx.globalCompositeOperation = 'lighter';
  for (const g of ghosts) {
    const a = Math.max(0, g.life / g.max);
    ctx.globalAlpha = a * 0.55;
    ctx.drawImage(g.c, g.fx - g.gw / 2, g.fy - g.gh);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // player
  if (player.alive) {
    const ph = PLAYER_H;
    const pw = sprAspect ? ph * sprAspect : player.w;
    // soft drop shadow so the player reads against the sand / sky
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(player.x + player.w / 2, player.y + ph, pw * 0.42, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    drawSprite(player.onGround ? player.anim : player.jumpT,
      player.x + player.w / 2 - pw / 2, player.y, pw, ph,
      player.onGround ? null : jumpSprites, player.onGround ? null : jumpOutlines);
    // jump pips showing remaining jumps
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < MAX_JUMPS; i++) {
      ctx.beginPath();
      ctx.arc(player.x + player.w / 2 - 12 + i * 10, player.y - 10, 3, 0, Math.PI * 2);
      ctx.fill();
      if (i < player.jumpsUsed) {
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

// ----- load assets & start -----
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function start() {
  const frameFiles = ['uploads/run__1_.png', 'uploads/run__2_.png', 'uploads/run__3_.png', 'uploads/run__4_.png', 'uploads/run__5_.png'];
  const jumpFiles = ['uploads/jump__1_.png', 'uploads/jump__2_.png', 'uploads/jump__3_.png', 'uploads/jump__4_.png', 'uploads/jump__5_.png'];
  try {
    const frames = await Promise.all(frameFiles.map(loadImage));
    prepSprites(frames);
    const jumps = await Promise.all(jumpFiles.map(loadImage));
    prepJumpSprites(jumps);
  } catch (e) {
    console.error('failed to load sprites', e);
  }
  try {
    bgImage = await loadImage('beach-background-image-style-pixel-art.png');
  } catch (e) {
    console.error('failed to load bg', e);
  }

  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.033);
    time += dt;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

start();
