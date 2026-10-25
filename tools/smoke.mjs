// Smoke-Test ohne Framework: prueft Inhalte, Statberechnung und einen kurzen
// vollstaendigen Spieldurchlauf im Hub. Aufruf: node tools/smoke.mjs
import assert from 'node:assert/strict';
import { Hub, __test } from '../server/game.js';
import { rollItem, itemPower, publicMeta, RARITIES, SLOTS, CLASSES } from '../server/content.js';

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ok    ' + name);
  } catch (err) {
    failures++;
    console.error('  FAIL  ' + name + '\n        ' + err.message);
  }
}

// ------------------------------------------------------------------ Inhalte

test('publicMeta liefert Klassen, Seltenheiten, Slots und Gegner', () => {
  const meta = publicMeta();
  assert.equal(meta.classes.length, Object.keys(CLASSES).length);
  for (const c of meta.classes) {
    assert.ok(c.id && c.name && c.color, 'Klasse unvollstaendig: ' + JSON.stringify(c));
    assert.ok(c.weapon && c.ability, 'Waffe/Faehigkeit fehlt bei ' + c.id);
  }
  assert.equal(meta.rarities.length, RARITIES.length);
  assert.deepEqual(meta.slots.map((s) => s.id), SLOTS);
  assert.ok(meta.enemies.slime && meta.enemies.golem.boss === true);
});

test('rollItem erzeugt gueltige Items ueber 500 Wuerfe', () => {
  for (let i = 0; i < 500; i++) {
    const item = rollItem(1 + (i % 20), i % 7, 0);
    assert.ok(SLOTS.includes(item.slot), 'unbekannter Slot: ' + item.slot);
    assert.ok(item.rarity >= 0 && item.rarity < RARITIES.length, 'Seltenheit ausserhalb: ' + item.rarity);
    assert.ok(item.affixes.length >= 1, 'Item ohne Affix');
    assert.ok(item.affixes.length <= RARITIES[item.rarity].affixes, 'zu viele Affixe');
    const ids = new Set(item.affixes.map((a) => a.id));
    assert.equal(ids.size, item.affixes.length, 'doppelter Affix');
    for (const a of item.affixes) assert.ok(a.value > 0, 'Affixwert <= 0: ' + a.id);
    assert.ok(itemPower(item) >= 0);
  }
});

test('erzwungener Slot und Mindestseltenheit werden beachtet', () => {
  for (let i = 0; i < 100; i++) {
    const item = rollItem(10, 0, 2, 'weapon');
    assert.equal(item.slot, 'weapon');
    assert.ok(item.rarity >= 2, 'Seltenheit zu niedrig: ' + item.rarity);
  }
});

test('xpForLevel waechst streng monoton', () => {
  let prev = 0;
  for (let lv = 1; lv <= 40; lv++) {
    const need = __test.xpForLevel(lv);
    assert.ok(need > prev, 'nicht monoton bei Stufe ' + lv);
    prev = need;
  }
});

// ------------------------------------------------------------------ Stats

test('computeStats verrechnet Upgrade-Stacks', () => {
  const p = __test.makePlayer({ id: 1, sendFn() {} }, 'Tester');
  p.cls = 'warrior';
  const base = __test.computeStats(p);
  assert.equal(Math.round(base.damage * 100), 100);

  p.upgradeStacks = { dmg: 2, hp: 1 };
  const buffed = __test.computeStats(p);
  assert.equal(Math.round(buffed.damage * 100), 130);
  assert.equal(buffed.maxHp, base.maxHp + 25);
  assert.ok(buffed.dr > 0, 'Krieger sollte Schadensreduktion haben');
});

test('computeStats beruecksichtigt angelegte Items', () => {
  const p = __test.makePlayer({ id: 2, sendFn() {} }, 'Tester');
  p.cls = 'mage';
  const before = __test.computeStats(p);
  p.equipped.weapon = {
    id: 'x', slot: 'weapon', name: 'Test', rarity: 1, level: 1,
    affixes: [{ id: 'damagePct', label: 'Schaden', unit: '%', value: 50 }],
  };
  const after = __test.computeStats(p);
  assert.equal(Math.round(after.damage * 100) - Math.round(before.damage * 100), 50);
});

test('giveItem legt an, lagert ein und verkauft bei vollem Rucksack', () => {
  const p = __test.makePlayer({ id: 3, sendFn() {} }, 'Tester');
  p.cls = 'ranger';
  const mk = (power) => ({
    id: 'i' + power, slot: 'ring', name: 'Ring ' + power, rarity: 0, level: 1,
    affixes: [{ id: 'damagePct', label: 'Schaden', unit: '%', value: power }],
  });
  assert.equal(__test.giveItem(p, mk(5)), 'equipped');
  assert.equal(__test.giveItem(p, mk(6)), 'stored');
  while (p.inv.length < 24) p.inv.push(mk(50));
  const goldBefore = p.gold;
  assert.equal(__test.giveItem(p, mk(1)), 'sold');
  assert.equal(p.gold, goldBefore + 10);
});

// ------------------------------------------------------------------ Durchlauf

test('zwei Spieler starten eine Runde, Wellen und Snapshots laufen', () => {
  const hub = new Hub(); // absichtlich ohne start(): wir taktiern manuell
  const inbox = [[], []];
  const clients = [
    hub.connect((raw) => inbox[0].push(JSON.parse(raw))),
    hub.connect((raw) => inbox[1].push(JSON.parse(raw))),
  ];

  hub.handle(clients[0], JSON.stringify({ t: 'join', name: 'Alpha', room: 'test-raum!' }));
  hub.handle(clients[1], JSON.stringify({ t: 'join', name: 'Beta', room: 'TESTRAUM' }));

  const joined = inbox[0].find((m) => m.t === 'joined');
  assert.ok(joined, 'kein joined empfangen');
  assert.equal(joined.room, 'TESTRAUM', 'Raumcode wurde nicht normalisiert');

  const room = hub.rooms.get('TESTRAUM');
  assert.ok(room, 'Raum nicht angelegt');
  assert.equal(room.players.size, 2);

  hub.handle(clients[0], JSON.stringify({ t: 'pick', cls: 'warrior' }));
  hub.handle(clients[1], JSON.stringify({ t: 'pick', cls: 'cleric' }));
  hub.handle(clients[0], JSON.stringify({ t: 'ready', v: true }));
  hub.handle(clients[1], JSON.stringify({ t: 'ready', v: true }));

  assert.equal(room.state, 'running', 'Runde ist nicht gestartet');
  assert.ok(inbox[0].some((m) => m.t === 'start'), 'kein start empfangen');

  let maxEnemies = 0;
  let levelupsAnswered = 0;
  const cursor = [0, 0];

  // 40 Sekunden Spielzeit bei 60 Hz
  for (let step = 0; step < 60 * 40; step++) {
    hub.handle(clients[0], JSON.stringify({ t: 'input', mx: Math.sin(step / 90), my: Math.cos(step / 70) }));
    hub.step(1 / 60);
    maxEnemies = Math.max(maxEnemies, room.enemies.length);

    for (let i = 0; i < 2; i++) {
      for (; cursor[i] < inbox[i].length; cursor[i]++) {
        const m = inbox[i][cursor[i]];
        if (m.t === 'levelup') {
          hub.handle(clients[i], JSON.stringify({ t: 'upgrade', idx: 0 }));
          levelupsAnswered++;
        }
      }
    }
  }

  assert.ok(room.wave >= 1, 'keine Welle gestartet');
  assert.ok(maxEnemies > 0, 'es sind nie Gegner erschienen');

  const snap = [...inbox[0]].reverse().find((m) => m.t === 's');
  assert.ok(snap, 'keine Snapshots empfangen');
  assert.ok(Array.isArray(snap.ps) && Array.isArray(snap.es), 'Snapshot ohne Listen');
  assert.equal(snap.ps.length, 2, 'Snapshot zeigt nicht beide Spieler');
  assert.ok(typeof snap.you.hp === 'number' && snap.you.mhp > 0, 'Snapshot ohne Lebenswerte');
  assert.ok(typeof snap.you.abName === 'string' && snap.you.abName.length > 0);

  const invMsg = inbox[0].find((m) => m.t === 'inv');
  assert.ok(invMsg && invMsg.stats && invMsg.stats.maxHp > 0, 'kein Inventar-Update');

  // Chat und Trennung duerfen nicht werfen
  hub.handle(clients[1], JSON.stringify({ t: 'chat', text: 'Hallo \u0007Welt' }));
  const chat = [...inbox[0]].reverse().find((m) => m.t === 'chat');
  assert.ok(chat && !chat.text.includes('\u0007'), 'Steuerzeichen nicht entfernt');

  hub.disconnect(clients[1]);
  assert.equal(room.players.size, 1);
  hub.step(1 / 60);

  console.log('        Welle ' + room.wave + ', max. ' + maxEnemies + ' Gegner, ' + levelupsAnswered + ' Aufstiege gewaehlt');
});

test('voller Raum lehnt weitere Spieler ab', () => {
  const hub = new Hub();
  const made = [];
  for (let i = 0; i < 9; i++) {
    const msgs = [];
    const c = hub.connect((raw) => msgs.push(JSON.parse(raw)));
    hub.handle(c, JSON.stringify({ t: 'join', name: 'P' + i, room: 'FULL' }));
    made.push({ c, msgs });
  }
  assert.equal(hub.rooms.get('FULL').players.size, 8);
  const last = made[8].msgs;
  assert.ok(last.some((m) => m.t === 'error'), 'kein Fehler fuer den 9. Spieler');
  assert.ok(!last.some((m) => m.t === 'joined'), '9. Spieler wurde aufgenommen');
});

console.log(failures ? '\n' + failures + ' Test(s) fehlgeschlagen.' : '\nAlle Tests bestanden.');
process.exitCode = failures ? 1 : 0;