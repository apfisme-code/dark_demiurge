// ===========================================================================
// state.js — всё изменяемое состояние игры и производные от него величины.
//
// Почему состояние лежит в объекте S, а не в отдельных `let`:
// в ES-модулях импортированную привязку нельзя переприсвоить из другого
// файла. Объект снимает это ограничение — S.claimed можно и читать, и менять
// откуда угодно. Плата — префикс S. в каждом обращении; он же, наоборот,
// делает видно, что идёт мутация глобального состояния.
//
// Группы:
//   1. вид и геометрия мира;
//   2. состояние клеток (захват, слоты, таймеры врагов);
//   3. экономика и прогресс;
//   4. набег;
//   5. UI и ввод.
// ===========================================================================
import {
  BIOMES, BUILDING_MAP,
  CLAIM_BASE_FACTOR, CLAIM_BASE_MIN, CLAIM_BASE_MAX, CLAIM_CAP_DIVISOR,
  BASE_RATE, HUMAN_BASE_HP, HUMAN_BASE_DMG,
  PORTAL_BASE_CAPACITY, PORTAL_MAX_LEVEL,
  PORTAL_UPGRADE_BASE_COST, PORTAL_UPGRADE_GROWTH,
  PORTAL_SPAWN_TIME_START, PORTAL_SPAWN_TIME_MIN,
  IMP_BASE_PERIOD, IMP_MAX_PERIOD, BIOME_UNLOCK_LEVEL, RAID_SPAWN_MULT,
} from './config.js';
import { clampCam, generateWorld } from './world.js';
import { resetGameState } from './main.js';
import { updateHUD, updateResourceUI, renderLegend } from './ui.js';

export const S = {
  // --- 1. Вид и геометрия ------------------------------------------------
  /** Ширина/высота канваса в CSS-пикселях (без учёта devicePixelRatio). */
  width: 0, height: 0,
  /** Плотность пикселей: во сколько раз канвас больше по размеру, чем по координатам. */
  dpr: 1,
  /** Размеры мира в тех же координатах, что и канвас. */
  worldW: 0, worldH: 0,
  /** Положение камеры (левый верхний угол видимой области мира). */
  camX: 0, camY: 0,

  /** Опорные точки диаграммы Вороного, по одной на клетку. */
  points: [],
  delaunay: null, voronoi: null,
  /** Соседи каждой клетки по триангуляции Делоне. */
  neighborLists: [],
  /** Общие границы: Map(сосед) → { len, p1, p2 }. */
  sharedEdge: [],
  /** Порог длины общей границы, при котором клетку можно захватить. */
  MIN_EDGE_LENGTH: 8,

  /** Кэши геометрии клеток — считаются один раз при генерации мира. */
  cellPolygonCache: [], cellCentroidCache: [], cellBBoxCache: [],
  cellPerimeterCache: [], cellCaps: [], cellRadius: [],

  // --- 2. Состояние клеток ----------------------------------------------
  /** Захваченные клетки: индекс → индекс биома. */
  claimed: new Map(),
  /** Слоты каждой захваченной клетки. Тип слота: null | h | i | b | bld | portal. */
  cellSlots: new Map(),
  /** «Закреплённые» слоты: сюда автоподстановка будет возвращать людей. */
  cellSlotReserved: new Map(),
  /** Накопленное время до спавна врага в клетке, сек. */
  cellImpTimers: new Map(),
  /** Клетки, где сейчас идёт бой (кэш для UI и отрисовки). */
  cellHasBattle: new Map(),
  /** Клетки, доступные для захвата прямо сейчас. */
  claimableSet: new Set(),
  /** Баффы клетки от построек на ней и у соседей: { maxHp, dmg, prodMult }. */
  cellBuffs: new Map(),

  /** Синергия клетки: доля границы, занятой тем же биомом. */
  cellSynergy: [],
  /** Доля границы клетки, граничащая с пустотой. 0 — тыл, 1 — чистый фронт. */
  cellVoidFraction: [],

  // --- 3. Экономика и прогресс ------------------------------------------
  /** Всего людей: занято в слотах + свободно в пуле. */
  totalPeople: 0,
  /** Отсчёт до следующего человека из пула, сек. */
  spawnTimer: 0,
  /** Кровь хаоса — валюта захвата клеток и апгрейда портала. */
  chaosBlood: 0,
  /** Запасы ресурсов по биомам (индекс массива = индекс биома). */
  resources: new Array(BIOMES.length).fill(0),
  /** Сколько клеток захвачено в каждом биоме. */
  biomeCounts: new Array(BIOMES.length).fill(0),
  /** Площадь захваченных клеток по биомам — веса при выборе врага. */
  biomeAreas: new Array(BIOMES.length).fill(0),
  totalClaimedArea: 0,
  /** Производство и потребление по биомам, юнитов/сек (пересчитывается при изменениях). */
  cachedBiomeRates: new Array(BIOMES.length).fill(0),
  cachedConsumption: new Array(BIOMES.length).fill(0),
  /** Лимит людей = базовый + дома. */
  cachedPortalCap: PORTAL_BASE_CAPACITY,

  portalLevel: 1,
  portalCellIdx: -1,
  portalBiomeIdx: -1,

  // --- 4. Набег ----------------------------------------------------------
  gameWon: false,
  /** Активный набег: { elapsed, bossSpawned }. null — набега нет. */
  raid: null,
  /** Множитель спавна врагов во время набега. Подавляется отладкой (CE.raidMult). */
  raidSpawnMult: RAID_SPAWN_MULT,
  /** Босс: { cellIdx, hp, maxHp, dmg, moveTimer, atkTimer }. null — босса нет. */
  boss: null,

  // --- 5. UI и ввод ------------------------------------------------------
  hoveredIndex: -1,
  /** Клетка, открытая в попапе. */
  pendingIdx: null,
  /** Попап сейчас в режиме выбора постройки. */
  pendingBuildMode: false,
  popupType: null, popupIdx: -1, popupSignature: '', lastRenderedPool: -1,
  lastMouseX: 0, lastMouseY: 0,

  lastTick: performance.now(),
  lastRenderTime: performance.now(),
  popupRefreshAcc: 0, uiAccum: 0,
  economyTimer: null,

  isDragging: false, dragMoved: false,
  dragStartX: 0, dragStartY: 0, dragStartCamX: 0, dragStartCamY: 0,
  keysPressed: new Set(),

  undoSnapshot: null, undoTimer: null,

  // --- Предрендеренные спрайты (заполняются sprites.js) ------------------
  biomeSprites: [], humanSprite: null, enemySprites: [], buildingSprites: [],
};

// DOM-ссылки живут здесь же: их читают почти все модули.
export const canvas = document.getElementById('canvas');
export const ctx = canvas.getContext('2d');
export const popup = document.getElementById('popup');
export const resourceList = document.getElementById('resourceList');
export const undoToast = document.getElementById('undoToast');
export const undoBtn = document.getElementById('undoBtn');
export const undoText = document.getElementById('undoText');
export const toastEl = document.getElementById('toast');
export const winScreen = document.getElementById('winScreen');
export const raidHudEl = document.getElementById('raidHud');

// ============== HELPERS ============
export function getSpawnTime() {
  // L1: 10s → L30: 1s (линейно)
  const t = PORTAL_SPAWN_TIME_START - (S.portalLevel - 1) *
    (PORTAL_SPAWN_TIME_START - PORTAL_SPAWN_TIME_MIN) / (PORTAL_MAX_LEVEL - 1);
  return Math.max(PORTAL_SPAWN_TIME_MIN, t);
}

export function recomputeCap() {
  let cap = PORTAL_BASE_CAPACITY;
  for (const slots of S.cellSlots.values()) {
    for (const s of slots) {
      if (!s || s.t !== 'bld' || s.battle) continue;
      const b = BUILDING_MAP[s.id];
      if (b && b.effect === 'house') cap += b.power;
    }
  }
  S.cachedPortalCap = cap;
}
export function getPortalCap() { return S.cachedPortalCap; }

export function countSlots() {
  let humans = 0, enemies = 0;
  for (const slots of S.cellSlots.values()) {
    for (const s of slots) {
      if (!s) continue;
      if (s.t === 'h') humans++;
      else if (s.t === 'i') enemies++;
      else if (s.t === 'b') { humans++; enemies++; }
      else if (s.t === 'bld') {
        if (s.worker) humans++;
        if (s.battle) enemies++;
      }
    }
  }
  if (S.boss) enemies++;
  return { humans, enemies };
}

export function getHumanCount() {
  let c = 0;
  for (const slots of S.cellSlots.values()) {
    for (const s of slots) {
      if (!s) continue;
      if (s.t === 'h' || s.t === 'b') c++;
      else if (s.t === 'bld' && s.worker) c++;
    }
  }
  return c;
}

export function getPoolPeople() { return Math.max(0, S.totalPeople - getHumanCount()); }

export function getPeopleOn(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return 0;
  let c = 0;
  for (const s of slots) {
    if (!s) continue;
    if (s.t === 'h' || s.t === 'b') c++;
    else if (s.t === 'bld' && s.worker) c++;
  }
  return c;
}

export function getWorkingOn(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return 0;
  let c = 0;
  for (const s of slots) {
    if (!s) continue;
    if (s.t === 'h') c++;
    else if (s.t === 'bld' && s.worker && !s.battle) c++;
  }
  return c;
}

export function getWorkingOnBuildings(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return 0;
  let c = 0;
  for (const s of slots) {
    if (s && s.t === 'bld' && s.worker && !s.battle) c++;
  }
  return c;
}

export function getCellHpSum(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return { cur: 0, max: 0 };
  let cur = 0, max = 0;
  for (const s of slots) {
    if (!s) continue;
    if (s.t === 'h') { cur += s.hp; max += s.maxHp; }
    else if (s.t === 'b') { cur += s.h.hp; max += s.h.maxHp; }
    else if (s.t === 'bld' && s.worker) { cur += s.worker.hp; max += s.worker.maxHp; }
  }
  return { cur, max };
}

export function getEnemiesOn(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return 0;
  let c = 0;
  for (const s of slots) {
    if (!s) continue;
    if (s.t === 'i' || s.t === 'b') c++;
    else if (s.t === 'bld' && s.battle) c++;
  }
  if (S.boss && S.boss.cellIdx === idx) c++;
  return c;
}

export function updateBattleFlag(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) { S.cellHasBattle.delete(idx); return; }
  let has = false;
  for (const s of slots) {
    if (!s) continue;
    if (s.t === 'b' || (s.t === 'bld' && s.battle)) { has = true; break; }
  }
  if (S.boss && S.boss.cellIdx === idx) has = true;
  if (has) S.cellHasBattle.set(idx, true);
  else S.cellHasBattle.delete(idx);
}

export function getReservedArr(idx) {
  let arr = S.cellSlotReserved.get(idx);
  if (!arr) {
    const slots = S.cellSlots.get(idx);
    if (!slots) return null;
    arr = new Array(slots.length).fill(false);
    S.cellSlotReserved.set(idx, arr);
  }
  return arr;
}

export function getCellCap(idx) {
  if (idx === S.portalCellIdx) return PORTAL_BASE_CAPACITY;
  const slots = S.cellSlots.get(idx);
  if (slots) return slots.length;
  return S.cellCaps[idx] || 1;
}

export function getClaimCost(idx) {
  const cap = S.cellCaps[idx] || 1;
  const base = Math.max(CLAIM_BASE_MIN, Math.min(CLAIM_BASE_MAX, Math.ceil(cap / CLAIM_CAP_DIVISOR)));
  const n = Math.max(0, S.claimed.size - 1);
  return Math.max(1, Math.round(base * (1 + n * n * CLAIM_BASE_FACTOR)));
}

export function isBiomeUnlocked(biomeIdx) { return S.portalLevel >= BIOME_UNLOCK_LEVEL[biomeIdx]; }
export function getBiomeUnlockLevel(biomeIdx) { return BIOME_UNLOCK_LEVEL[biomeIdx]; }

export function getPortalUpgradeCost() {
  return Math.round(PORTAL_UPGRADE_BASE_COST * Math.pow(PORTAL_UPGRADE_GROWTH, S.portalLevel - 1));
}

export function canUpgradePortal() {
  if (S.portalLevel >= PORTAL_MAX_LEVEL) return false;
  return S.chaosBlood >= getPortalUpgradeCost();
}

export function getImpPeriod(idx) {
  const vf = S.cellVoidFraction[idx] || 0;
  if (vf <= 0) return Infinity;
  return Math.min(IMP_MAX_PERIOD, IMP_BASE_PERIOD / vf);
}

/** Набег активен, пока он не закончился. Таймера у набега нет. */
export function isRaidActive() {
  return S.raid !== null;
}

// ============ БАФФЫ ============
export function recomputeBuffs() {
  S.cellBuffs.clear();
  for (const [idx] of S.claimed) {
    let maxHp = HUMAN_BASE_HP;
    let dmg = HUMAN_BASE_DMG;
    let prodMult = 1.0;
    let hasArmor1 = false, hasArmor2 = false, hasArmor3 = false;
    let hasWeapon1 = false, hasWeapon2 = false, hasWeapon3 = false;
    let hasWh1 = false, hasWh2 = false, hasWh3 = false;

    const area = [idx, ...S.neighborLists[idx]];
    for (const a of area) {
      if (!S.claimed.has(a)) continue;
      const slots = S.cellSlots.get(a);
      if (!slots) continue;
      for (const s of slots) {
        if (!s || s.t !== 'bld' || !s.worker || s.battle) continue;
        const b = BUILDING_MAP[s.id];
        if (!b) continue;
        if (b.effect === 'armor') {
          if (b.id === 12) hasArmor3 = true;
          else if (b.id === 4) hasArmor2 = true;
          else if (b.id === 2) hasArmor1 = true;
        } else if (b.effect === 'weapon') {
          if (b.id === 13) hasWeapon3 = true;
          else if (b.id === 5) hasWeapon2 = true;
          else if (b.id === 3) hasWeapon1 = true;
        } else if (b.effect === 'warehouse') {
          if (b.id === 11) hasWh3 = true;
          else if (b.id === 6) hasWh2 = true;
          else if (b.id === 1) hasWh1 = true;
        }
      }
    }
    if (hasArmor3) maxHp = HUMAN_BASE_HP + 20;
    else if (hasArmor2) maxHp = HUMAN_BASE_HP + 10;
    else if (hasArmor1) maxHp = HUMAN_BASE_HP + 5;

    if (hasWeapon3) dmg = HUMAN_BASE_DMG + 5;
    else if (hasWeapon2) dmg = HUMAN_BASE_DMG + 3;
    else if (hasWeapon1) dmg = HUMAN_BASE_DMG + 2;

    if (hasWh3) prodMult = 1.3;
    else if (hasWh2) prodMult = 1.2;
    else if (hasWh1) prodMult = 1.1;

    S.cellBuffs.set(idx, { maxHp, dmg, prodMult });
  }
}

export function getCellMaxHp(idx) { return (S.cellBuffs.get(idx) || { maxHp: HUMAN_BASE_HP }).maxHp; }
export function getCellDmg(idx) { return (S.cellBuffs.get(idx) || { dmg: HUMAN_BASE_DMG }).dmg; }
export function getCellProdMult(idx) { return (S.cellBuffs.get(idx) || { prodMult: 1 }).prodMult; }

export function recomputeRates() {
  const biomeRates = new Array(BIOMES.length).fill(0);
  const consumption = new Array(BIOMES.length).fill(0);
  for (const [idx, slots] of S.cellSlots) {
    const biomeIdx = S.claimed.get(idx);
    if (biomeIdx === undefined) continue;

    // Производство (только 'h'-слоты).
    // Скорость одинакова для всех биомов: различаются сами ресурсы и враги,
    // а не темп добычи. Рабочий в бою или занятый постройкой не добывает.
    let humansWorking = 0;
    for (const s of slots) if (s && s.t === 'h') humansWorking++;
    if (humansWorking > 0) {
      const syn = S.cellSynergy[idx] || 1;
      const mult = getCellProdMult(idx);
      biomeRates[biomeIdx] += humansWorking * BASE_RATE * syn * mult;
    }

    // Потребление построек
    for (const s of slots) {
      if (!s || s.t !== 'bld') continue;
      const b = BUILDING_MAP[s.id];
      if (!b || !b.consumes) continue;
      for (const k in b.consumes) {
        consumption[+k] += b.consumes[k];
      }
    }
  }
  S.cachedBiomeRates = biomeRates;
  S.cachedConsumption = consumption;
}

export function isClaimableRaw(i) {
  if (S.claimed.has(i)) return false;
  const edges = S.sharedEdge[i];
  if (!edges) return false;
  for (const [n, edge] of edges) {
    if (S.claimed.has(n) && edge.len >= S.MIN_EDGE_LENGTH) return true;
  }
  return false;
}

export function recomputeClaimableSet() {
  S.claimableSet.clear();
  for (let i = 0; i < S.points.length; i++) {
    if (isClaimableRaw(i)) S.claimableSet.add(i);
  }
}

// ============ BUILDING COST ============
export function canAffordBuilding(b) {
  for (const k in b.cost) {
    if (S.resources[k] < b.cost[k]) return false;
  }
  return true;
}

export function payForBuilding(b) {
  for (const k in b.cost) S.resources[k] -= b.cost[k];
}
// ============ UNDO ============
export function makeSnapshot() {
  const slotsCopy = new Map();
  for (const [idx, slots] of S.cellSlots) {
    slotsCopy.set(idx, slots.map(s => {
      if (!s) return null;
      if (s.t === 'h' || s.t === 'i') return { ...s };
      if (s.t === 'b') return { t: 'b', h: { ...s.h }, i: { ...s.i }, timer: s.timer };
      if (s.t === 'portal') return { t: 'portal' };
      if (s.t === 'bld') return {
        t: 'bld', id: s.id,
        worker: s.worker ? { ...s.worker } : null,
        battle: s.battle ? { i: { ...s.battle.i }, timer: s.battle.timer } : null,
        timer: s.timer || 0
      };
      return null;
    }));
  }
  const reservedCopy = new Map();
  for (const [idx, arr] of S.cellSlotReserved) reservedCopy.set(idx, arr.slice());

  return {
    points: S.points, delaunay: S.delaunay, voronoi: S.voronoi,
    neighborLists: S.neighborLists, sharedEdge: S.sharedEdge,
    cellCaps: S.cellCaps, cellRadius: S.cellRadius,
    cellPolygonCache: S.cellPolygonCache, cellCentroidCache: S.cellCentroidCache,
    cellBBoxCache: S.cellBBoxCache, cellPerimeterCache: S.cellPerimeterCache,
    MIN_EDGE_LENGTH: S.MIN_EDGE_LENGTH, portalCellIdx: S.portalCellIdx,
    claimed: new Map(S.claimed),
    cellSlots: slotsCopy,
    cellSlotReserved: reservedCopy,
    cellImpTimers: new Map(S.cellImpTimers),
    cellHasBattle: new Map(S.cellHasBattle),
    totalPeople: S.totalPeople, spawnTimer: S.spawnTimer, chaosBlood: S.chaosBlood,
    resources: S.resources.slice(),
    biomeCounts: S.biomeCounts.slice(),
    portalLevel: S.portalLevel, portalBiomeIdx: S.portalBiomeIdx,
    cellSynergy: S.cellSynergy.slice(),
    cellVoidFraction: S.cellVoidFraction.slice(),
    cachedBiomeRates: S.cachedBiomeRates.slice(),
    cachedConsumption: S.cachedConsumption.slice(),
    camX: S.camX, camY: S.camY, gameWon: S.gameWon,
    biomeAreas: S.biomeAreas.slice(),
    totalClaimedArea: S.totalClaimedArea,
    cachedPortalCap: S.cachedPortalCap,
    raidState: S.raid ? { ...S.raid } : null,
    bossState: S.boss ? { ...S.boss } : null
  };
}

export function restoreSnapshot(s) {
  S.points = s.points;
  S.delaunay = s.delaunay;
  S.voronoi = s.voronoi;
  S.neighborLists = s.neighborLists;
  S.sharedEdge = s.sharedEdge;
  S.cellCaps = s.cellCaps;
  S.cellRadius = s.cellRadius;
  S.cellPolygonCache = s.cellPolygonCache;
  S.cellCentroidCache = s.cellCentroidCache;
  S.cellBBoxCache = s.cellBBoxCache;
  S.cellPerimeterCache = s.cellPerimeterCache;
  S.MIN_EDGE_LENGTH = s.MIN_EDGE_LENGTH;
  S.portalCellIdx = s.portalCellIdx;

  S.claimed = new Map(s.claimed);
  S.cellSlots = new Map();
  for (const [idx, slots] of s.cellSlots) {
    S.cellSlots.set(idx, slots.map(sl => {
      if (!sl) return null;
      if (sl.t === 'h' || sl.t === 'i') return { ...sl };
      if (sl.t === 'b') return { t: 'b', h: { ...sl.h }, i: { ...sl.i }, timer: sl.timer };
      if (sl.t === 'portal') return { t: 'portal' };
      if (sl.t === 'bld') return {
        t: 'bld', id: sl.id,
        worker: sl.worker ? { ...sl.worker } : null,
        battle: sl.battle ? { i: { ...sl.battle.i }, timer: sl.battle.timer } : null,
        timer: sl.timer || 0
      };
      return null;
    }));
  }
  S.cellSlotReserved = new Map();
  for (const [idx, arr] of s.cellSlotReserved) S.cellSlotReserved.set(idx, arr.slice());
  S.cellImpTimers = new Map(s.cellImpTimers);
  S.cellHasBattle = new Map(s.cellHasBattle);
  S.totalPeople = s.totalPeople;
  S.spawnTimer = s.spawnTimer;
  S.chaosBlood = s.chaosBlood;
  S.resources = s.resources.slice();
  S.biomeCounts = s.biomeCounts.slice();
  S.portalLevel = s.portalLevel;
  S.portalBiomeIdx = s.portalBiomeIdx;
  S.cellSynergy = s.cellSynergy.slice();
  S.cellVoidFraction = s.cellVoidFraction.slice();
  S.cachedBiomeRates = s.cachedBiomeRates.slice();
  S.cachedConsumption = s.cachedConsumption.slice();
  S.biomeAreas = s.biomeAreas.slice();
  S.totalClaimedArea = s.totalClaimedArea;
  S.camX = s.camX;
  S.camY = s.camY;
  S.gameWon = s.gameWon;
  S.raid = s.raidState ? { ...s.raidState } : null;
  S.boss = s.bossState ? { ...s.bossState } : null;
  if (!S.gameWon) winScreen.classList.remove('show');
  if (!S.raid) raidHudEl.classList.add('hidden');

  recomputeClaimableSet();
  recomputeBuffs();
  recomputeCap();

  clampCam();
  updateHUD();
  updateResourceUI();
  renderLegend();
}

export function showUndoToast(text, duration) {
  document.getElementById('undoText').textContent = text;
  undoToast.classList.remove('hidden');
  clearTimeout(S.undoTimer);
  S.undoTimer = setTimeout(() => {
    hideUndoToast();
    S.undoSnapshot = null;
  }, duration);
}

export function hideUndoToast() { undoToast.classList.add('hidden'); }

export function doResetWithUndo() {
  S.undoSnapshot = makeSnapshot();
  generateWorld();
  resetGameState();
  showUndoToast('Новая карта создана', 5000);
}

export function undoReset() {
  if (!S.undoSnapshot) return;
  restoreSnapshot(S.undoSnapshot);
  S.undoSnapshot = null;
  hideUndoToast();
  S.lastTick = performance.now();
}
