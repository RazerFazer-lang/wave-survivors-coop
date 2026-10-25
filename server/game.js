// Autoritative Spiellogik: Räume, Wellen, Gegner, Projektile, Loot, Level-ups.
// Der Client schickt nur Eingaben; alles Spielrelevante passiert hier.

import {
  SLOTS,
  CLASSES,
  ENEMIES,
  UPGRADES,
  UPGRADES_BY_ID,
  emptyAdd,
  rollItem,
  itemPower,
  publicMeta,
} from './content.js';

const SIM_HZ = 60;
const SEND_EVERY = 3; // => 20 Snapshots/s
export const ARENA = { w: 3200, h: 2400 };
const MAX_ENEMIES = 240;
const VIEW_R = 1300;
const INV_CAP = 24;
const REVIVE_TIME = 3;
const DOWN_TIME = 20;
const INTERMISSION = 12;
const FIRST_WAVE_DELAY = 5;
const GRID_CELL = 96;
const MAX_PLAYERS = 8;

let nextId = 1;
const newId = () => nextId++;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r1 = (v) => Math.round(v * 10) / 10;

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function sanitizeName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (s || 'Held').slice(0, 16);
}

function sanitizeRoom(raw) {
  const s = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return (s || 'LOBBY').slice(0, 8);
}

// ---------------------------------------------------------------- Stats

function computeStats(p) {
  const cls = CLASSES[p.cls];
  const base = cls.base;
  const add = emptyAdd();

  for (const slot of SLOTS) {
    const it = p.equipped[slot];
    if (!it) continue;
    for (const a of it.affixes) {
      if (a.id in add) add[a.id] += a.value;
    }
  }
  for (const [id, stacks] of Object.entries(p.upgradeStacks)) {
    const u = UPGRADES_BY_ID[id];
    if (!u) continue;
    for (const [k, v] of Object.entries(u.mod)) {
      if (k in add) add[k] += v * stacks;
    }
  }

  return {
    maxHp: Math.round(base.maxHp + add.maxHpFlat),
    moveSpeed: base.moveSpeed * (1 + add.moveSpeedPct / 100),
    damage: 1 + add.damagePct / 100,
    attackSpeed: 1 + add.attackSpeedPct / 100,
    crit: clamp(base.crit + add.critPct / 100, 0, 0.85),
    critDmg: base.critDmg + add.critDmgPct / 100,
    armor: base.armor + add.armorFlat,
    pickup: base.pickup * (1 + add.pickupPct / 100),
    regen: base.regen + add.regenFlat,
    area: 1 + add.areaPct / 100,
    projectiles: Math.floor(add.projFlat),
    luck: add.luckFlat,
    pierce: Math.floor(add.pierceFlat),
    explode: add.explodeFlat > 0,
    boom: 1 + add.boomPct / 100,
    lifesteal: add.lifestealFlat,
    auraHeal: add.auraHealFlat,
    thorns: add.thornsFlat,
    dr: base.dr || 0,
  };
}

function refreshStats(p) {
  const before = p.stats ? p.stats.maxHp : null;
  p.stats = computeStats(p);
  if (before !== null && p.stats.maxHp > before) p.hp += p.stats.maxHp - before;
  p.hp = clamp(p.hp, 0, p.stats.maxHp);
  p.statsDirty = true;
}

function xpForLevel(lv) {
  return Math.round(6 + lv * 5 + lv * lv * 0.7);
}

// ---------------------------------------------------------------- Räume

function makeRoom(code) {
  return {
    code,
    state: 'lobby', // lobby | running | over
    players: new Map(), // playerId -> player
    enemies: [],
    projectiles: [],
    pickups: [],
    fx: [],
    wave: 0,
    waveState: 'intermission',
    waveTimer: 0,
    spawnQueue: [],
    spawnTimer: 0,
    time: 0,
    sendCounter: 0,
    emptyAt: Date.now(),
    lobbyDirty: true,
    grid: new Map(),
    result: null,
  };
}

function makePlayer(client, name) {
  return {
    id: client.id,
    client,
    name,
    cls: null,
    ready: false,
    inGame: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 0,
    hp: 1,
    alive: true,
    downed: false,
    downTimer: 0,
    reviveProgress: 0,
    invuln: 0,
    hitFlash: 0,
    dashCd: 0,
    dashTime: 0,
    atkCd: 0,
    abCd: 0,
    lv: 1,
    xp: 0,
    xpNext: xpForLevel(1),
    gold: 0,
    kills: 0,
    dmgDealt: 0,
    pendingLevelUps: 0,
    levelOptions: null,
    inv: [],
    equipped: { weapon: null, armor: null, amulet: null, ring: null },
    upgradeStacks: {},
    stats: null,
    input: { mx: 0, my: 0, dash: false },
    invDirty: true,
    statsDirty: true,
  };
}

function resetPlayerForRun(p) {
  p.cls = p.cls || 'warrior';
  p.lv = 1;
  p.xp = 0;
  p.xpNext = xpForLevel(1);
  p.gold = 0;
  p.kills = 0;
  p.dmgDealt = 0;
  p.inv = [];
  p.equipped = { weapon: null, armor: null, amulet: null, ring: null };
  p.upgradeStacks = {};
  p.pendingLevelUps = 0;
  p.levelOptions = null;
  p.alive = true;
  p.downed = false;
  p.downTimer = 0;
  p.reviveProgress = 0;
  p.invuln = 1.5;
  p.atkCd = 0;
  p.abCd = 0;
  p.dashCd = 0;
  p.dashTime = 0;
  p.inGame = true;
  p.stats = null;
  refreshStats(p);
  p.hp = p.stats.maxHp;
  const a = Math.random() * Math.PI * 2;
  p.x = ARENA.w / 2 + Math.cos(a) * 60;
  p.y = ARENA.h / 2 + Math.sin(a) * 60;
  p.vx = 0;
  p.vy = 0;
  p.invDirty = true;
  p.statsDirty = true;
}

// ---------------------------------------------------------------- Helfer

function alivePlayers(room) {
  const out = [];
  for (const p of room.players.values()) {
    if (p.inGame && p.alive && !p.downed) out.push(p);
  }
  return out;
}

function inGamePlayers(room) {
  const out = [];
  for (const p of room.players.values()) if (p.inGame) out.push(p);
  return out;
}

function buildGrid(enemies) {
  const map = new Map();
  for (const e of enemies) {
    if (e.dead) continue;
    const key = Math.floor(e.x / GRID_CELL) + ',' + Math.floor(e.y / GRID_CELL);
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(e);
  }
  return map;
}

function queryEnemies(grid, x, y, r) {
  const out = [];
  const x0 = Math.floor((x - r) / GRID_CELL);
  const x1 = Math.floor((x + r) / GRID_CELL);
  const y0 = Math.floor((y - r) / GRID_CELL);
  const y1 = Math.floor((y + r) / GRID_CELL);
  for (let i = x0; i <= x1; i++) {
    for (let j = y0; j <= y1; j++) {
      const arr = grid.get(i + ',' + j);
      if (arr) for (const e of arr) out.push(e);
    }
  }
  return out;
}

function nearestEnemy(room, x, y, maxR) {
  let best = null;
  let bestD = maxR * maxR;
  for (const e of room.enemies) {
    if (e.dead) continue;
    const d = dist2(x, y, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function nearestTargetPlayer(room, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const p of room.players.values()) {
    if (!p.inGame || !p.alive || p.downed) continue;
    const d = dist2(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------- Schaden

function healPlayer(p, amount) {
  if (!p.alive || p.downed) return;
  p.hp = clamp(p.hp + amount, 0, p.stats.maxHp);
}

function hurtPlayer(room, p, raw) {
  if (!p.inGame || !p.alive || p.downed || p.invuln > 0) return;
  const s = p.stats;
  let d = raw * (1 - s.dr);
  d *= 100 / (100 + Math.max(0, s.armor));
  d = Math.max(1, Math.round(d));
  p.hp -= d;
  p.hitFlash = 0.22;
  room.fx.push({ k: 'ph', x: r1(p.x), y: r1(p.y - 28), v: d });
  if (p.hp <= 0) {
    p.hp = 0;
    p.downed = true;
    p.downTimer = DOWN_TIME;
    p.reviveProgress = 0;
    room.fx.push({ k: 'down', x: r1(p.x), y: r1(p.y), n: p.name });
  }
}

function hurtEnemy(room, e, raw, source, canCrit = true) {
  if (e.dead) return;
  let dmg = raw;
  let crit = false;
  if (source && canCrit && Math.random() < source.stats.crit) {
    crit = true;
    dmg *= source.stats.critDmg;
  }
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg;
  e.flash = 0.12;
  if (source) {
    source.dmgDealt += dmg;
    if (source.stats.lifesteal > 0) healPlayer(source, source.stats.lifesteal);
  }
  room.fx.push({ k: 'h', x: r1(e.x), y: r1(e.y - e.r - 4), v: dmg, c: crit ? 1 : 0 });
  if (e.hp <= 0) killEnemy(room, e, source);
}

function killEnemy(room, e, source) {
  e.dead = true;
  room.fx.push({ k: 'die', x: r1(e.x), y: r1(e.y), t: e.type, r: e.r });
  if (source) source.kills++;

  const luck = source ? source.stats.luck : 0;
  const level = Math.max(1, room.wave);

  // XP immer
  room.pickups.push(makePickup('xp', e.x, e.y, e.xp));
  // Gold häufig
  if (Math.random() < 0.38) {
    room.pickups.push(makePickup('gold', e.x, e.y, Math.max(1, Math.round(e.xp * rand(0.8, 1.8)))));
  }
  // Heiltrank selten
  if (Math.random() < 0.05) room.pickups.push(makePickup('hp', e.x, e.y, 18));

  // Loot
  let itemChance = 0.035 + luck * 0.004;
  let minRarity = 0;
  if (e.elite) {
    itemChance = 0.4;
    minRarity = 1;
  }
  if (e.boss) {
    itemChance = 1;
    minRarity = 2;
  }
  if (Math.random() < itemChance) {
    const item = rollItem(level, luck, minRarity);
    room.pickups.push(makePickup('item', e.x, e.y, 0, item));
  }
  if (e.boss) {
    // Boss wirft zusätzlich für jeden Spieler etwas ab
    for (let i = 0; i < inGamePlayers(room).length; i++) {
      const item = rollItem(level, luck, 1);
      room.pickups.push(makePickup('item', e.x + rand(-40, 40), e.y + rand(-40, 40), 0, item));
    }
  }
}

function makePickup(kind, x, y, val, item = null) {
  return {
    id: newId(),
    kind,
    x: clamp(x + rand(-10, 10), 10, ARENA.w - 10),
    y: clamp(y + rand(-10, 10), 10, ARENA.h - 10),
    val,
    item,
    life: kind === 'item' ? 90 : 45,
    taken: false,
  };
}

function explode(room, x, y, radius, dmg, source, hostile) {
  room.fx.push({ k: 'boom', x: r1(x), y: r1(y), r: Math.round(radius) });
  if (hostile) {
    for (const p of room.players.values()) {
      if (!p.inGame || !p.alive || p.downed) continue;
      if (dist2(x, y, p.x, p.y) <= radius * radius) hurtPlayer(room, p, dmg);
    }
    return;
  }
  const near = queryEnemies(room.grid, x, y, radius + 40);
  for (const e of near) {
    if (e.dead) continue;
    const rr = radius + e.r;
    if (dist2(x, y, e.x, e.y) <= rr * rr) hurtEnemy(room, e, dmg, source);
  }
}

// ---------------------------------------------------------------- Angriffe

function spawnProjectile(room, cfg) {
  room.projectiles.push({
    id: newId(),
    x: cfg.x,
    y: cfg.y,
    vx: cfg.vx,
    vy: cfg.vy,
    r: cfg.r ?? 6,
    dmg: cfg.dmg,
    life: cfg.life ?? 1.6,
    hostile: !!cfg.hostile,
    owner: cfg.owner ?? null,
    pierce: cfg.pierce ?? 0,
    hits: null,
    explode: cfg.explode ?? 0,
    type: cfg.type ?? 'bolt',
    color: cfg.color ?? '#ffffff',
    dead: false,
  });
}

function cleave(room, p, angle, range, arc, dmg) {
  const near = queryEnemies(room.grid, p.x, p.y, range + 30);
  const half = arc / 2;
  for (const e of near) {
    if (e.dead) continue;
    const rr = range + e.r;
    if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
    if (arc < Math.PI * 2) {
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      let d = Math.abs(a - angle);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d > half) continue;
    }
    hurtEnemy(room, e, dmg, p);
  }
  room.fx.push({
    k: 'cleave',
    x: r1(p.x),
    y: r1(p.y),
    a: r1(angle),
    r: Math.round(range),
    w: r1(arc),
    c: CLASSES[p.cls].color,
  });
}

function playerAttack(room, p) {
  const cls = CLASSES[p.cls];
  const w = cls.weapon;
  const s = p.stats;
  const target = nearestEnemy(room, p.x, p.y, 1000);

  if (w.kind === 'melee') {
    if (!target) return false;
    const ang = Math.atan2(target.y - p.y, target.x - p.x);
    p.facing = ang;
    cleave(room, p, ang, w.range * s.area, w.arc, w.dmg * s.damage);
    return true;
  }

  if (w.kind === 'nova') {
    if (!target) return false;
    const radius = w.radius * s.area;
    const reach = radius + target.r;
    if (dist2(p.x, p.y, target.x, target.y) > reach * reach) return false;
    cleave(room, p, 0, radius, Math.PI * 2, w.dmg * s.damage);
    room.fx.push({ k: 'nova', x: r1(p.x), y: r1(p.y), r: Math.round(radius), c: cls.color });
    return true;
  }

  if (!target) return false;
  const baseAng = Math.atan2(target.y - p.y, target.x - p.x);
  p.facing = baseAng;
  const count = 1 + s.projectiles;
  const spread = 0.13;
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * spread;
    const a = baseAng + off;
    if (w.kind === 'arrow') {
      spawnProjectile(room, {
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * w.speed,
        vy: Math.sin(a) * w.speed,
        r: 5,
        dmg: w.dmg * s.damage,
        life: w.range / w.speed,
        owner: p,
        pierce: (w.pierce ?? 0) + s.pierce,
        explode: s.explode ? 48 * s.area * s.boom : 0,
        type: 'arrow',
        color: cls.color,
      });
    } else {
      spawnProjectile(room, {
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * w.speed,
        vy: Math.sin(a) * w.speed,
        r: 9,
        dmg: w.dmg * s.damage,
        life: w.range / w.speed,
        owner: p,
        pierce: s.pierce,
        explode: w.boom * s.area * s.boom,
        type: 'orb',
        color: cls.color,
      });
    }
  }
  return true;
}

function playerAbility(room, p) {
  const cls = CLASSES[p.cls];
  const ab = cls.ability;
  const s = p.stats;

  if (p.cls === 'warrior') {
    const t = nearestEnemy(room, p.x, p.y, ab.range + 60);
    if (!t) return false;
    cleave(room, p, 0, ab.range * s.area, Math.PI * 2, ab.dmg * s.damage);
    room.fx.push({ k: 'nova', x: r1(p.x), y: r1(p.y), r: Math.round(ab.range * s.area), c: cls.color });
    return true;
  }

  if (p.cls === 'ranger') {
    const t = nearestEnemy(room, p.x, p.y, 900);
    if (!t) return false;
    const n = ab.count + s.projectiles;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      spawnProjectile(room, {
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * 520,
        vy: Math.sin(a) * 520,
        r: 5,
        dmg: ab.dmg * s.damage,
        life: 1.3,
        owner: p,
        pierce: 2 + s.pierce,
        explode: s.explode ? 48 * s.area : 0,
        type: 'arrow',
        color: cls.color,
      });
    }
    room.fx.push({ k: 'nova', x: r1(p.x), y: r1(p.y), r: 70, c: cls.color });
    return true;
  }

  if (p.cls === 'mage') {
    const near = queryEnemies(room.grid, p.x, p.y, 520)
      .filter((e) => !e.dead)
      .sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
    if (!near.length) return false;
    for (let i = 0; i < ab.count; i++) {
      const e = near[Math.min(i, near.length - 1)];
      explode(room, e.x, e.y, ab.boom * s.area * s.boom, ab.dmg * s.damage, p, false);
    }
    return true;
  }

  // Kleriker: Segen
  const allies = inGamePlayers(room).filter((a) => a.alive && !a.downed);
  for (const a of allies) {
    healPlayer(a, a.stats.maxHp * ab.healPct);
    a.invuln = Math.max(a.invuln, ab.shield);
    room.fx.push({ k: 'bless', x: r1(a.x), y: r1(a.y) });
  }
  return true;
}

// ---------------------------------------------------------------- Level-ups

function grantXp(room, p, amount) {
  p.xp += amount;
  let guard = 0;
  while (p.xp >= p.xpNext && guard++ < 50) {
    p.xp -= p.xpNext;
    p.lv++;
    p.xpNext = xpForLevel(p.lv);
    p.pendingLevelUps++;
    room.fx.push({ k: 'lvl', x: r1(p.x), y: r1(p.y) });
  }
  if (p.pendingLevelUps > 0 && !p.levelOptions) offerLevelUp(p);
}

function offerLevelUp(p) {
  const pool = UPGRADES.filter((u) => {
    if (u.cls && !u.cls.includes(p.cls)) return false;
    const stacks = p.upgradeStacks[u.id] || 0;
    return stacks < u.max;
  });
  if (!pool.length) {
    // Nichts mehr zu lernen -> Gold als Trostpreis
    p.pendingLevelUps = 0;
    p.gold += 25;
    return;
  }
  const options = [];
  const copy = pool.slice();
  while (options.length < 3 && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    const u = copy.splice(i, 1)[0];
    options.push({ id: u.id, name: u.name, desc: u.desc, stacks: p.upgradeStacks[u.id] || 0, max: u.max });
  }
  p.levelOptions = options;
  send(p.client, { t: 'levelup', lv: p.lv, options, pending: p.pendingLevelUps });
}

function chooseUpgrade(p, idx) {
  if (!p.levelOptions || !Number.isInteger(idx)) return;
  const opt = p.levelOptions[idx];
  if (!opt) return;
  const u = UPGRADES_BY_ID[opt.id];
  if (!u) return;
  const stacks = p.upgradeStacks[u.id] || 0;
  if (stacks >= u.max) return;
  p.upgradeStacks[u.id] = stacks + 1;
  refreshStats(p);
  if (u.heal) healPlayer(p, u.heal);
  p.levelOptions = null;
  p.pendingLevelUps = Math.max(0, p.pendingLevelUps - 1);
  send(p.client, { t: 'levelupdone' });
  if (p.pendingLevelUps > 0) offerLevelUp(p);
}

// ---------------------------------------------------------------- Inventar

function giveItem(p, item) {
  const cur = p.equipped[item.slot];
  if (!cur) {
    p.equipped[item.slot] = item;
    refreshStats(p);
    p.invDirty = true;
    return 'equipped';
  }
  if (p.inv.length >= INV_CAP) {
    // Inventar voll: schwächstes Item im Rucksack ersetzen, wenn das neue besser ist
    let worstIdx = 0;
    for (let i = 1; i < p.inv.length; i++) {
      if (itemPower(p.inv[i]) < itemPower(p.inv[worstIdx])) worstIdx = i;
    }
    if (itemPower(p.inv[worstIdx]) >= itemPower(item)) {
      p.gold += 10;
      return 'sold';
    }
    p.inv.splice(worstIdx, 1);
  }
  p.inv.push(item);
  p.invDirty = true;
  return 'stored';
}

function equipItem(p, itemId) {
  const idx = p.inv.findIndex((i) => i.id === itemId);
  if (idx < 0) return;
  const item = p.inv[idx];
  const cur = p.equipped[item.slot];
  p.inv.splice(idx, 1);
  p.equipped[item.slot] = item;
  if (cur) p.inv.push(cur);
  refreshStats(p);
  p.invDirty = true;
}

function dropItem(p, itemId) {
  const idx = p.inv.findIndex((i) => i.id === itemId);
  if (idx >= 0) {
    p.gold += 10;
    p.inv.splice(idx, 1);
    p.invDirty = true;
    return;
  }
  for (const slot of SLOTS) {
    if (p.equipped[slot] && p.equipped[slot].id === itemId) {
      p.gold += 10;
      p.equipped[slot] = null;
      refreshStats(p);
      p.invDirty = true;
      return;
    }
  }
}

// ---------------------------------------------------------------- Wellen

function spawnEnemy(room, type, elite) {
  if (room.enemies.length >= MAX_ENEMIES) return;
  const def = ENEMIES[type];
  if (!def) return;
  const n = Math.max(1, inGamePlayers(room).length);
  const hpMult = (1 + 0.16 * (room.wave - 1)) * (1 + 0.45 * (n - 1));
  const dmgMult = 1 + 0.07 * (room.wave - 1);

  const anchor = pickOne(alivePlayers(room)) || { x: ARENA.w / 2, y: ARENA.h / 2 };
  const a = Math.random() * Math.PI * 2;
  const d = rand(760, 980);
  const x = clamp(anchor.x + Math.cos(a) * d, 30, ARENA.w - 30);
  const y = clamp(anchor.y + Math.sin(a) * d, 30, ARENA.h - 30);

  const isElite = !!elite;
  const maxHp = Math.round(def.hp * hpMult * (isElite ? 2.4 : 1));
  room.enemies.push({
    id: newId(),
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    hp: maxHp,
    maxHp,
    speed: def.speed * (isElite ? 0.92 : 1) * rand(0.94, 1.06),
    dmg: def.dmg * dmgMult * (isElite ? 1.3 : 1),
    r: def.r * (isElite ? 1.25 : 1),
    xp: Math.round(def.xp * (isElite ? 2.5 : 1)),
    elite: isElite,
    boss: !!def.boss,
    ranged: def.ranged || null,
    rangedCd: def.ranged ? rand(0.5, def.ranged.cd) : 0,
    touchCd: 0,
    flash: 0,
    dead: false,
  });
}

function startWave(room) {
  room.wave++;
  room.waveState = 'combat';
  room.waveTimer = 0;

  const n = Math.max(1, inGamePlayers(room).length);
  let budget = Math.round((10 + room.wave * 5.5) * (1 + 0.35 * (n - 1)));
  const pool = Object.entries(ENEMIES).filter(([, d]) => !d.boss && d.minWave <= room.wave);
  const queue = [];
  let guard = 0;
  while (budget > 0 && guard++ < 400 && pool.length) {
    const [key, def] = pickOne(pool);
    const count = Math.max(1, Math.min(Math.floor(budget / def.cost) || 1, 2 + Math.floor(Math.random() * 4)));
    queue.push({ type: key, count });
    budget -= count * def.cost;
  }
  if (room.wave % 5 === 0) {
    queue.push({ type: 'golem', count: 1 + Math.floor(room.wave / 15) });
  }
  room.spawnQueue = queue;
  room.spawnTimer = 0.8;
  broadcast(room, { t: 'wave', wave: room.wave });
}

function finishWave(room) {
  room.waveState = 'intermission';
  room.waveTimer = INTERMISSION;
  const giveLoot = room.wave % 3 === 0;
  for (const p of inGamePlayers(room)) {
    if (!p.alive) {
      // Zwischen den Wellen stehen Gefallene wieder auf
      p.alive = true;
      p.downed = false;
      p.hp = Math.round(p.stats.maxHp * 0.5);
      p.invuln = 2;
      const anchor = pickOne(alivePlayers(room)) || { x: ARENA.w / 2, y: ARENA.h / 2 };
      p.x = clamp(anchor.x + rand(-60, 60), 20, ARENA.w - 20);
      p.y = clamp(anchor.y + rand(-60, 60), 20, ARENA.h - 20);
    } else if (!p.downed) {
      healPlayer(p, p.stats.maxHp * 0.2);
    }
    if (giveLoot) {
      const item = rollItem(room.wave, p.stats.luck, 1);
      const where = giveItem(p, item);
      send(p.client, { t: 'loot', item, where });
    }
  }
  broadcast(room, { t: 'wavedone', wave: room.wave, next: INTERMISSION });
}

// ---------------------------------------------------------------- Update

function updatePlayers(room, dt) {
  for (const p of room.players.values()) {
    if (!p.inGame) continue;
    const s = p.stats;

    p.invuln = Math.max(0, p.invuln - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.abCd = Math.max(0, p.abCd - dt);

    if (!p.alive) continue;

    if (p.downed) {
      p.downTimer -= dt;
      // Wiederbelebung durch Verbündete
      let reviver = null;
      for (const a of room.players.values()) {
        if (a === p || !a.inGame || !a.alive || a.downed) continue;
        if (dist2(a.x, a.y, p.x, p.y) < 75 * 75) {
          reviver = a;
          break;
        }
      }
      if (reviver) {
        p.reviveProgress += dt;
        if (p.reviveProgress >= REVIVE_TIME) {
          p.downed = false;
          p.reviveProgress = 0;
          p.hp = Math.round(s.maxHp * 0.5);
          p.invuln = 2;
          room.fx.push({ k: 'revive', x: r1(p.x), y: r1(p.y), n: p.name });
        }
      } else {
        p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.5);
      }
      if (p.downTimer <= 0) {
        p.alive = false;
        p.downed = false;
        room.fx.push({ k: 'dead', x: r1(p.x), y: r1(p.y), n: p.name });
      }
      continue;
    }

    // Bewegung
    let mx = p.input.mx;
    let my = p.input.my;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    if (p.input.dash && p.dashCd <= 0 && (mx || my)) {
      p.dashCd = 3;
      p.dashTime = 0.18;
      p.invuln = Math.max(p.invuln, 0.3);
      room.fx.push({ k: 'dash', x: r1(p.x), y: r1(p.y), c: CLASSES[p.cls].color });
    }
    p.input.dash = false;
    const speed = s.moveSpeed * (p.dashTime > 0 ? 3.4 : 1);
    p.vx = mx * speed;
    p.vy = my * speed;
    p.x = clamp(p.x + p.vx * dt, 18, ARENA.w - 18);
    p.y = clamp(p.y + p.vy * dt, 18, ARENA.h - 18);
    if (mx || my) p.facing = Math.atan2(my, mx);

    // Regeneration
    if (s.regen > 0) healPlayer(p, s.regen * dt);

    // Heil-Aura (Kleriker passiv + Upgrade)
    const aura = (p.cls === 'cleric' ? 1.2 : 0) + s.auraHeal;
    if (aura > 0) {
      for (const a of room.players.values()) {
        if (!a.inGame || !a.alive || a.downed) continue;
        if (dist2(a.x, a.y, p.x, p.y) < 170 * 170) healPlayer(a, aura * dt);
      }
    }

    // Angriff + Fähigkeit (beides automatisch, wie im Genre üblich)
    if (p.atkCd <= 0) {
      const cd = CLASSES[p.cls].weapon.cd / s.attackSpeed;
      p.atkCd = playerAttack(room, p) ? cd : 0.1;
    }
    if (p.abCd <= 0) {
      p.abCd = playerAbility(room, p) ? CLASSES[p.cls].ability.cd : 0.25;
    }

    // Aufsammeln (mit Magnet-Radius)
    const pr = s.pickup;
    for (const pk of room.pickups) {
      if (pk.taken) continue;
      const d2 = dist2(pk.x, pk.y, p.x, p.y);
      if (d2 < pr * pr) {
        const d = Math.sqrt(d2) || 1;
        const pull = 420 * dt;
        pk.x += ((p.x - pk.x) / d) * pull;
        pk.y += ((p.y - pk.y) / d) * pull;
      }
      if (d2 < 26 * 26) {
        pk.taken = true;
        if (pk.kind === 'xp') grantXp(room, p, pk.val);
        else if (pk.kind === 'gold') p.gold += pk.val;
        else if (pk.kind === 'hp') healPlayer(p, pk.val);
        else if (pk.kind === 'item') {
          const where = giveItem(p, pk.item);
          send(p.client, { t: 'loot', item: pk.item, where });
        }
        room.fx.push({ k: 'pick', x: r1(pk.x), y: r1(pk.y), p: pk.kind });
      }
    }
  }
}

function updateEnemies(room, dt) {
  const grid = room.grid;
  for (const e of room.enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    e.touchCd = Math.max(0, e.touchCd - dt);

    const target = nearestTargetPlayer(room, e.x, e.y);
    if (target) {
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const keepDist = e.ranged ? e.ranged.range * 0.6 : 0;
      let dir = 1;
      if (e.ranged && d < keepDist * 0.7) dir = -0.6;
      e.vx = (dx / d) * e.speed * dir;
      e.vy = (dy / d) * e.speed * dir;

      if (e.ranged) {
        e.rangedCd -= dt;
        if (e.rangedCd <= 0 && d < e.ranged.range) {
          e.rangedCd = e.ranged.cd;
          const volley = e.ranged.volley || 1;
          const spread = e.ranged.spread ?? 0.25;
          const baseAng = Math.atan2(dy, dx);
          for (let i = 0; i < volley; i++) {
            const a =
              volley === 1 ? baseAng : baseAng + (i - (volley - 1) / 2) * (spread / Math.max(1, volley - 1));
            spawnProjectile(room, {
              x: e.x,
              y: e.y,
              vx: Math.cos(a) * e.ranged.speed,
              vy: Math.sin(a) * e.ranged.speed,
              r: 7,
              dmg: e.ranged.dmg * (1 + 0.06 * (room.wave - 1)),
              life: e.ranged.range / e.ranged.speed,
              hostile: true,
              type: 'eshot',
              color: ENEMIES[e.type].color,
            });
          }
        }
      }
    } else {
      e.vx *= 0.9;
      e.vy *= 0.9;
    }

    // Separation, damit Gegner nicht exakt stapeln
    const near = queryEnemies(grid, e.x, e.y, e.r * 2 + 12);
    let sx = 0;
    let sy = 0;
    for (const o of near) {
      if (o === e || o.dead) continue;
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      const d2 = dx * dx + dy * dy;
      const minD = e.r + o.r;
      if (d2 > 0.01 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) / minD;
        sx += (dx / d) * push;
        sy += (dy / d) * push;
      }
    }
    e.x = clamp(e.x + (e.vx + sx * 120) * dt, 12, ARENA.w - 12);
    e.y = clamp(e.y + (e.vy + sy * 120) * dt, 12, ARENA.h - 12);

    // Kontaktschaden
    if (target && e.touchCd <= 0) {
      const rr = e.r + 18;
      if (dist2(e.x, e.y, target.x, target.y) < rr * rr) {
        e.touchCd = 0.8;
        hurtPlayer(room, target, e.dmg);
        if (target.stats.thorns > 0 && target.alive && !target.downed) {
          hurtEnemy(room, e, target.stats.thorns, target, false);
        }
      }
    }
  }
  room.enemies = room.enemies.filter((e) => !e.dead);
}

function updateProjectiles(room, dt) {
  for (const pr of room.projectiles) {
    if (pr.dead) continue;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;

    if (pr.x < 0 || pr.y < 0 || pr.x > ARENA.w || pr.y > ARENA.h || pr.life <= 0) {
      pr.dead = true;
      if (pr.explode > 0) explode(room, pr.x, pr.y, pr.explode, pr.dmg * 0.7, pr.owner, pr.hostile);
      continue;
    }

    if (pr.hostile) {
      for (const p of room.players.values()) {
        if (!p.inGame || !p.alive || p.downed || p.invuln > 0) continue;
        const rr = pr.r + 18;
        if (dist2(pr.x, pr.y, p.x, p.y) < rr * rr) {
          hurtPlayer(room, p, pr.dmg);
          pr.dead = true;
          break;
        }
      }
      continue;
    }

    const near = queryEnemies(room.grid, pr.x, pr.y, pr.r + 40);
    for (const e of near) {
      if (e.dead) continue;
      const rr = pr.r + e.r;
      if (dist2(pr.x, pr.y, e.x, e.y) > rr * rr) continue;
      if (!pr.hits) pr.hits = new Set();
      if (pr.hits.has(e.id)) continue;
      pr.hits.add(e.id);
      hurtEnemy(room, e, pr.dmg, pr.owner);
      if (pr.explode > 0) {
        explode(room, pr.x, pr.y, pr.explode, pr.dmg * 0.7, pr.owner, false);
        pr.dead = true;
        break;
      }
      if (pr.pierce > 0) {
        pr.pierce--;
      } else {
        pr.dead = true;
        break;
      }
    }
  }
  room.projectiles = room.projectiles.filter((pr) => !pr.dead);
}

function updatePickups(room, dt) {
  for (const pk of room.pickups) {
    if (pk.taken) continue;
    pk.life -= dt;
    if (pk.life <= 0) pk.taken = true;
  }
  room.pickups = room.pickups.filter((pk) => !pk.taken);
}

function updateWaves(room, dt) {
  if (room.waveState === 'intermission') {
    room.waveTimer -= dt;
    if (room.waveTimer <= 0) startWave(room);
    return;
  }

  if (room.spawnQueue.length) {
    room.spawnTimer -= dt;
    if (room.spawnTimer <= 0) {
      room.spawnTimer = 0.45;
      const group = room.spawnQueue[0];
      const batch = Math.min(group.count, 4);
      const eliteChance = Math.min(0.25, 0.05 + room.wave * 0.01);
      const def = ENEMIES[group.type];
      for (let i = 0; i < batch; i++) {
        spawnEnemy(room, group.type, !def.boss && Math.random() < eliteChance);
      }
      group.count -= batch;
      if (group.count <= 0) room.spawnQueue.shift();
    }
    return;
  }

  if (!room.enemies.length) finishWave(room);
}

function checkGameOver(room) {
  const players = inGamePlayers(room);
  if (!players.length) return;
  if (players.some((p) => p.alive)) return;

  room.state = 'over';
  room.result = {
    wave: room.wave,
    time: Math.round(room.time),
    players: players
      .map((p) => ({
        name: p.name,
        cls: p.cls,
        lv: p.lv,
        kills: p.kills,
        dmg: Math.round(p.dmgDealt),
        gold: p.gold,
      }))
      .sort((a, b) => b.dmg - a.dmg),
  };
  for (const p of players) {
    p.inGame = false;
    p.ready = false;
    p.levelOptions = null;
    p.pendingLevelUps = 0;
  }
  room.enemies = [];
  room.projectiles = [];
  room.pickups = [];
  room.spawnQueue = [];
  room.lobbyDirty = true;
  broadcast(room, { t: 'gameover', result: room.result });
}

function updateRoom(room, dt) {
  if (room.state !== 'running') {
    room.fx.length = 0;
    if (room.lobbyDirty) {
      sendLobby(room);
      room.lobbyDirty = false;
    }
    return;
  }

  room.time += dt;
  room.grid = buildGrid(room.enemies);
  updatePlayers(room, dt);
  updateEnemies(room, dt);
  updateProjectiles(room, dt);
  updatePickups(room, dt);
  updateWaves(room, dt);
  checkGameOver(room);

  for (const p of room.players.values()) {
    if (p.inGame && p.invDirty) {
      sendInventory(p);
      p.invDirty = false;
    }
  }
}

// ---------------------------------------------------------------- Netzwerk

function send(client, obj) {
  if (!client || typeof client.sendFn !== 'function') return;
  try {
    client.sendFn(JSON.stringify(obj));
  } catch {
    /* Verbindung weg - wird beim disconnect aufgeräumt */
  }
}

function broadcast(room, obj) {
  const raw = JSON.stringify(obj);
  for (const p of room.players.values()) {
    try {
      p.client.sendFn(raw);
    } catch {
      /* ignore */
    }
  }
}

function sendLobby(room) {
  broadcast(room, {
    t: 'lobby',
    room: room.code,
    state: room.state,
    wave: room.wave,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      cls: p.cls,
      ready: p.ready,
    })),
  });
}

function sendInventory(p) {
  const s = p.stats;
  send(p.client, {
    t: 'inv',
    equipped: p.equipped,
    inv: p.inv,
    stats: {
      maxHp: s.maxHp,
      moveSpeed: Math.round(s.moveSpeed),
      damage: Math.round(s.damage * 100),
      attackSpeed: Math.round(s.attackSpeed * 100),
      crit: Math.round(s.crit * 100),
      critDmg: Math.round(s.critDmg * 100),
      armor: Math.round(s.armor),
      regen: Math.round(s.regen * 10) / 10,
      area: Math.round(s.area * 100),
      projectiles: s.projectiles,
      pierce: s.pierce,
      luck: s.luck,
      thorns: Math.round(s.thorns),
      pickup: Math.round(s.pickup),
    },
    upgrades: Object.entries(p.upgradeStacks).map(([id, n]) => ({
      id,
      name: UPGRADES_BY_ID[id]?.name ?? id,
      stacks: n,
    })),
  });
}

function snapshotFor(room, me) {
  const vr2 = VIEW_R * VIEW_R;

  const ps = [];
  for (const p of room.players.values()) {
    if (!p.inGame) continue;
    if (p !== me && dist2(p.x, p.y, me.x, me.y) > vr2 * 4) continue;
    ps.push({
      i: p.id,
      n: p.name,
      c: p.cls,
      x: r1(p.x),
      y: r1(p.y),
      f: r1(p.facing),
      hp: Math.round(p.hp),
      m: p.stats.maxHp,
      l: p.lv,
      d: p.downed ? 1 : 0,
      a: p.alive ? 1 : 0,
      rv: p.downed ? Math.round((p.reviveProgress / REVIVE_TIME) * 100) : 0,
      dt: p.downed ? Math.ceil(p.downTimer) : 0,
      iv: p.invuln > 0 ? 1 : 0,
      hf: p.hitFlash > 0 ? 1 : 0,
    });
  }

  const es = [];
  for (const e of room.enemies) {
    if (dist2(e.x, e.y, me.x, me.y) > vr2) continue;
    es.push({
      i: e.id,
      t: e.type,
      x: r1(e.x),
      y: r1(e.y),
      h: Math.round((e.hp / e.maxHp) * 100),
      r: Math.round(e.r),
      e: e.elite ? 1 : 0,
      b: e.boss ? 1 : 0,
      f: e.flash > 0 ? 1 : 0,
    });
  }

  const pr = [];
  for (const q of room.projectiles) {
    if (dist2(q.x, q.y, me.x, me.y) > vr2) continue;
    pr.push({ i: q.id, x: r1(q.x), y: r1(q.y), r: q.r, t: q.type, c: q.color, a: r1(Math.atan2(q.vy, q.vx)) });
  }

  const pk = [];
  for (const q of room.pickups) {
    if (dist2(q.x, q.y, me.x, me.y) > vr2) continue;
    pk.push({ i: q.id, x: r1(q.x), y: r1(q.y), k: q.kind, r: q.item ? q.item.rarity : 0 });
  }

  const fx = [];
  for (const f of room.fx) {
    if (f.x === undefined || dist2(f.x, f.y, me.x, me.y) <= vr2) fx.push(f);
  }

  return {
    t: 's',
    wave: room.wave,
    ws: room.waveState,
    wt: Math.max(0, Math.round(room.waveTimer * 10) / 10),
    left: room.enemies.length + room.spawnQueue.reduce((a, g) => a + g.count, 0),
    time: Math.round(room.time),
    you: {
      i: me.id,
      hp: Math.round(me.hp),
      mhp: me.stats.maxHp,
      lv: me.lv,
      xp: Math.round(me.xp),
      xpn: me.xpNext,
      gold: me.gold,
      kills: me.kills,
      dmg: Math.round(me.dmgDealt),
      down: me.downed ? 1 : 0,
      dead: me.alive ? 0 : 1,
      dashCd: r1(me.dashCd),
      abCd: r1(me.abCd),
      abName: CLASSES[me.cls].ability.name,
      ms: Math.round(me.stats.moveSpeed),
    },
    ps,
    es,
    pr,
    pk,
    fx,
  };
}

function broadcastState(room) {
  if (room.state !== 'running') {
    room.fx.length = 0;
    return;
  }
  for (const p of room.players.values()) {
    if (!p.inGame) continue;
    send(p.client, snapshotFor(room, p));
  }
  room.fx.length = 0;
}

// ---------------------------------------------------------------- Hub

export class Hub {
  constructor() {
    this.rooms = new Map();
    this.clients = new Map();
    this.timer = null;
    this.lastTick = Date.now();
  }

  start() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      let dt = (now - this.lastTick) / 1000;
      this.lastTick = now;
      if (dt > 0.1) dt = 0.1;
      if (dt <= 0) dt = 1 / SIM_HZ;
      this.step(dt);
    }, Math.round(1000 / SIM_HZ));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  step(dt) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      updateRoom(room, dt);
      room.sendCounter++;
      if (room.sendCounter % SEND_EVERY === 0) broadcastState(room);
      if (room.players.size === 0 && now - room.emptyAt > 60000) this.rooms.delete(code);
    }
  }

  getRoom(code) {
    let r = this.rooms.get(code);
    if (!r) {
      r = makeRoom(code);
      this.rooms.set(code, r);
    }
    return r;
  }

  /** @param {(raw:string)=>void} sendFn */
  connect(sendFn) {
    const client = { id: newId(), sendFn, player: null, room: null };
    this.clients.set(client.id, client);
    return client;
  }

  disconnect(client) {
    if (!client) return;
    this.clients.delete(client.id);
    const room = client.room;
    const player = client.player;
    client.player = null;
    client.room = null;
    if (!room || !player) return;

    room.players.delete(player.id);
    room.lobbyDirty = true;
    if (room.players.size === 0) {
      room.emptyAt = Date.now();
      room.state = 'lobby';
      room.wave = 0;
      room.enemies = [];
      room.projectiles = [];
      room.pickups = [];
      room.spawnQueue = [];
    } else if (room.state === 'running') {
      checkGameOver(room);
    }
    broadcast(room, { t: 'left', id: player.id, name: player.name });
  }

  handle(client, raw) {
    if (!client || typeof raw !== 'string' || raw.length > 4000) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    // "join" ist die einzige Nachricht ohne zugeordneten Spieler
    if (msg.t === 'join') {
      if (client.player) return;
      const name = sanitizeName(msg.name);
      const code = sanitizeRoom(msg.room);
      const room = this.getRoom(code);
      if (room.players.size >= MAX_PLAYERS) {
        send(client, { t: 'error', msg: `Dieser Raum ist voll (max. ${MAX_PLAYERS} Spieler).` });
        return;
      }
      const p = makePlayer(client, name);
      client.player = p;
      client.room = room;
      room.players.set(p.id, p);
      room.lobbyDirty = true;
      send(client, {
        t: 'joined',
        id: p.id,
        room: room.code,
        arena: ARENA,
        meta: publicMeta(),
        running: room.state === 'running',
      });
      sendLobby(room);
      return;
    }

    const p = client.player;
    const room = client.room;
    if (!p || !room) return;

    switch (msg.t) {
      case 'pick': {
        if (p.inGame) return;
        if (CLASSES[msg.cls]) {
          p.cls = msg.cls;
          room.lobbyDirty = true;
        }
        return;
      }
      case 'ready': {
        if (p.inGame) return;
        if (!p.cls) {
          send(client, { t: 'error', msg: 'Wähle zuerst eine Klasse.' });
          return;
        }
        p.ready = !!msg.v;
        room.lobbyDirty = true;
        this.maybeStart(room);
        return;
      }
      case 'input': {
        const mx = Number(msg.mx);
        const my = Number(msg.my);
        p.input.mx = Number.isFinite(mx) ? clamp(mx, -1, 1) : 0;
        p.input.my = Number.isFinite(my) ? clamp(my, -1, 1) : 0;
        if (msg.dash) p.input.dash = true;
        return;
      }
      case 'upgrade': {
        if (p.inGame) chooseUpgrade(p, Number(msg.idx));
        return;
      }
      case 'equip': {
        if (p.inGame && typeof msg.id === 'string') equipItem(p, msg.id);
        return;
      }
      case 'drop': {
        if (p.inGame && typeof msg.id === 'string') dropItem(p, msg.id);
        return;
      }
      case 'invreq': {
        if (p.inGame) sendInventory(p);
        return;
      }
      case 'chat': {
        const text = String(msg.text ?? '')
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .trim()
          .slice(0, 200);
        if (text) broadcast(room, { t: 'chat', from: p.name, text });
        return;
      }
      case 'lobby': {
        // Zurück in die Lobby nach Spielende
        if (room.state === 'over') {
          room.state = 'lobby';
          room.wave = 0;
          room.waveState = 'intermission';
          room.waveTimer = 0;
          room.result = null;
          for (const q of room.players.values()) {
            q.ready = false;
            q.inGame = false;
          }
          room.lobbyDirty = true;
        }
        return;
      }
      default:
        return;
    }
  }

  maybeStart(room) {
    if (room.state === 'running') return;
    const players = [...room.players.values()];
    if (!players.length) return;
    if (!players.every((p) => p.ready && p.cls)) return;

    room.state = 'running';
    room.enemies = [];
    room.projectiles = [];
    room.pickups = [];
    room.fx = [];
    room.spawnQueue = [];
    room.wave = 0;
    room.time = 0;
    room.waveState = 'intermission';
    room.waveTimer = FIRST_WAVE_DELAY;
    room.result = null;
    for (const p of players) resetPlayerForRun(p);
    broadcast(room, { t: 'start', arena: ARENA, delay: FIRST_WAVE_DELAY });
    sendLobby(room);
    for (const p of players) sendInventory(p);
  }
}

export const __test = { makeRoom, computeStats, xpForLevel, startWave, makePlayer, giveItem };