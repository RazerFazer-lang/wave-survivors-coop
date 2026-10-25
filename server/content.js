// Spielinhalte: Klassen, Gegner, Seltenheiten, Affixe, Upgrades.
// Reine Daten + Roll-Funktionen, keine Spielzustandslogik.

export const SLOTS = ['weapon', 'armor', 'amulet', 'ring'];

export const SLOT_NAMES = {
  weapon: 'Waffe',
  armor: 'Rüstung',
  amulet: 'Amulett',
  ring: 'Ring',
};

// Alle Modifikator-Schlüssel, die Items und Upgrades beeinflussen können.
export const ADD_KEYS = [
  'damagePct',
  'attackSpeedPct',
  'moveSpeedPct',
  'maxHpFlat',
  'critPct',
  'critDmgPct',
  'armorFlat',
  'pickupPct',
  'regenFlat',
  'areaPct',
  'projFlat',
  'luckFlat',
  'pierceFlat',
  'explodeFlat',
  'boomPct',
  'lifestealFlat',
  'auraHealFlat',
  'thornsFlat',
];

export function emptyAdd() {
  const o = {};
  for (const k of ADD_KEYS) o[k] = 0;
  return o;
}

export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: 'Krieger',
    color: '#ff7a59',
    desc: 'Nahkampf-Sichelhieb in Blickrichtung. Passiv: 12 % Schadensreduktion.',
    base: { maxHp: 155, moveSpeed: 166, crit: 0.05, critDmg: 1.6, armor: 14, pickup: 74, regen: 0.4, dr: 0.12 },
    weapon: { kind: 'melee', name: 'Sichelhieb', cd: 0.55, dmg: 20, range: 98, arc: Math.PI * 0.62 },
    ability: { name: 'Wirbelsturm', cd: 6.5, dmg: 34, range: 165 },
  },
  ranger: {
    id: 'ranger',
    name: 'Jäger',
    color: '#6ee7a8',
    desc: 'Schnelle, durchbohrende Pfeile. Beweglich, aber zerbrechlich.',
    base: { maxHp: 105, moveSpeed: 188, crit: 0.1, critDmg: 1.7, armor: 4, pickup: 84, regen: 0.2, dr: 0 },
    weapon: { kind: 'arrow', name: 'Schnellschuss', cd: 0.36, dmg: 13, speed: 540, range: 760, pierce: 1 },
    ability: { name: 'Pfeilsalve', cd: 7.5, dmg: 15, count: 12 },
  },
  mage: {
    id: 'mage',
    name: 'Magier',
    color: '#7cc4ff',
    desc: 'Explodierende Arkankugeln mit Flächenschaden.',
    base: { maxHp: 92, moveSpeed: 160, crit: 0.07, critDmg: 1.8, armor: 2, pickup: 92, regen: 0.2, dr: 0 },
    weapon: { kind: 'orb', name: 'Arkankugel', cd: 0.8, dmg: 17, speed: 340, range: 700, boom: 72 },
    ability: { name: 'Kataklysmus', cd: 9, dmg: 55, count: 3, boom: 130 },
  },
  cleric: {
    id: 'cleric',
    name: 'Kleriker',
    color: '#ffd166',
    desc: 'Heilige Nova um sich herum. Passiv: heilt Verbündete im Umkreis.',
    base: { maxHp: 118, moveSpeed: 172, crit: 0.05, critDmg: 1.5, armor: 8, pickup: 100, regen: 0.6, dr: 0.05 },
    weapon: { kind: 'nova', name: 'Heilige Nova', cd: 1.0, dmg: 12, radius: 128 },
    ability: { name: 'Segen', cd: 11, healPct: 0.3, shield: 1.4 },
  },
};

export const ENEMIES = {
  slime: { name: 'Schleim', hp: 26, speed: 72, dmg: 7, r: 15, xp: 2, cost: 1, color: '#7ddc6b', minWave: 1 },
  bat: { name: 'Fledermaus', hp: 18, speed: 146, dmg: 5, r: 11, xp: 2, cost: 1, color: '#b48cff', minWave: 2 },
  hound: { name: 'Höllenhund', hp: 40, speed: 182, dmg: 9, r: 14, xp: 3, cost: 2, color: '#ff6b6b', minWave: 4 },
  brute: { name: 'Berserker', hp: 110, speed: 58, dmg: 17, r: 25, xp: 7, cost: 4, color: '#d98f3d', minWave: 5 },
  spitter: {
    name: 'Spucker', hp: 48, speed: 62, dmg: 10, r: 16, xp: 5, cost: 3, color: '#4fd1c5', minWave: 7,
    ranged: { cd: 2.4, range: 380, speed: 270, dmg: 10, volley: 1 },
  },
  warlock: {
    name: 'Hexer', hp: 78, speed: 70, dmg: 12, r: 18, xp: 9, cost: 5, color: '#9b5de5', minWave: 10,
    ranged: { cd: 3.0, range: 440, speed: 215, dmg: 14, volley: 3, spread: 0.3 },
  },
  golem: {
    name: 'Golem', hp: 1150, speed: 54, dmg: 27, r: 38, xp: 90, cost: 0, color: '#ffb347', minWave: 5, boss: true,
    ranged: { cd: 3.6, range: 620, speed: 235, dmg: 16, volley: 10, spread: Math.PI * 2 },
  },
};

export const RARITIES = [
  { id: 'common', name: 'Gewöhnlich', color: '#b8c0cc', affixes: 1, weight: 56 },
  { id: 'magic', name: 'Magisch', color: '#4da3ff', affixes: 2, weight: 27 },
  { id: 'rare', name: 'Selten', color: '#ffd34d', affixes: 3, weight: 12 },
  { id: 'epic', name: 'Episch', color: '#c56bff', affixes: 4, weight: 4 },
  { id: 'legendary', name: 'Legendär', color: '#ff8a3d', affixes: 5, weight: 1 },
];

const AFFIX_POOL = [
  { id: 'damagePct', label: 'Schaden', unit: '%', min: 5, max: 11, weight: 1.0 },
  { id: 'attackSpeedPct', label: 'Angriffstempo', unit: '%', min: 4, max: 9, weight: 1.0 },
  { id: 'moveSpeedPct', label: 'Bewegungstempo', unit: '%', min: 3, max: 7, weight: 0.9 },
  { id: 'maxHpFlat', label: 'Max. Leben', unit: '', min: 9, max: 20, weight: 0.5 },
  { id: 'critPct', label: 'Krit-Chance', unit: '%', min: 2, max: 5, weight: 1.1 },
  { id: 'critDmgPct', label: 'Krit-Schaden', unit: '%', min: 9, max: 22, weight: 0.4 },
  { id: 'armorFlat', label: 'Rüstung', unit: '', min: 5, max: 12, weight: 0.5 },
  { id: 'pickupPct', label: 'Aufsammel-Radius', unit: '%', min: 10, max: 26, weight: 0.3 },
  { id: 'regenFlat', label: 'Leben/Sek.', unit: '', min: 0.3, max: 0.9, dec: 1, weight: 6 },
  { id: 'areaPct', label: 'Wirkungsbereich', unit: '%', min: 5, max: 13, weight: 0.8 },
  { id: 'luckFlat', label: 'Glück', unit: '', min: 1, max: 3, weight: 2 },
  { id: 'projFlat', label: 'Zus. Projektil', unit: '', min: 1, max: 1, noScale: true, slots: ['weapon'], minRarity: 2, weight: 25 },
  { id: 'pierceFlat', label: 'Durchschlag', unit: '', min: 1, max: 1, noScale: true, slots: ['weapon'], minRarity: 1, weight: 12 },
  { id: 'thornsFlat', label: 'Dornen', unit: '', min: 3, max: 8, slots: ['armor'], weight: 1.0 },
  { id: 'lifestealFlat', label: 'Leben pro Treffer', unit: '', min: 1, max: 1, noScale: true, slots: ['ring', 'amulet'], minRarity: 2, weight: 14 },
];

const SUFFIX = {
  damagePct: 'der Wut',
  attackSpeedPct: 'der Eile',
  moveSpeedPct: 'des Windes',
  maxHpFlat: 'des Bären',
  critPct: 'des Jägers',
  critDmgPct: 'der Grausamkeit',
  armorFlat: 'des Felsens',
  pickupPct: 'des Magneten',
  regenFlat: 'des Lebens',
  areaPct: 'der Weite',
  luckFlat: 'des Glücks',
  projFlat: 'der Vielfalt',
  pierceFlat: 'des Durchbruchs',
  thornsFlat: 'der Dornen',
  lifestealFlat: 'des Blutes',
};

const BASE_NAMES = {
  weapon: ['Klinge', 'Bogen', 'Stab', 'Zepter', 'Kriegshammer', 'Dolch'],
  armor: ['Kettenhemd', 'Lederweste', 'Robe', 'Plattenpanzer', 'Schuppenrock'],
  amulet: ['Amulett', 'Talisman', 'Anhänger', 'Medaillon'],
  ring: ['Ring', 'Siegelring', 'Bandring', 'Reif'],
};

export const UPGRADES = [
  { id: 'dmg', name: 'Scharfe Klinge', desc: '+15 % Schaden', mod: { damagePct: 15 }, max: 8 },
  { id: 'as', name: 'Schnelle Hände', desc: '+12 % Angriffstempo', mod: { attackSpeedPct: 12 }, max: 8 },
  { id: 'ms', name: 'Leichte Stiefel', desc: '+8 % Bewegungstempo', mod: { moveSpeedPct: 8 }, max: 5 },
  { id: 'hp', name: 'Vitalität', desc: '+25 max. Leben (heilt sofort)', mod: { maxHpFlat: 25 }, max: 8, heal: 25 },
  { id: 'crit', name: 'Schwachstelle', desc: '+4 % Krit-Chance', mod: { critPct: 4 }, max: 6 },
  { id: 'critd', name: 'Brutalität', desc: '+20 % Krit-Schaden', mod: { critDmgPct: 20 }, max: 6 },
  { id: 'armor', name: 'Gehärtete Haut', desc: '+10 Rüstung', mod: { armorFlat: 10 }, max: 6 },
  { id: 'regen', name: 'Regeneration', desc: '+0.8 Leben/Sek.', mod: { regenFlat: 0.8 }, max: 5 },
  { id: 'area', name: 'Weiter Schwung', desc: '+12 % Wirkungsbereich', mod: { areaPct: 12 }, max: 5 },
  { id: 'pickup', name: 'Magnet', desc: '+30 % Aufsammel-Radius', mod: { pickupPct: 30 }, max: 4 },
  { id: 'luck', name: 'Glückspilz', desc: '+2 Glück (bessere Beute)', mod: { luckFlat: 2 }, max: 5 },
  { id: 'thorns', name: 'Dornen', desc: '+8 Kontaktschaden an Gegnern', mod: { thornsFlat: 8 }, max: 4 },
  { id: 'proj', name: 'Mehrfachschuss', desc: '+1 Projektil', mod: { projFlat: 1 }, max: 4, cls: ['ranger', 'mage'] },
  { id: 'pierce', name: 'Durchschlag', desc: 'Projektile treffen +1 Gegner', mod: { pierceFlat: 1 }, max: 4, cls: ['ranger'] },
  { id: 'explode', name: 'Sprengspitze', desc: 'Pfeile explodieren beim Aufprall', mod: { explodeFlat: 1 }, max: 1, cls: ['ranger'] },
  { id: 'bigboom', name: 'Druckwelle', desc: '+25 % Explosionsradius', mod: { boomPct: 25 }, max: 4, cls: ['mage'] },
  { id: 'bloodlust', name: 'Blutdurst', desc: '+1 Leben pro Treffer', mod: { lifestealFlat: 1 }, max: 3, cls: ['warrior'] },
  { id: 'auraheal', name: 'Heiliger Hauch', desc: '+1 Heilung/Sek. im Umkreis', mod: { auraHealFlat: 1 }, max: 4, cls: ['cleric'] },
];

export const UPGRADES_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

function weightedIndex(weights) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return 0;
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

function pickRarity(luck, minRarityIdx) {
  const weights = RARITIES.map((r, i) => {
    if (i < minRarityIdx) return 0;
    return r.weight * (1 + Math.max(0, luck) * 0.05 * i);
  });
  return weightedIndex(weights);
}

/**
 * Erzeugt ein zufälliges Item.
 * @param {number} level Welle, aus der das Item stammt (skaliert die Rolls)
 * @param {number} luck Glück-Stat des Spielers
 * @param {number} minRarityIdx Mindest-Seltenheit (Index in RARITIES)
 * @param {string|null} slot erzwungener Slot
 */
export function rollItem(level = 1, luck = 0, minRarityIdx = 0, slot = null) {
  const s = slot && SLOTS.includes(slot) ? slot : pickOne(SLOTS);
  const rIdx = pickRarity(luck, Math.max(0, Math.min(RARITIES.length - 1, minRarityIdx)));
  const rarity = RARITIES[rIdx];

  const pool = AFFIX_POOL.filter(
    (a) => (!a.slots || a.slots.includes(s)) && (a.minRarity === undefined || rIdx >= a.minRarity),
  );

  const affixes = [];
  const used = new Set();
  const wanted = Math.min(rarity.affixes, pool.length);
  let guard = 0;
  while (affixes.length < wanted && guard++ < 200) {
    const a = pool[weightedIndex(pool.map((x) => (used.has(x.id) ? 0 : 1)))];
    if (!a || used.has(a.id)) continue;
    used.add(a.id);
    const scale = a.noScale ? 1 : (1 + 0.05 * Math.max(0, level - 1)) * (1 + 0.12 * rIdx);
    const dec = a.dec ?? 0;
    const f = 10 ** dec;
    let v = Math.round((a.min + Math.random() * (a.max - a.min)) * scale * f) / f;
    if (!(v > 0)) v = a.min;
    affixes.push({ id: a.id, label: a.label, unit: a.unit || '', value: v });
  }

  const strongest = affixes.reduce((best, a) => {
    const w = (AFFIX_POOL.find((x) => x.id === a.id)?.weight ?? 1) * a.value;
    return !best || w > best.w ? { a, w } : best;
  }, null);
  const base = pickOne(BASE_NAMES[s]);
  const suffix = strongest ? SUFFIX[strongest.a.id] : null;

  const item = {
    id: 'it' + Math.random().toString(36).slice(2, 10),
    slot: s,
    name: suffix ? `${base} ${suffix}` : base,
    rarity: rIdx,
    level,
    affixes,
  };
  item.power = itemPower(item);
  return item;
}

/** Grober Vergleichswert, damit der Client "besser/schlechter" anzeigen kann. */
export function itemPower(item) {
  if (!item) return 0;
  let p = 0;
  for (const a of item.affixes) {
    const def = AFFIX_POOL.find((x) => x.id === a.id);
    p += a.value * (def?.weight ?? 1);
  }
  return Math.round(p * 10) / 10;
}

/** Statische Daten, die der Client zum Anzeigen braucht. */
export function publicMeta() {
  return {
    classes: Object.values(CLASSES).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      desc: c.desc,
      hp: c.base.maxHp,
      speed: c.base.moveSpeed,
      weapon: c.weapon.name,
      ability: c.ability.name,
    })),
    rarities: RARITIES.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    slots: SLOTS.map((s) => ({ id: s, name: SLOT_NAMES[s] })),
    enemies: Object.fromEntries(
      Object.entries(ENEMIES).map(([k, v]) => [k, { name: v.name, color: v.color, r: v.r, boss: !!v.boss }]),
    ),
  };
}