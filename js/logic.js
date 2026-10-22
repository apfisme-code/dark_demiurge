// ===========================================================================
// logic.js — правила игры: захват, люди, постройки, враги, бой, босс, набег.
//
// Ничего не рисует и не трогает DOM, кроме вызова showToast/updateHUD:
// весь игровой автомат живёт здесь и вызывается из tick().
// ===========================================================================
import {
  BIOMES, ENEMIES, BUILDING_MAP, BUILDING_UPGRADE_NEXT,
  RAID_DURATION, RAID_BOSS_DELAY,
  BOSS_HP, BOSS_DMG, BOSS_MOVE_DELAY,
  HOME_BIOME_SPAWN_WEIGHT, COMBAT_TICK, HEALER_HEAL_AMOUNT, BATTLE_MERGE_SAFETY,
  MAX_TICK_DT, UI_REFRESH_INTERVAL, POPUP_REFRESH_INTERVAL,
} from './config.js';
import {
  S, popup, winScreen,
  getSpawnTime, recomputeCap, getPortalCap, getPoolPeople, updateBattleFlag,
  getReservedArr, getClaimCost, isBiomeUnlocked, getPortalUpgradeCost,
  canUpgradePortal, getImpPeriod, isRaidActive, recomputeBuffs, getCellMaxHp,
  getCellDmg, recomputeRates, recomputeClaimableSet, canAffordBuilding,
  payForBuilding,
} from './state.js';
import { recomputeAllCaches } from './world.js';
import {
  updateHUD, updateResourceUI, showToast, updateRaidHud, renderPopup, renderLegend,
} from './ui.js';

// ============== GAME LOGIC ============
export function claimCell(idx, biomeIdx) {
  if (!isBiomeUnlocked(biomeIdx)) return false;
  const cost = getClaimCost(idx);
  if (S.chaosBlood < cost) return false;
  S.chaosBlood -= cost;
  S.claimed.set(idx, biomeIdx);
  S.biomeCounts[biomeIdx]++;
  const cap = S.cellCaps[idx] || 1;
  S.cellSlots.set(idx, new Array(cap).fill(null));
  S.cellSlotReserved.set(idx, new Array(cap).fill(false));
  S.cellImpTimers.set(idx, 0);
  recomputeAllCaches();
  recomputeClaimableSet();
  recomputeBuffs();
  recomputeCap();
  recomputeRates();
  updateHUD();
  updateResourceUI();
  showToast(`−${cost} крови · ${BIOMES[biomeIdx].ru}`);
  return true;
}

export function assignTo(idx, delta) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return;
  const maxHp = getCellMaxHp(idx);

  if (delta > 0) {
    if (getPoolPeople() <= 0) { showToast('Нет свободных рабочих — расширь лимит (дома) или подожди'); return; }
    const reserved = getReservedArr(idx);
    let converted = 0;
    for (let i = 0; i < slots.length; i++) {
      if (getPoolPeople() <= 0) break;
      const e = slots[i];
      if (!e || e.t !== 'i') continue;
      slots[i] = {
        t: 'b',
        h: { hp: maxHp, maxHp: maxHp },
        i: { hp: e.hp, maxHp: e.maxHp, biomeIdx: e.biomeIdx },
        timer: 0
      };
      S.cellHasBattle.set(idx, true);
      if (reserved) reserved[i] = true;
      converted++;
    }
    if (converted > 0) {
      recomputeRates();
      updateHUD();
      updateResourceUI();
      return;
    }

    // Пустой слот — рабочий встаёт на добычу.
    let emptyIdx = -1;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === null) { emptyIdx = i; break; }
    }
    if (emptyIdx !== -1) {
      slots[emptyIdx] = { t: 'h', hp: maxHp, maxHp: maxHp };
      if (reserved) reserved[emptyIdx] = true;
    } else {
      // Все слоты заняты — отдаём рабочего зданию, которому он нужен.
      // Без этого переселить людей вглубь некуда: занятые слоты закрыты.
      let bldIdx = -1;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s && s.t === 'bld' && !s.worker) {
          const b = BUILDING_MAP[s.id];
          if (b && !b.noWorker) { bldIdx = i; break; }
        }
      }
      if (bldIdx === -1) { showToast('Все слоты заняты — здесь некуда поставить рабочего'); return; }
      slots[bldIdx].worker = { hp: maxHp, maxHp: maxHp };
      if (reserved) reserved[bldIdx] = true;
    }
    recomputeRates();
    updateHUD();
    updateResourceUI();
  } else {
    // Снимаем рабочего и с добычи, и из постройки — иначе люди, ушедшие
    // в башни, намертво в них застревают и их нельзя переселить.
    let humanIdx = -1;
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (!s) continue;
      if (s.t === 'h' || (s.t === 'bld' && s.worker)) { humanIdx = i; break; }
    }
    if (humanIdx === -1) { showToast('Здесь нет рабочего'); return; }
    if (slots[humanIdx].t === 'bld') slots[humanIdx].worker = null;
    else slots[humanIdx] = null;
    const reserved = getReservedArr(idx);
    if (reserved) reserved[humanIdx] = false;
    recomputeRates();
    updateHUD();
    updateResourceUI();
  }
}

export function placeBuilding(idx, buildingId) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return false;
  const b = BUILDING_MAP[buildingId];
  if (!b) return false;
  if (b.upgradeOnly) { showToast('Улучшение недоступно для прямой постройки'); return false; }
  if (!canAffordBuilding(b)) { showToast('Недостаточно ресурсов'); return false; }

  if (b.effect === 'monolith') {
    for (const slots2 of S.cellSlots.values()) {
      for (const s of slots2) {
        if (s && s.t === 'bld' && BUILDING_MAP[s.id] && BUILDING_MAP[s.id].effect === 'monolith') {
          showToast('Монолит уже построен');
          return false;
        }
      }
    }
  }

  let targetIdx = -1;
  let absorbedWorker = null;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null) { targetIdx = i; break; }
  }
  if (targetIdx === -1) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].t === 'h') {
        targetIdx = i;
        absorbedWorker = { hp: slots[i].hp, maxHp: slots[i].maxHp };
        break;
      }
    }
    if (targetIdx === -1) { showToast('Нет места для постройки'); return false; }
  }

  payForBuilding(b);
  // Если постройка встала на пустой слот, а в пуле есть свободный рабочий —
  // отдаём его сразу. Иначе башня простоит без рабочего, и заселить её
  // будет нечем: «+» в попапе умеет брать только пустой слот.
  let worker = absorbedWorker;
  if (!worker && !b.noWorker && getPoolPeople() > 0) {
    worker = { hp: getCellMaxHp(idx), maxHp: getCellMaxHp(idx) };
  }
  slots[targetIdx] = {
    t: 'bld',
    id: buildingId,
    worker: b.noWorker ? null : worker,
    battle: null,
    timer: 0
  };
  const reserved = getReservedArr(idx);
  // Резерв держит слот заполненным: если рабочий погибнет, пул вернёт нового.
  if (reserved) reserved[targetIdx] = b.noWorker ? false : !!worker;

  recomputeBuffs();
  recomputeCap();
  recomputeRates();
  updateHUD();
  updateResourceUI();
  showToast(`🏗 ${b.name}${absorbedWorker && !b.noWorker ? ' (рабочий перенесён)' : (absorbedWorker && b.noWorker ? ' (рабочий в пул)' : '')}`);
  return true;
}

export function destroyBuilding(idx, slotIdx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return;
  const s = slots[slotIdx];
  if (!s || s.t !== 'bld') return;
  if (s.battle) { showToast('Нельзя снести здание в бою'); return; }
  const b = BUILDING_MAP[s.id];
  if (s.worker) {
    slots[slotIdx] = { t: 'h', hp: s.worker.hp, maxHp: s.worker.maxHp };
    const reserved = getReservedArr(idx);
    if (reserved) reserved[slotIdx] = true;
  } else {
    slots[slotIdx] = null;
    const reserved = getReservedArr(idx);
    if (reserved) reserved[slotIdx] = false;
  }
  recomputeBuffs();
  recomputeCap();
  recomputeRates();
  updateHUD();
  updateResourceUI();
  showToast(`Снесено: ${b ? b.name : '?'}`);
}

export function upgradeBuilding(idx, slotIdx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return;
  const s = slots[slotIdx];
  if (!s || s.t !== 'bld') return;
  const nextId = BUILDING_UPGRADE_NEXT[s.id];
  if (nextId === undefined) return;
  const nextB = BUILDING_MAP[nextId];
  if (!nextB) return;
  if (!canAffordBuilding(nextB)) { showToast('Недостаточно ресурсов'); return; }
  payForBuilding(nextB);
  slots[slotIdx] = {
    t: 'bld',
    id: nextId,
    worker: s.worker,
    battle: s.battle,
    timer: 0
  };
  recomputeBuffs();
  recomputeCap();
  recomputeRates();
  updateHUD();
  updateResourceUI();
  showToast(`⬆ ${nextB.name}`);
}

export function upgradePortal() {
  if (!canUpgradePortal()) return;
  const cost = getPortalUpgradeCost();
  S.chaosBlood -= cost;
  S.portalLevel++;
  updateHUD();
  updateResourceUI();
  renderLegend();
  showToast(`Портал · Ур. ${S.portalLevel} (−${cost} крови)`);
  if (S.pendingIdx === S.portalCellIdx && !popup.classList.contains('hidden')) {
    S.popupSignature = '';
    renderPopup();
  }
}

export function hasMonolithActive() {
  for (const slots of S.cellSlots.values()) {
    for (const s of slots) {
      if (s && s.t === 'bld' && s.worker && BUILDING_MAP[s.id] && BUILDING_MAP[s.id].effect === 'monolith') {
        return true;
      }
    }
  }
  return false;
}

export function startRaid() {
  if (S.gameWon) return;
  if (S.raid) return;
  if (S.boss) return;
  if (!hasMonolithActive()) { showToast('Нужен работающий монолит'); return; }
  S.raid = { elapsed: 0, bossSpawned: false };
  showToast('🔥 НАБЕГ ДЕМОНОВ НАЧАЛСЯ!', 3000);
  if (S.pendingIdx === S.portalCellIdx && !popup.classList.contains('hidden')) {
    S.popupSignature = '';
    renderPopup();
  }
}
// ============ ENEMY SPAWN ============
function isCellFullyOccupiedByEnemies(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return true;
  for (const s of slots) {
    if (s === null) return false;
    if (s.t === 'h') return false;
    if (s.t === 'bld' && s.worker && !s.battle) return false;
    if (s.t === 'bld' && !s.worker && !s.battle) return false;
  }
  return true;
}

export function pickEnemyBiomeForCell(homeBiome) {
  if (S.totalClaimedArea <= 0) return homeBiome;
  const weights = new Array(BIOMES.length).fill(0);
  let sum = 0;
  for (let b = 0; b < BIOMES.length; b++) {
    const base = S.biomeAreas[b] / S.totalClaimedArea;
    const w = b === homeBiome ? base * HOME_BIOME_SPAWN_WEIGHT : base;
    weights[b] = w;
    sum += w;
  }
  if (sum <= 0) return homeBiome;
  let r = Math.random() * sum;
  for (let b = 0; b < BIOMES.length; b++) {
    r -= weights[b];
    if (r <= 0) return b;
  }
  return homeBiome;
}

export function trySpawnEnemyOnCell(sourceIdx) {
  const homeBiome = S.claimed.get(sourceIdx) || 0;
  const enemyBiome = pickEnemyBiomeForCell(homeBiome);
  if (!isCellFullyOccupiedByEnemies(sourceIdx)) {
    return placeEnemyOnCell(sourceIdx, enemyBiome);
  }
  // Пограничная клетка забита — «проталкиваем» врага глубже, в ближайшую
  // клетку, где есть место. Идти можно по любой захваченной клетке:
  // раньше поиск пропускал всё, что не касается пустоты (getImpPeriod = ∞),
  // и враг расползался только по внешнему кольцу, а внутрь не проникал
  // никогда — тыл оставался неприступным даже при полном прорыве фронта.
  const visited = new Set([sourceIdx]);
  const queue = [sourceIdx];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const n of S.neighborLists[cur]) {
      if (visited.has(n) || !S.claimed.has(n)) continue;
      visited.add(n);
      if (!isCellFullyOccupiedByEnemies(n)) {
        return placeEnemyOnCell(n, enemyBiome);
      }
      queue.push(n);
    }
  }
  return false;
}

export function placeEnemyOnCell(idx, enemyBiomeIdx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return false;
  const enemy = ENEMIES[enemyBiomeIdx] || ENEMIES[0];
  let changed = false;

  let humanIdx = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] && slots[i].t === 'h') { humanIdx = i; break; }
  }
  if (humanIdx !== -1) {
    const h = slots[humanIdx];
    slots[humanIdx] = {
      t: 'b',
      h: { hp: h.hp, maxHp: h.maxHp },
      i: { hp: enemy.hp, maxHp: enemy.hp, biomeIdx: enemyBiomeIdx },
      timer: 0
    };
    S.cellHasBattle.set(idx, true);
    changed = true;
  } else {
    let bldIdx = -1;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].t === 'bld' && slots[i].worker && !slots[i].battle) {
        bldIdx = i; break;
      }
    }
    if (bldIdx !== -1) {
      slots[bldIdx].battle = {
        i: { hp: enemy.hp, maxHp: enemy.hp, biomeIdx: enemyBiomeIdx },
        timer: 0
      };
      S.cellHasBattle.set(idx, true);
      changed = true;
    } else {
      let emptyBldIdx = -1;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i] && slots[i].t === 'bld' && !slots[i].worker && !slots[i].battle) {
          emptyBldIdx = i; break;
        }
      }
      if (emptyBldIdx !== -1) {
        slots[emptyBldIdx] = { t: 'i', hp: enemy.hp, maxHp: enemy.hp, biomeIdx: enemyBiomeIdx };
        changed = true;
      } else {
        let emptyIdx = -1;
        for (let i = 0; i < slots.length; i++) {
          if (slots[i] === null) { emptyIdx = i; break; }
        }
        if (emptyIdx !== -1) {
          slots[emptyIdx] = { t: 'i', hp: enemy.hp, maxHp: enemy.hp, biomeIdx: enemyBiomeIdx };
          changed = true;
        }
      }
    }
  }

  if (changed) {
    recomputeBuffs();
    recomputeCap();
    recomputeRates();
    return true;
  }
  return false;
}

// ============ RAID BOSS ============

/**
 * Ищет демонический монолит где угодно на захваченной территории.
 * Живой рабочий не требуется: цель набега существует, даже когда монолит
 * остался без защиты — именно такой монолит босс и должен снести.
 * @returns {{cellIdx: number, slotIdx: number}|null}
 */
export function findMonolith() {
  for (const [cellIdx, slots] of S.cellSlots) {
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
      const s = slots[slotIdx];
      if (s && s.t === 'bld' && BUILDING_MAP[s.id] && BUILDING_MAP[s.id].effect === 'monolith') {
        return { cellIdx, slotIdx };
      }
    }
  }
  return null;
}

/**
 * Клетка, к которой идёт босс. Обычно это клетка монолита; если монолита
 * нет (босса вызвали отладкой или он разрушен вне набега) — портал.
 * Экспортируется для автотестов: так проверяется, что цель сменилась.
 */
export function getBossTargetIdx() {
  const m = findMonolith();
  return m ? m.cellIdx : S.portalCellIdx;
}

/**
 * Завершает набег провалом: босс уходит, набег снимается, мир живёт дальше.
 * Вызывается и при сносе монолита боссом, и при истечении таймера набега —
 * босс никогда не должен оставаться в мире без набега.
 */
function endRaidAsFailed(message) {
  S.raid = null;
  S.boss = null;
  recomputeBuffs();
  recomputeCap();
  recomputeRates();
  updateRaidHud();
  updateHUD();
  showToast(message, 4000);
}

/** Самая дальняя захваченная клетка от цели — точка появления босса. */
function findFarthestCellFrom(targetIdx) {
  const dist = new Map();
  const q = [targetIdx];
  dist.set(targetIdx, 0);
  let farthestIdx = targetIdx;
  let maxDist = 0;
  while (q.length) {
    const cur = q.shift();
    for (const n of S.neighborLists[cur]) {
      if (dist.has(n) || !S.claimed.has(n)) continue;
      const d = dist.get(cur) + 1;
      dist.set(n, d);
      q.push(n);
      if (d > maxDist) { maxDist = d; farthestIdx = n; }
    }
  }
  return farthestIdx;
}

export function spawnRaidBoss() {
  if (S.boss) return;
  S.boss = {
    cellIdx: findFarthestCellFrom(getBossTargetIdx()),
    hp: BOSS_HP,
    maxHp: BOSS_HP,
    dmg: BOSS_DMG,
    moveTimer: 0,
    atkTimer: 0
  };
  showToast('💀 ДЕМОН-БОСС ЯВИЛСЯ!', 3000);
}

export function triggerVictory() {
  if (S.gameWon) return;
  S.gameWon = true;
  S.raid = null;
  S.boss = null;
  winScreen.classList.add('show');
  document.getElementById('winStats').textContent =
    `Захвачено клеток: ${S.claimed.size} · Уровень портала: ${S.portalLevel} · Всего рабочих: ${S.totalPeople}`;
}

/** Соседняя клетка, приближающая босса к цели. -1, если идти некуда. */
function findNextStepTowardTarget(fromIdx, targetIdx) {
  const dist = new Map();
  const q = [targetIdx];
  dist.set(targetIdx, 0);
  while (q.length) {
    const cur = q.shift();
    for (const n of S.neighborLists[cur]) {
      if (dist.has(n) || !S.claimed.has(n)) continue;
      dist.set(n, dist.get(cur) + 1);
      q.push(n);
    }
  }
  if (!dist.has(fromIdx)) return -1;
  let best = -1, bestD = dist.get(fromIdx);
  for (const n of S.neighborLists[fromIdx]) {
    const nd = dist.get(n);
    if (nd !== undefined && nd < bestD) {
      bestD = nd;
      best = n;
    }
  }
  return best;
}

export function processBoss(dt) {
  if (!S.boss) return;
  if (S.boss.hp <= 0) {
    triggerVictory();
    return;
  }

  const idx = S.boss.cellIdx;
  const slots = S.cellSlots.get(idx);
  if (!slots) { S.boss = null; return; }

  // Пока монолит цел — это цель. Если он исчез во время набега (снесли враги
  // или сам игрок), набег теряет смысл и должен закончиться.
  const monolith = findMonolith();
  if (!monolith && S.raid) {
    endRaidAsFailed('💀 МОНОЛИТ РАЗРУШЕН! Набег прекращён.');
    return;
  }
  const targetIdx = monolith ? monolith.cellIdx : S.portalCellIdx;

  // Босс бьёт раз в секунду случайную цель: человека или рабочего постройки.
  S.boss.atkTimer += dt;
  while (S.boss.atkTimer >= COMBAT_TICK) {
    const targets = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s) continue;
      if (s.t === 'h') targets.push({ i, kind: 'h' });
      else if (s.t === 'bld' && s.worker) targets.push({ i, kind: 'bld' });
    }
    if (targets.length === 0) {
      S.boss.atkTimer = 0;
      break;
    }
    S.boss.atkTimer -= COMBAT_TICK;
    const pick = targets[Math.floor(Math.random() * targets.length)];
    if (pick.kind === 'h') {
      slots[pick.i].hp -= S.boss.dmg;
      if (slots[pick.i].hp <= 0) {
        S.totalPeople--;
        slots[pick.i] = null;
      }
    } else {
      slots[pick.i].worker.hp -= S.boss.dmg;
      if (slots[pick.i].worker.hp <= 0) {
        // Босс сносит постройку вместе с рабочим. Если это монолит — набег сорван.
        const b = BUILDING_MAP[slots[pick.i].id];
        const wasMonolith = b && b.effect === 'monolith';
        slots[pick.i] = null;
        S.totalPeople--;
        if (wasMonolith && S.raid) {
          endRaidAsFailed('💀 МОНОЛИТ РАЗРУШЕН! Набег прекращён.');
          return;
        }
      }
    }
    recomputeBuffs();
    recomputeCap();
    recomputeRates();
  }

  // Люди в клетке бьют босса: урон идёт постоянно, а не раз в секунду.
  const cellDmg = getCellDmg(idx);
  let humansHere = 0;
  for (const s of slots) if (s && s.t === 'h') humansHere++;
  if (humansHere > 0) {
    S.boss.hp -= cellDmg * humansHere * dt;
    if (S.boss.hp <= 0) {
      triggerVictory();
      return;
    }
  }

  const hasTargets = slots.some(s => s && (s.t === 'h' || (s.t === 'bld' && s.worker)));

  if (idx === targetIdx) {
    // Босс на месте. Монолит без живого рабочего он сносит сразу.
    const m = monolith && monolith.cellIdx === idx ? slots[monolith.slotIdx] : null;
    if (m && (!m.worker || m.worker.hp <= 0)) {
      slots[monolith.slotIdx] = null;
      endRaidAsFailed('💀 МОНОЛИТ РАЗРУШЕН! Набег прекращён.');
    }
  } else if (!hasTargets) {
    // Пока есть кого бить — стоит на месте и чистит клетку.
    S.boss.moveTimer += dt;
    if (S.boss.moveTimer >= BOSS_MOVE_DELAY) {
      S.boss.moveTimer = 0;
      const next = findNextStepTowardTarget(idx, targetIdx);
      if (next !== -1 && next !== idx) {
        S.boss.cellIdx = next;
        updateBattleFlag(idx);
        updateBattleFlag(next);
      }
    }
  }
}

// ============ BATTLES ============
export function processBattles(dt) {
  let killed = 0;
  let changed = false;
  for (const [idx, slots] of S.cellSlots) {
    const cellDmg = getCellDmg(idx);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s) continue;

      if (s.t === 'b') {
        s.timer += dt;
        while (s.timer >= COMBAT_TICK) {
          s.timer -= 1;
          s.i.hp -= cellDmg;
          s.h.hp -= ENEMIES[s.i.biomeIdx || 0].dmg;
          let done = false;
          if (s.i.hp <= 0) {
            S.chaosBlood += ENEMIES[s.i.biomeIdx || 0].reward;
            killed++;
            if (s.h.hp <= 0) { S.totalPeople--; slots[i] = null; }
            else slots[i] = { t: 'h', hp: s.h.hp, maxHp: s.h.maxHp };
            done = true;
          } else if (s.h.hp <= 0) {
            S.totalPeople--;
            slots[i] = { t: 'i', hp: Math.max(1, s.i.hp), maxHp: s.i.maxHp, biomeIdx: s.i.biomeIdx };
            done = true;
          }
          if (done) { updateBattleFlag(idx); changed = true; break; }
        }
      } else if (s.t === 'bld' && s.battle) {
        s.battle.timer += dt;
        while (s.battle.timer >= COMBAT_TICK) {
          s.battle.timer -= 1;
          s.battle.i.hp -= cellDmg;
          s.worker.hp -= ENEMIES[s.battle.i.biomeIdx || 0].dmg;
          let done = false;
          if (s.battle.i.hp <= 0) {
            S.chaosBlood += ENEMIES[s.battle.i.biomeIdx || 0].reward;
            killed++;
            if (s.worker.hp <= 0) {
              S.totalPeople--;
              slots[i] = null;
            } else {
              s.battle = null;
            }
            done = true;
          } else if (s.worker.hp <= 0) {
            S.totalPeople--;
            slots[i] = { t: 'i', hp: Math.max(1, s.battle.i.hp), maxHp: s.battle.i.maxHp, biomeIdx: s.battle.i.biomeIdx };
            done = true;
          }
          if (done) { updateBattleFlag(idx); changed = true; break; }
        }
      }
    }
  }
  if (killed > 0 || changed) {
    recomputeBuffs();
    recomputeCap();
    recomputeRates();
  }
}

export function mergeBattles() {
  let changed = false;
  for (const [idx, slots] of S.cellSlots) {
    let cellChanged = true;
    let safety = 0;
    while (cellChanged && safety < BATTLE_MERGE_SAFETY) {
      cellChanged = false;
      safety++;

      let enemyIdx = -1;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i] && slots[i].t === 'i') { enemyIdx = i; break; }
      }
      if (enemyIdx === -1) break;

      let humanIdx = -1;
      for (let i = 0; i < slots.length; i++) {
        if (i === enemyIdx) continue;
        if (slots[i] && slots[i].t === 'h') { humanIdx = i; break; }
      }
      if (humanIdx !== -1) {
        const e = slots[enemyIdx];
        const h = slots[humanIdx];
        slots[humanIdx] = {
          t: 'b',
          h: { hp: h.hp, maxHp: h.maxHp },
          i: { hp: e.hp, maxHp: e.maxHp, biomeIdx: e.biomeIdx },
          timer: 0
        };
        slots[enemyIdx] = null;
        S.cellHasBattle.set(idx, true);
        changed = true;
        cellChanged = true;
        continue;
      }

      let bldWorkerIdx = -1;
      for (let i = 0; i < slots.length; i++) {
        if (i === enemyIdx) continue;
        if (slots[i] && slots[i].t === 'bld' && slots[i].worker && !slots[i].battle) {
          bldWorkerIdx = i; break;
        }
      }
      if (bldWorkerIdx !== -1) {
        const e = slots[enemyIdx];
        slots[bldWorkerIdx].battle = {
          i: { hp: e.hp, maxHp: e.maxHp, biomeIdx: e.biomeIdx },
          timer: 0
        };
        slots[enemyIdx] = null;
        S.cellHasBattle.set(idx, true);
        changed = true;
        cellChanged = true;
        continue;
      }

      let emptyBldIdx = -1;
      for (let i = 0; i < slots.length; i++) {
        if (i === enemyIdx) continue;
        if (slots[i] && slots[i].t === 'bld' && !slots[i].worker && !slots[i].battle) {
          emptyBldIdx = i; break;
        }
      }
      if (emptyBldIdx !== -1) {
        slots[emptyBldIdx] = slots[enemyIdx];
        slots[enemyIdx] = null;
        changed = true;
        cellChanged = true;
        continue;
      }

      break;
    }
  }
  if (changed) {
    recomputeBuffs();
    recomputeCap();
    recomputeRates();
    updateHUD();
    updateResourceUI();
  }
}

// ============ TOWER / HEALER ============
export function processTowersAndHealers(dt) {
  let changed = false;
  for (const [idx, slots] of S.cellSlots) {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || s.t !== 'bld' || !s.worker || s.battle) continue;
      const b = BUILDING_MAP[s.id];
      if (!b) continue;

      if (b.effect === 'tower') {
        s.timer = (s.timer || 0) + dt;
        while (s.timer >= COMBAT_TICK) {
          s.timer -= 1;
          // Priority: S.boss
          if (S.boss && (S.boss.cellIdx === idx || S.neighborLists[idx].includes(S.boss.cellIdx))) {
            S.boss.hp -= b.power;
            if (S.boss.hp <= 0) { triggerVictory(); return; }
            continue;
          }
          const area = [idx, ...S.neighborLists[idx]];
          const targets = [];
          for (const a of area) {
            if (!S.claimed.has(a)) continue;
            const slots2 = S.cellSlots.get(a);
            if (!slots2) continue;
            for (let k = 0; k < slots2.length; k++) {
              const t = slots2[k];
              if (!t) continue;
              if (t.t === 'i') targets.push({ idx: a, slotIdx: k, kind: 'i' });
              else if (t.t === 'b') targets.push({ idx: a, slotIdx: k, kind: 'b' });
              else if (t.t === 'bld' && t.battle) targets.push({ idx: a, slotIdx: k, kind: 'bldb' });
            }
          }
          if (targets.length === 0) break;
          const pick = targets[Math.floor(Math.random() * targets.length)];
          const tslots = S.cellSlots.get(pick.idx);
          const target = tslots[pick.slotIdx];

          if (pick.kind === 'i') {
            target.hp -= b.power;
            if (target.hp <= 0) {
              S.chaosBlood += ENEMIES[target.biomeIdx || 0].reward;
              tslots[pick.slotIdx] = null;
              changed = true;
            }
          } else if (pick.kind === 'b') {
            target.i.hp -= b.power;
            if (target.i.hp <= 0) {
              S.chaosBlood += ENEMIES[target.i.biomeIdx || 0].reward;
              if (target.h.hp <= 0) { S.totalPeople--; tslots[pick.slotIdx] = null; }
              else tslots[pick.slotIdx] = { t: 'h', hp: target.h.hp, maxHp: target.h.maxHp };
              updateBattleFlag(pick.idx);
              changed = true;
            }
          } else if (pick.kind === 'bldb') {
            target.battle.i.hp -= b.power;
            if (target.battle.i.hp <= 0) {
              S.chaosBlood += ENEMIES[target.battle.i.biomeIdx || 0].reward;
              target.battle = null;
              updateBattleFlag(pick.idx);
              changed = true;
            }
          }
        }
      } else if (b.effect === 'healer') {
        s.timer = (s.timer || 0) + dt;
        while (s.timer >= COMBAT_TICK) {
          s.timer -= 1;
          const area = [idx, ...S.neighborLists[idx]];
          const wounded = [];
          for (const a of area) {
            if (!S.claimed.has(a)) continue;
            const slots2 = S.cellSlots.get(a);
            if (!slots2) continue;
            for (let k = 0; k < slots2.length; k++) {
              const t = slots2[k];
              if (!t) continue;
              if (t.t === 'h' && t.hp < t.maxHp) wounded.push({ idx: a, slotIdx: k });
              else if (t.t === 'b' && t.h.hp < t.h.maxHp) wounded.push({ idx: a, slotIdx: k });
              else if (t.t === 'bld' && t.worker && t.worker.hp < t.worker.maxHp) wounded.push({ idx: a, slotIdx: k });
            }
          }
          if (wounded.length === 0) break;
          const pick = wounded[Math.floor(Math.random() * wounded.length)];
          const hslots = S.cellSlots.get(pick.idx);
          const target = hslots[pick.slotIdx];
          if (target.t === 'h') target.hp = Math.min(target.maxHp, target.hp + HEALER_HEAL_AMOUNT);
          else if (target.t === 'b') target.h.hp = Math.min(target.h.maxHp, target.h.hp + HEALER_HEAL_AMOUNT);
          else if (target.t === 'bld' && target.worker) target.worker.hp = Math.min(target.worker.maxHp, target.worker.hp + HEALER_HEAL_AMOUNT);
          changed = true;
        }
      }
    }
  }
  if (changed) {
    updateHUD();
    updateResourceUI();
  }
}

// ============ AUTO-REPLACE ============
export function autoReplaceReserved() {
  if (getPoolPeople() <= 0) return;
  let changed = false;
  for (const [idx, slots] of S.cellSlots) {
    const reserved = S.cellSlotReserved.get(idx);
    if (!reserved) continue;
    const maxHp = getCellMaxHp(idx);
    for (let i = 0; i < slots.length; i++) {
      if (getPoolPeople() <= 0) break;
      if (!reserved[i]) continue;
      const s = slots[i];
      if (s === null) {
        slots[i] = { t: 'h', hp: maxHp, maxHp: maxHp };
        changed = true;
      } else if (s.t === 'i') {
        slots[i] = {
          t: 'b',
          h: { hp: maxHp, maxHp: maxHp },
          i: { hp: s.hp, maxHp: s.maxHp, biomeIdx: s.biomeIdx },
          timer: 0
        };
        S.cellHasBattle.set(idx, true);
        changed = true;
      } else if (s.t === 'bld' && !s.worker) {
        const b = BUILDING_MAP[s.id];
        if (b && b.noWorker) continue;
        s.worker = { hp: maxHp, maxHp: maxHp };
        changed = true;
      }
    }
  }
  if (changed) {
    recomputeBuffs();
    recomputeRates();
    updateHUD();
    updateResourceUI();
  }
}

// ============ ECONOMY TICK ============
export function tick() {
  const now = performance.now();
  const dt = Math.min((now - S.lastTick) / 1000, MAX_TICK_DT);
  S.lastTick = now;
  if (S.gameWon) return;

  try {
    // Spawn people
    if (S.totalPeople < getPortalCap()) {
      S.spawnTimer += dt;
      const st = getSpawnTime();
      while (S.spawnTimer >= st && S.totalPeople < getPortalCap()) {
        S.spawnTimer -= st;
        S.totalPeople++;
      }
    } else {
      S.spawnTimer = 0;
    }

    // Raid timing. Босс не переживает набег: иначе он навсегда остаётся в
    // мире, а новый набег становится невозможен (см. startRaid).
    if (S.raid) {
      S.raid.elapsed += dt;
      if (!S.raid.bossSpawned && S.raid.elapsed >= RAID_BOSS_DELAY) {
        S.raid.bossSpawned = true;
        spawnRaidBoss();
      }
      if (S.raid.elapsed >= RAID_DURATION) {
        if (S.boss) {
          endRaidAsFailed('💀 Босс не убит — набег окончен, монолит уцелел.');
        } else {
          S.raid = null;
          showToast('Набег демонов завершён', 2000);
        }
      }
    }

    // Spawn enemies (with raid multiplier, overridable via CE.raidMult)
    const spawnMult = isRaidActive() ? S.raidSpawnMult : 1;
    for (const [idx] of S.claimed) {
      let period = getImpPeriod(idx);
      if (period === Infinity) { S.cellImpTimers.set(idx, 0); continue; }
      period = period / spawnMult;
      let t = (S.cellImpTimers.get(idx) || 0) + dt;
      while (t >= period) {
        const success = trySpawnEnemyOnCell(idx);
        if (success) {
          t -= period;
        } else {
          t = period;
          break;
        }
      }
      S.cellImpTimers.set(idx, t);
    }

    processBattles(dt);
    processBoss(dt);
    processTowersAndHealers(dt);
    autoReplaceReserved();
    mergeBattles();

    // Production + soft consumption
    for (let i = 0; i < BIOMES.length; i++) {
      const prod = S.cachedBiomeRates[i];
      const cons = S.cachedConsumption[i];
      S.resources[i] += prod * dt;
      S.resources[i] = Math.max(0, S.resources[i] - cons * dt);
    }

    S.uiAccum += dt;
    if (S.uiAccum >= UI_REFRESH_INTERVAL) {
      S.uiAccum = 0;
      updateHUD();
      updateResourceUI();
      updateRaidHud();
    }

    S.popupRefreshAcc += dt;
    if (S.popupRefreshAcc >= POPUP_REFRESH_INTERVAL) {
      S.popupRefreshAcc = 0;
      if (S.pendingIdx !== null && !popup.classList.contains('hidden') && !S.pendingBuildMode) {
        renderPopup();
      }
    }
  } catch (err) {
    console.error('tick error:', err);
  }
}
