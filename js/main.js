// ===========================================================================
// main.js — сборка приложения: события ввода, цикл кадра, старт.
//
// Единственный модуль, который что-то делает сам при загрузке. Всё остальное
// экспортирует функции и ждёт вызова.
// ===========================================================================
import * as CONFIG from './config.js';
import {
  BIOMES, HUMAN_BASE_HP, TICK_INTERVAL_MS, RENDER_MAX_DT, CAMERA_SPEED,
} from './config.js';
import {
  S, canvas, popup, undoToast, undoBtn, toastEl, winScreen, raidHudEl,
  recomputeCap, isBiomeUnlocked, recomputeBuffs, recomputeRates, getPoolPeople,
  getReservedArr, getPortalCap, recomputeClaimableSet, doResetWithUndo,
  undoReset, hideUndoToast,
} from './state.js';
import { setup, clampCam, generateWorld, recomputeAllCaches } from './world.js';
import { draw } from './render.js';
import {
  updateHUD, updateResourceUI, updateRaidHud, renderResourceRows,
  hideMainToast, renderPopup, hidePopup, renderLegend,
} from './ui.js';
import {
  claimCell, startRaid, spawnRaidBoss, triggerVictory, findMonolith, tick,
  placeBuilding, hasMonolithActive, autoReplaceReserved,
} from './logic.js';

// d3-delaunay грузится CDN-скриптом выше модуля. Без него диаграмму Вороного
// построить нечем, поэтому падаем сразу и с понятным сообщением.
if (typeof d3 === 'undefined' || !d3.Delaunay) {
  document.getElementById('loadError').classList.add('show');
  throw new Error('d3-delaunay not loaded');
}

export function resetGameState() {
  S.claimed = new Map();
  S.cellSlots = new Map();
  S.cellSlotReserved = new Map();
  S.cellImpTimers = new Map();
  S.cellHasBattle = new Map();
  S.cellBuffs = new Map();
  S.totalPeople = 0;
  S.spawnTimer = 0;
  S.chaosBlood = 0;
  S.resources = new Array(BIOMES.length).fill(0);
  S.biomeCounts = new Array(BIOMES.length).fill(0);
  S.portalLevel = 1;
  S.hoveredIndex = -1;
  S.pendingIdx = null;
  S.pendingBuildMode = false;
  S.popupRefreshAcc = 0;
  S.uiAccum = 0;
  S.popupType = null;
  S.popupIdx = -1;
  S.popupSignature = '';
  S.lastRenderedPool = -1;
  S.gameWon = false;
  S.raid = null;
  S.boss = null;
  winScreen.classList.remove('show');
  raidHudEl.classList.add('hidden');
  hidePopup();

  S.portalBiomeIdx = 0;
  S.claimed.set(S.portalCellIdx, S.portalBiomeIdx);
  S.biomeCounts[S.portalBiomeIdx] = 1;

  S.cellSlots.set(S.portalCellIdx, [
    { t: 'portal' },
    null, null, null, null
  ]);
  S.cellSlotReserved.set(S.portalCellIdx, [false, false, false, false, false]);
  S.cellImpTimers.set(S.portalCellIdx, 0);

  S.totalPeople = 2;
  const pslots = S.cellSlots.get(S.portalCellIdx);
  const pres = S.cellSlotReserved.get(S.portalCellIdx);
  pslots[1] = { t: 'h', hp: HUMAN_BASE_HP, maxHp: HUMAN_BASE_HP };
  pres[1] = true;

  recomputeAllCaches();
  recomputeClaimableSet();
  recomputeBuffs();
  recomputeCap();
  recomputeRates();

  S.camX = S.points[S.portalCellIdx][0] - S.width / 2;
  S.camY = S.points[S.portalCellIdx][1] - S.height / 2;
  clampCam();

  renderResourceRows();
  updateHUD();
  updateResourceUI();
  renderLegend();

  if (S.economyTimer) clearInterval(S.economyTimer);
  S.lastTick = performance.now();
  S.economyTimer = setInterval(tick, TICK_INTERVAL_MS);
}

export function initGame() {
  generateWorld();
  resetGameState();
}

export function handleResize() {
  setup();
  if (S.worldW > 0 && S.worldH > 0) clampCam();
}

// ============ EVENTS ============
function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left + S.camX, y: clientY - rect.top + S.camY };
}

function pickCellAt(clientX, clientY) {
  const w = screenToWorld(clientX, clientY);
  if (w.x < 0 || w.y < 0 || w.x > S.worldW || w.y > S.worldH) return -1;
  const idx = S.delaunay.find(w.x, w.y);
  return (typeof idx === 'number' && idx >= 0) ? idx : -1;
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  S.isDragging = true;
  S.dragMoved = false;
  S.dragStartX = e.clientX;
  S.dragStartY = e.clientY;
  S.dragStartCamX = S.camX;
  S.dragStartCamY = S.camY;
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('mousemove', (e) => {
  S.lastMouseX = e.clientX;
  S.lastMouseY = e.clientY;
  if (S.isDragging) {
    const dx = e.clientX - S.dragStartX;
    const dy = e.clientY - S.dragStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) S.dragMoved = true;
    S.camX = S.dragStartCamX - dx;
    S.camY = S.dragStartCamY - dy;
    clampCam();
    return;
  }
  const idx = pickCellAt(e.clientX, e.clientY);
  let newHover = -1;
  let cursor = 'grab';
  if (idx !== -1) {
    if (S.claimed.has(idx)) { newHover = idx; cursor = 'pointer'; }
    else if (S.claimableSet.has(idx)) { newHover = idx; cursor = 'pointer'; }
  }
  if (newHover !== S.hoveredIndex || canvas.style.cursor !== cursor) {
    S.hoveredIndex = newHover;
    canvas.style.cursor = cursor;
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (!S.isDragging) return;
  const wasDrag = S.dragMoved;
  S.isDragging = false;
  S.dragMoved = false;
  canvas.style.cursor = 'grab';
  if (!wasDrag) {
    const idx = pickCellAt(e.clientX, e.clientY);
    if (idx === -1) { hidePopup(); return; }
    if (S.claimed.has(idx) || S.claimableSet.has(idx)) {
      S.lastMouseX = e.clientX;
      S.lastMouseY = e.clientY;
      S.pendingIdx = idx;
      S.pendingBuildMode = false;
      S.popupSignature = '';
      renderPopup();
    } else {
      hidePopup();
    }
  }
});

canvas.addEventListener('mouseleave', () => {
  S.isDragging = false;
  S.dragMoved = false;
  canvas.style.cursor = 'grab';
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  S.camY += e.deltaY;
  clampCam();
}, { passive: false });

function synthesizeMouse(type, clientX, clientY, button) {
  canvas.dispatchEvent(new MouseEvent(type, {
    clientX: clientX,
    clientY: clientY,
    button: button || 0,
    bubbles: true,
    cancelable: true
  }));
}

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  synthesizeMouse('mousedown', t.clientX, t.clientY, 0);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  synthesizeMouse('mousemove', t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  if (!t) return;
  synthesizeMouse('mouseup', t.clientX, t.clientY, 0);
}, { passive: false });

canvas.addEventListener('touchcancel', () => {
  S.isDragging = false;
  S.dragMoved = false;
  canvas.style.cursor = 'grab';
}, { passive: true });

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (toastEl.classList.contains('show')) { hideMainToast(); return; }
    if (!popup.classList.contains('hidden')) {
      if (S.pendingBuildMode) {
        S.pendingBuildMode = false;
        S.popupSignature = '';
        renderPopup();
        return;
      }
      hidePopup();
      return;
    }
    if (!undoToast.classList.contains('hidden')) {
      clearTimeout(S.undoTimer);
      hideUndoToast();
      S.undoSnapshot = null;
      return;
    }
    if (S.hoveredIndex !== -1) { S.hoveredIndex = -1; return; }
    return;
  }
  if (!popup.classList.contains('hidden') && S.pendingIdx !== null && !S.pendingBuildMode) {
    const num = parseInt(e.key, 10);
    if (!isNaN(num) && num >= 1 && num <= BIOMES.length) {
      const biomeIdx = num - 1;
      if (!S.claimed.has(S.pendingIdx) && S.claimableSet.has(S.pendingIdx) && isBiomeUnlocked(biomeIdx)) {
        if (claimCell(S.pendingIdx, biomeIdx)) hidePopup();
      }
      return;
    }
  }
  if (k === 'arrowleft' || k === 'a' || k === 'ф') S.keysPressed.add('left');
  else if (k === 'arrowright' || k === 'd' || k === 'в') S.keysPressed.add('right');
  else if (k === 'arrowup' || k === 'w' || k === 'ц') S.keysPressed.add('up');
  else if (k === 'arrowdown' || k === 's' || k === 'ы') S.keysPressed.add('down');
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a' || k === 'ф') S.keysPressed.delete('left');
  else if (k === 'arrowright' || k === 'd' || k === 'в') S.keysPressed.delete('right');
  else if (k === 'arrowup' || k === 'w' || k === 'ц') S.keysPressed.delete('up');
  else if (k === 'arrowdown' || k === 's' || k === 'ы') S.keysPressed.delete('down');
});

/** Полный сброс партии с возможностью отмены (5 секунд). */
function requestNewMap() {
  hidePopup();
  if (S.undoSnapshot) {
    clearTimeout(S.undoTimer);
    hideUndoToast();
    S.undoSnapshot = null;
  }
  doResetWithUndo();
}

document.getElementById('reset').addEventListener('click', requestNewMap);
// Экран победы перекрывает HUD, поэтому нужен свой выход.
document.getElementById('winReset').addEventListener('click', requestNewMap);

undoBtn.addEventListener('click', () => undoReset());

let resizeTimer;
window.addEventListener('resize', () => {
  hidePopup();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(handleResize, 120);
});

// ============ RENDER LOOP ============
export function renderLoop() {
  const now = performance.now();
  const dt = Math.min((now - S.lastRenderTime) / 1000, RENDER_MAX_DT);
  S.lastRenderTime = now;

  if (S.keysPressed.size > 0) {
    const sp = CAMERA_SPEED * dt;
    if (S.keysPressed.has('left'))  S.camX -= sp;
    if (S.keysPressed.has('right')) S.camX += sp;
    if (S.keysPressed.has('up'))    S.camY -= sp;
    if (S.keysPressed.has('down'))  S.camY += sp;
    clampCam();
  }

  draw();
  requestAnimationFrame(renderLoop);
}

// ===========================================================================
// Консольные команды.
//
// Открыть DevTools (F12) → Console → CE.help()
// Основное для настройки эндгейма:
//
//   CE.all()        полная подготовка поздней партии: ур. 30, 150 клеток,
//                   1000 каждого ресурса, много крови и людей
//   CE.res(1000)    +1000 к каждому ресурсу
//   CE.blood(5000)  +5000 крови хаоса
//   CE.people(50)   +50 людей в пул
//   CE.level(30)    уровень портала
//   CE.claim(30)    захватить 30 клеток
//   CE.boss()       вызвать босса немедленно
//   CE.raid()       начать набег
//   CE.raidMult(20) изменить множитель спавна во время набега
//   CE.win()        немедленная победа
//   CE.state()      сводка текущего состояния
//   CE.CONFIG       все игровые константы (см. js/config.js)
//
// Ни одна из команд не пишет в localStorage и не влияет на другие вкладки.
// ===========================================================================

/** Захватить n клеток случайным доступным биомом. Возвращает, сколько вышло. */
function debugClaimCells(n) {
  const unlocked = BIOMES.map((_, i) => i).filter(isBiomeUnlocked);
  if (!unlocked.length) return 0;
  let done = 0;
  for (let attempt = 0; attempt < n * 12 && done < n; attempt++) {
    const candidates = Array.from(S.claimableSet);
    if (!candidates.length) break;
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    const biome = unlocked[Math.floor(Math.random() * unlocked.length)];
    if (claimCell(idx, biome)) done++;
  }
  return done;
}

/** Сводка состояния — то, что обычно нужно посмотреть при разборе баланса. */
function debugState() {
  return {
    клеток: `${S.claimed.size} / ${CONFIG.TOTAL_POINTS}`,
    портал: `${S.portalLevel} / ${CONFIG.PORTAL_MAX_LEVEL}`,
    люди: `${S.totalPeople} (в пуле ${getPoolPeople()})`,
    лимит_людей: S.cachedPortalCap,
    кровь: Math.round(S.chaosBlood),
    ресурсы: S.resources.map((v, i) => `${CONFIG.BIOMES[i].resource}: ${Math.round(v)}`),
    производство: S.cachedBiomeRates.map(v => +v.toFixed(1)),
    потребление: S.cachedConsumption.map(v => +v.toFixed(1)),
    набег: S.raid ? `идёт, ${Math.round(S.raid.elapsed)}с` : 'нет',
    босс: S.boss ? `${Math.round(S.boss.hp)} / ${S.boss.maxHp} HP, клетка ${S.boss.cellIdx}` : 'нет',
    монолит: findMonolith() ? `клетка ${findMonolith().cellIdx}` : 'не построен',
    победа: S.gameWon,
  };
}

window.CE = {
  /** Весь конфиг: CE.CONFIG.CLAIM_BASE_FACTOR и т.д. */
  CONFIG,

  /** +n к каждому ресурсу. */
  res(n = 1000) {
    for (let i = 0; i < S.resources.length; i++) S.resources[i] += n;
    updateResourceUI(); updateHUD();
    return `+${n} к каждому ресурсу`;
  },

  /** +n крови хаоса. */
  blood(n = 1000) {
    S.chaosBlood += n;
    updateHUD();
    return `кровь: ${Math.round(S.chaosBlood)}`;
  },

  /** +n людей в пул (в пределах лимита он не растёт — см. CE.cap). */
  people(n = 10) {
    S.totalPeople += n;
    updateHUD();
    return `людей: ${S.totalPeople}`;
  },

  /** Принудительно задать лимит людей. */
  cap(n = 100) {
    S.cachedPortalCap = n;
    updateHUD();
    return `лимит людей: ${n}`;
  },

  /** Уровень портала (открывает биомы и ускоряет спавн). */
  level(n = CONFIG.PORTAL_MAX_LEVEL) {
    S.portalLevel = Math.max(1, Math.min(CONFIG.PORTAL_MAX_LEVEL, n));
    renderLegend(); updateHUD();
    return `портал: ур. ${S.portalLevel}`;
  },

  /** Захватить n клеток. */
  claim(n = 20) {
    return `захвачено клеток: ${debugClaimCells(n)}`;
  },

  /**
   * Поставить монолит с рабочим — иначе набег не запустить, а кликать
   * через попап ради одной проверки долго.
   * @param {number} [cellIdx] клетка; по умолчанию — самая дальняя от портала.
   */
  monolith(cellIdx) {
    const MONOLITH_ID = 9;
    let target = cellIdx;
    if (target === undefined) {
      target = null;
      let bestDist = -1;
      for (const idx of S.claimed.keys()) {
        if (idx === S.portalCellIdx) continue;
        const d = Math.hypot(
          S.points[idx][0] - S.points[S.portalCellIdx][0],
          S.points[idx][1] - S.points[S.portalCellIdx][1]
        );
        if (d > bestDist) { bestDist = d; target = idx; }
      }
    }
    if (target === null || !S.claimed.has(target)) return 'клетка не захвачена';
    // Монолит стоит 2000 древесины — даём ресурс, если не хватает.
    if (S.resources[0] < 2000) S.resources[0] = 2000;
    if (!placeBuilding(target, MONOLITH_ID)) {
      return 'не удалось поставить (ресурсы или нет свободного слота)';
    }
    // Ставим рабочего сразу: набег можно начинать только с работающим монолитом,
    // а ждать автоподстановку не хочется.
    const slots = S.cellSlots.get(target);
    const slot = slots.findIndex(s => s && s.t === 'bld' && s.id === MONOLITH_ID);
    const reserved = getReservedArr(target);
    if (slot >= 0 && reserved) reserved[slot] = true;
    if (S.totalPeople <= getPortalCap()) S.totalPeople++;  // гарантируем рабочего в пуле
    autoReplaceReserved();
    return `монолит в клетке ${target}` +
      (hasMonolithActive() ? ' (рабочий на месте)' : ' (без рабочего!)');
  },

  /**
   * Полная подготовка поздней партии: максимальный портал, 150 клеток,
   * много людей и ресурсов, монолит на месте. После этого можно сразу
   * проверять босса и набег.
   */
  all(cells = 150) {
    const parts = [];
    parts.push(CE.level(CONFIG.PORTAL_MAX_LEVEL));
    parts.push(CE.cap(120));
    parts.push(CE.people(80));
    parts.push(CE.res(5000));
    // Крови нужно с запасом: цена захвата растёт квадратично и к 150-й клетке
    // стоит уже тысячи за клетку.
    parts.push(CE.blood(cells * 2000));
    parts.push(CE.claim(cells));
    parts.push(CE.monolith());
    parts.push(`клеток: ${S.claimed.size}, людей: ${S.totalPeople}, кровь: ${Math.round(S.chaosBlood)}`);
    return parts.join(' | ');
  },

  /** Вызвать босса вне набега. */
  boss() {
    spawnRaidBoss();
    return S.boss ? `босс в клетке ${S.boss.cellIdx}` : 'босс не появился';
  },

  /** Начать набег (требуется работающий монолит). */
  raid() {
    startRaid();
    return S.raid ? 'набег начался' : 'набег не начался (нужен работающий монолит)';
  },

  /** Множитель спавна врагов во время набега — для проверки сложности. */
  raidMult(n = CONFIG.RAID_SPAWN_MULT) {
    S.raidSpawnMult = Math.max(1, n);
    updateRaidHud();
    return `спавн во время набега: x${S.raidSpawnMult}`;
  },

  /** Немедленная победа. */
  win() {
    triggerVictory();
    return 'победа';
  },

  /** Сводка состояния. */
  state: debugState,

  /** Справка. */
  help() {
    console.log(Object.keys(window.CE).map(k => 'CE.' + k).join('  '));
    return 'см. список выше';
  },
};

// Старт игры — после регистрации CE, чтобы консоль была готова с первой секунды.
initGame();
requestAnimationFrame(renderLoop);