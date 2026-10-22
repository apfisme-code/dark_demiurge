// ===========================================================================
// ui.js — HUD, панель ресурсов, тосты, попапы клеток, легенда.
//
// Единственный модуль, который строит DOM. Попап перерисовывается целиком
// при смене «сигнатуры» (тип клетки + состав) и точечно обновляется
// каждые POPUP_REFRESH_INTERVAL секунд, пока открыт.
// ===========================================================================
import {
  BIOMES, ENEMIES, BUILDINGS, BUILDING_MAP, BUILDING_UPGRADE_NEXT,
  TOTAL_POINTS, BASE_RATE, HUMAN_BASE_HP, HUMAN_BASE_DMG,
  PORTAL_MAX_LEVEL, PORTAL_SPAWN_TIME_START, PORTAL_SPAWN_TIME_MIN,
  BIOME_UNLOCK_LEVEL, RAID_DURATION,
} from './config.js';
import {
  S, popup, resourceList, toastEl, raidHudEl,
  getSpawnTime, getPortalCap, countSlots, getPoolPeople, getPeopleOn,
  getWorkingOn, getWorkingOnBuildings, getCellHpSum, getEnemiesOn,
  getReservedArr, getCellCap, getClaimCost, isBiomeUnlocked,
  getBiomeUnlockLevel, getPortalUpgradeCost, canUpgradePortal, getImpPeriod,
  recomputeBuffs, getCellMaxHp, getCellProdMult, recomputeRates,
  canAffordBuilding,
} from './state.js';
import { previewSynergy } from './world.js';
import {
  claimCell, assignTo, placeBuilding, destroyBuilding, upgradeBuilding,
  upgradePortal, hasMonolithActive, startRaid,
} from './logic.js';export function updateHUD() {
  const stats = countSlots();
  document.getElementById('chaosHud').textContent = formatNumber(S.chaosBlood);
  document.getElementById('peopleHud').textContent = `${stats.humans} / ${getPortalCap()}`;
  document.getElementById('poolHud').textContent = getPoolPeople();
  document.getElementById('impHud').textContent = stats.enemies;
  document.getElementById('cellsHud').textContent = `${S.claimed.size} / ${TOTAL_POINTS}`;
  document.getElementById('portalHud').textContent = `Ур. ${S.portalLevel}`;
  let resRate = 0;
  for (let i = 0; i < BIOMES.length; i++) {
    resRate += S.cachedBiomeRates[i] - S.cachedConsumption[i];
  }
  document.getElementById('gainHud').textContent = `${resRate >= 0 ? '+' : ''}${resRate.toFixed(1)}/с`;
}

// ============ RESOURCE PANEL ============
export function renderResourceRows() {
  resourceList.innerHTML = '';
  const chaosRow = document.createElement('div');
  chaosRow.className = 'resource-row chaos-row';
  chaosRow.innerHTML = `
    <div class="resource-dot" style="background:#a040d0;border:1px solid #d090e8"></div>
    <div class="resource-name chaos-name">Кровь хаоса</div>
    <div class="resource-amount chaos-amount" id="chaosAmount">0</div>
    <div class="resource-rate chaos-rate hint" id="chaosRate">за убийства</div>
  `;
  resourceList.appendChild(chaosRow);

  BIOMES.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'resource-row';
    row.dataset.biome = i;
    const dot = document.createElement('div');
    dot.className = 'resource-dot';
    dot.style.background = b.resColor;
    dot.style.border = `1px solid ${b.border}`;
    const name = document.createElement('div');
    name.className = 'resource-name';
    name.textContent = b.resource;
    const amount = document.createElement('div');
    amount.className = 'resource-amount';
    amount.textContent = '0';
    const rate = document.createElement('div');
    rate.className = 'resource-rate';
    rate.textContent = '';
    row.append(dot, name, amount, rate);
    resourceList.appendChild(row);
  });
}

function formatNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return Math.floor(n).toString();
}

export function updateResourceUI() {
  const chaosAmountEl = document.getElementById('chaosAmount');
  if (chaosAmountEl) chaosAmountEl.textContent = formatNumber(S.chaosBlood);
  const rows = resourceList.children;
  for (let i = 0; i < BIOMES.length; i++) {
    const row = rows[i + 1];
    if (!row) continue;
    if (S.biomeCounts[i] > 0) row.classList.add('active');
    const amountEl = row.querySelector('.resource-amount');
    const rateEl = row.querySelector('.resource-rate');
    amountEl.textContent = formatNumber(S.resources[i]);
    const net = S.cachedBiomeRates[i] - S.cachedConsumption[i];
    if (net > 0.01) {
      rateEl.textContent = `+${net.toFixed(1)}/с`;
      rateEl.style.color = '#6ba86b';
    } else if (net < -0.01) {
      rateEl.textContent = `${net.toFixed(1)}/с`;
      rateEl.style.color = '#d06060';
    } else {
      rateEl.textContent = '';
      rateEl.style.color = '';
    }
  }
}

// ============ TOAST ============
let toastTimer;
export function showToast(text, duration = 1200) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

export function hideMainToast() {
  clearTimeout(toastTimer);
  toastEl.classList.remove('show');
}

// ============ RAID HUD ============
export function updateRaidHud() {
  if (!S.raid && !S.boss) {
    raidHudEl.classList.add('hidden');
    return;
  }
  raidHudEl.classList.remove('hidden');
  let html = '';
  if (S.raid) {
    const rem = Math.max(0, RAID_DURATION - S.raid.elapsed);
    const min = Math.floor(rem / 60);
    const sec = Math.floor(rem % 60).toString().padStart(2, '0');
    html += `🔥 НАБЕГ · ${min}:${sec} · спавн ×${S.raidSpawnMult}`;
  } else {
    html += `⚠ Босс на свободе`;
  }
  if (S.boss) {
    html += `<span class="raid-boss">💀 БОСС: ${Math.round(S.boss.hp)} / ${S.boss.maxHp} HP</span>`;
  }
  raidHudEl.innerHTML = html;
}
// ============ POPUP ============
export function renderPopup() {
  if (S.pendingIdx === null) {
    popup.classList.add('hidden');
    S.popupType = null;
    S.popupIdx = -1;
    return;
  }
  const idx = S.pendingIdx;

  if (S.pendingBuildMode && S.claimed.has(idx)) {
    renderBuildPopup(idx);
    popup.classList.remove('hidden');
    S.lastRenderedPool = getPoolPeople();
    positionPopup(S.lastMouseX, S.lastMouseY);
    return;
  }

  const type = !S.claimed.has(idx) ? 'claim'
             : idx === S.portalCellIdx ? 'portal'
             : 'cell';

  const sig = computePopupSignature(idx, type);
  if (S.popupType === type && S.popupIdx === idx && S.popupSignature === sig) {
    updatePopupLive();
    S.lastRenderedPool = getPoolPeople();
    popup.classList.remove('hidden');
    return;
  }
  S.popupType = type;
  S.popupIdx = idx;
  S.popupSignature = sig;

  if (type === 'claim') renderClaimPopup(idx);
  else if (type === 'portal') renderPortalPopup(idx);
  else renderCellPopup(idx);

  S.lastRenderedPool = getPoolPeople();
  popup.classList.remove('hidden');
  positionPopup(S.lastMouseX, S.lastMouseY);
}

function computePopupSignature(idx, type) {
  if (type === 'claim') return `claim:${idx}:${S.claimed.size}`;
  const count = getPeopleOn(idx);
  const enemies = getEnemiesOn(idx);
  const pool = getPoolPeople();
  const inBattle = S.cellHasBattle.has(idx) ? 1 : 0;
  const hp = getCellHpSum(idx);
  let bldCount = 0, bldWorkers = 0;
  const slots = S.cellSlots.get(idx);
  if (slots) {
    for (const s of slots) {
      if (s && s.t === 'bld') {
        bldCount++;
        if (s.worker) bldWorkers++;
      }
    }
  }
  return `${type}:${idx}:${count}:${enemies}:${pool}:${inBattle}:${hp.cur}:${hp.max}:${S.portalLevel}:${bldCount}:${bldWorkers}:${getPortalCap()}:${S.raid?1:0}:${S.boss?1:0}`;
}

export function updatePopupLive() {
  if (S.pendingIdx === null || popup.classList.contains('hidden')) return;
  const idx = S.pendingIdx;
  if (!S.claimed.has(idx)) return;

  const pool = getPoolPeople();
  if (pool !== S.lastRenderedPool) {
    const slots = S.cellSlots.get(idx);
    let hasBld = false;
    if (slots) {
      for (const s of slots) if (s && s.t === 'bld') { hasBld = true; break; }
    }
    if (hasBld) {
      S.popupSignature = '';
      renderPopup();
      return;
    }
  }

  const count = getPeopleOn(idx);
  const working = getWorkingOn(idx);
  const enemies = getEnemiesOn(idx);
  const inBattle = S.cellHasBattle.has(idx);
  const hp = getCellHpSum(idx);

  const elThreat = document.getElementById('pv-threat');
  if (elThreat) {
    const period = getImpPeriod(idx);
    if (period < Infinity) {
      const elapsed = S.cellImpTimers.get(idx) || 0;
      const remaining = Math.max(0, period - elapsed);
      elThreat.textContent = remaining.toFixed(1) + ' с';
      elThreat.className = 'value' + (remaining < period * 0.3 ? ' danger' : '');
    }
  }

  const elWorking = document.getElementById('pv-working');
  if (elWorking) elWorking.textContent = `${working} / ${count}`;

  const elPool = document.getElementById('pv-pool');
  if (elPool) elPool.textContent = pool;

  const elCount = document.getElementById('pv-count');
  if (elCount) {
    let txt = `${count} <small>/ ${getCellCap(idx)}</small>`;
    if (enemies > 0) txt += ` <span style="color:#d06060;font-size:12px">+${enemies}👿</span>`;
    elCount.innerHTML = txt;
  }

  const elEnemyRow = document.getElementById('pv-imp-row');
  if (elEnemyRow) {
    elEnemyRow.style.display = enemies > 0 ? '' : 'none';
    const ic = document.getElementById('pv-imp-count');
    if (ic) ic.textContent = enemies;
  }

  const elHp = document.getElementById('pv-hp');
  if (elHp) {
    if (hp.max > 0) {
      elHp.textContent = `${Math.round(hp.cur)} / ${hp.max}`;
      elHp.className = 'value hp' + (hp.cur < hp.max * 0.3 ? ' danger' : '');
    } else {
      elHp.textContent = '—';
      elHp.className = 'value';
    }
  }

  const elBattle = document.getElementById('pv-battle-row');
  if (elBattle) elBattle.style.display = inBattle ? '' : 'none';

  const elSpawn = document.getElementById('pv-spawn');
  if (elSpawn) {
    const st = getSpawnTime();
    const sl = Math.max(0, st - S.spawnTimer);
    elSpawn.textContent = S.totalPeople >= getPortalCap() ? '— (лимит)' : sl.toFixed(1) + ' с';
  }

  const plusBtn = document.getElementById('pv-plus');
  if (plusBtn) {
    const slots = S.cellSlots.get(idx);
    let canAdd = false;
    if (slots && pool > 0) {
      for (const s of slots) {
        if (s === null || (s && s.t === 'i')) { canAdd = true; break; }
      }
    }
    plusBtn.disabled = !canAdd;
  }

  const minusBtn = document.getElementById('pv-minus');
  if (minusBtn) {
    const slots = S.cellSlots.get(idx);
    let canRemove = false;
    if (slots) {
      for (const s of slots) if (s && s.t === 'h') { canRemove = true; break; }
    }
    minusBtn.disabled = !canRemove;
  }

  const raidBtn = document.getElementById('pv-raid');
  if (raidBtn) {
    const active = !!S.raid;
    const bossAlive = !!S.boss;
    const hasMono = hasMonolithActive();
    if (active) {
      raidBtn.textContent = `🔥 Набег идёт · ${Math.max(0, RAID_DURATION - S.raid.elapsed).toFixed(0)} с`;
      raidBtn.disabled = true;
    } else if (bossAlive) {
      raidBtn.textContent = `💀 Босс на свободе!`;
      raidBtn.disabled = true;
    } else if (hasMono) {
      raidBtn.textContent = `🔥 Начать набег демонов`;
      raidBtn.disabled = false;
    } else {
      raidBtn.textContent = `🔥 Нужен работающий монолит`;
      raidBtn.disabled = true;
    }
  }
}

function renderClaimPopup(idx) {
  const cost = getClaimCost(idx);
  const cap = S.cellCaps[idx] || 1;
  const canAfford = S.chaosBlood >= cost;

  popup.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'popup-header';
  header.innerHTML = `
    <div class="popup-swatch" style="background:linear-gradient(135deg,#3a3a5a,#1a1a2a);border:1px solid #5a5a8a"></div>
    <div class="popup-header-info">
      <div class="popup-title">Открыть секцию</div>
      <div class="popup-subtitle">Цена: <b style="color:#d090e8">${cost} крови хаоса</b></div>
    </div>
  `;
  popup.appendChild(header);

  const infoRow = document.createElement('div');
  infoRow.innerHTML = `
    <div class="popup-row">
      <span class="label">Слотов для рабочих</span>
      <span class="value">${cap}</span>
    </div>
    <div class="popup-row">
      <span class="label">Ваш запас крови</span>
      <span class="value ${canAfford ? 'ok' : 'miss'}">${Math.floor(S.chaosBlood)} / ${cost}</span>
    </div>
  `;
  popup.appendChild(infoRow);

  const title = document.createElement('div');
  title.className = 'popup-title-small';
  title.textContent = 'Выбрать биом';
  popup.appendChild(title);

  BIOMES.forEach((biome, biomeIdx) => {
    const unlocked = isBiomeUnlocked(biomeIdx);
    const unlockLevel = getBiomeUnlockLevel(biomeIdx);
    const synMult = previewSynergy(idx, biomeIdx);

    const btn = document.createElement('button');
    btn.className = 'biome-btn' + (unlocked ? '' : ' locked');
    btn.disabled = !canAfford || !unlocked;

    const swatch = document.createElement('span');
    swatch.className = 'biome-swatch';
    swatch.style.background = biome.color;
    swatch.style.border = `1px solid ${biome.border}`;

    const info = document.createElement('span');
    info.className = 'biome-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'biome-name';
    nameEl.textContent = biome.ru;
    const resEl = document.createElement('span');
    resEl.className = 'biome-res';
    resEl.textContent = biome.resource + ' · ' + ENEMIES[biomeIdx].name;
    info.append(nameEl, resEl);
    btn.append(swatch, info);

    if (unlocked) {
      const synEl = document.createElement('span');
      synEl.style.fontSize = '11px';
      synEl.style.fontWeight = '700';
      synEl.style.fontVariantNumeric = 'tabular-nums';
      synEl.style.minWidth = '38px';
      synEl.style.textAlign = 'right';
      if (synMult > 1.05) synEl.style.color = '#6bc07a';
      else if (synMult < 0.95) synEl.style.color = '#d06060';
      else synEl.style.color = '#888';
      synEl.textContent = `×${synMult.toFixed(1)}`;
      btn.appendChild(synEl);
      const hk = document.createElement('span');
      hk.className = 'biome-hotkey';
      hk.textContent = biomeIdx + 1;
      btn.appendChild(hk);
    } else {
      const lock = document.createElement('span');
      lock.className = 'biome-lock';
      lock.textContent = `Ур. ${unlockLevel}`;
      btn.appendChild(lock);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (claimCell(idx, biomeIdx)) hidePopup();
    });
    popup.appendChild(btn);
  });
}

function synergyRowHTML(syn) {
  let cls = '', suffix = '';
  if (syn > 1.05) { cls = 'syn-buff'; suffix = ' (бонус)'; }
  else if (syn < 0.95) { cls = 'syn-debuff'; suffix = ' (штраф)'; }
  return `
    <div class="popup-row">
      <span class="label">Синергия</span>
      <span class="value ${cls}">×${syn.toFixed(2)}${suffix}</span>
    </div>
  `;
}

function buildAssignControls(idx) {
  const slots = S.cellSlots.get(idx);
  const cap = slots ? slots.length : 0;
  const count = getPeopleOn(idx);
  const enemies = getEnemiesOn(idx);
  const pool = getPoolPeople();

  let canAdd = false;
  if (slots && pool > 0) {
    for (const s of slots) {
      if (s === null || (s && s.t === 'i')) { canAdd = true; break; }
    }
  }
  let canRemove = false;
  if (slots) {
    for (const s of slots) if (s && s.t === 'h') { canRemove = true; break; }
  }

  const controls = document.createElement('div');
  controls.className = 'assign-controls';

  const minus = document.createElement('button');
  minus.className = 'assign-btn';
  minus.id = 'pv-minus';
  minus.textContent = '−';
  minus.disabled = !canRemove;
  minus.title = 'Снять рабочего с добычи';
  minus.addEventListener('click', (e) => {
    e.stopPropagation();
    assignTo(idx, -1);
    S.popupSignature = '';
    renderPopup();
  });

  const countEl = document.createElement('div');
  countEl.className = 'assign-count';
  countEl.id = 'pv-count';
  let txt = `${count} <small>/ ${cap}</small>`;
  if (enemies > 0) txt += ` <span style="color:#d06060;font-size:12px">+${enemies}👿</span>`;
  countEl.innerHTML = txt;

  const plus = document.createElement('button');
  plus.className = 'assign-btn';
  plus.id = 'pv-plus';
  plus.textContent = '+';
  plus.disabled = !canAdd;
  plus.title = enemies > 0
    ? `Отправить в бой ${Math.min(enemies, pool)} из ${enemies} врагов`
    : 'Назначить на добычу';
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    assignTo(idx, +1);
    S.popupSignature = '';
    renderPopup();
  });

  controls.append(minus, countEl, plus);
  return controls;
}

function buildThreatRows(idx) {
  const vf = S.cellVoidFraction[idx] || 0;
  const period = getImpPeriod(idx);
  if (period === Infinity) return '';

  const elapsed = S.cellImpTimers.get(idx) || 0;
  const remaining = Math.max(0, period - elapsed);
  const cls = remaining < period * 0.3 ? 'danger' : '';

  return `
    <div class="popup-row">
      <span class="label">Граница с пустотой</span>
      <span class="value">${(vf*100).toFixed(0)}%</span>
    </div>
    <div class="popup-row">
      <span class="label">Нападение через</span>
      <span class="value ${cls}" id="pv-threat">${remaining.toFixed(1)} с</span>
    </div>
  `;
}

function buildBuffRows(idx) {
  const buffs = S.cellBuffs.get(idx) || { maxHp: HUMAN_BASE_HP, dmg: HUMAN_BASE_DMG, prodMult: 1 };
  const rows = [];
  if (buffs.maxHp > HUMAN_BASE_HP) {
    rows.push(`<div class="popup-row"><span class="label">Бонус HP людей</span><span class="value buff">+${buffs.maxHp - HUMAN_BASE_HP} (${buffs.maxHp} HP)</span></div>`);
  }
  if (buffs.dmg > HUMAN_BASE_DMG) {
    rows.push(`<div class="popup-row"><span class="label">Бонус урона людей</span><span class="value buff">+${buffs.dmg - HUMAN_BASE_DMG} (${buffs.dmg} dmg)</span></div>`);
  }
  if (buffs.prodMult > 1) {
    rows.push(`<div class="popup-row"><span class="label">Бонус производства</span><span class="value buff">+${Math.round((buffs.prodMult - 1) * 100)}%</span></div>`);
  }
  return rows.join('');
}

function renderBuildingRow(idx, slotIdx) {
  const slots = S.cellSlots.get(idx);
  const s = slots[slotIdx];
  const b = BUILDING_MAP[s.id];
  if (!b) return null;

  const isHouse = b.effect === 'house';

  const r = document.createElement('div');
  r.className = 'popup-row';
  r.style.flexWrap = 'wrap';
  r.style.gap = '6px';

  const label = document.createElement('span');
  label.className = 'label';
  let text = b.name;
  if (isHouse) text += ` (+${b.power} кап)`;
  else if (s.battle) text += ' ⚔';
  else if (!s.worker) text += ' · нет рабочего';
  label.textContent = text;
  r.appendChild(label);

  const btns = document.createElement('div');
  btns.style.display = 'flex';
  btns.style.gap = '4px';

  if (!s.battle && !isHouse) {
    if (s.worker) {
      const rb = document.createElement('button');
      rb.className = 'bld-row-btn';
      rb.textContent = '−';
      rb.title = 'Снять рабочего с постройки';
      rb.addEventListener('click', (e) => {
        e.stopPropagation();
        s.worker = null;
        const reserved = getReservedArr(idx);
        if (reserved) reserved[slotIdx] = false;
        recomputeBuffs();
        recomputeRates();
        updateHUD();
        updateResourceUI();
        S.popupSignature = '';
        renderPopup();
      });
      btns.appendChild(rb);
    } else {
      const ab = document.createElement('button');
      ab.className = 'bld-row-btn';
      ab.textContent = '+';
      ab.title = 'Назначить рабочего в постройку';
      ab.disabled = getPoolPeople() <= 0;
      ab.addEventListener('click', (e) => {
        e.stopPropagation();
        if (getPoolPeople() <= 0) return;
        const maxHp = getCellMaxHp(idx);
        s.worker = { hp: maxHp, maxHp: maxHp };
        const reserved = getReservedArr(idx);
        if (reserved) reserved[slotIdx] = true;
        recomputeBuffs();
        recomputeRates();
        updateHUD();
        updateResourceUI();
        S.popupSignature = '';
        renderPopup();
      });
      btns.appendChild(ab);
    }
  }

  if (!s.battle) {
    const nextId = BUILDING_UPGRADE_NEXT[s.id];
    if (nextId !== undefined) {
      const nextB = BUILDING_MAP[nextId];
      const ub = document.createElement('button');
      ub.className = 'bld-row-btn up';
      ub.textContent = '⬆';
      ub.title = `Улучшить до «${nextB.name}»`;
      ub.disabled = !canAffordBuilding(nextB);
      ub.addEventListener('click', (e) => {
        e.stopPropagation();
        upgradeBuilding(idx, slotIdx);
        S.popupSignature = '';
        renderPopup();
      });
      btns.appendChild(ub);
    }
  }

  const db = document.createElement('button');
  db.className = 'bld-row-btn del';
  db.textContent = '✕';
  db.title = 'Снести здание';
  db.disabled = !!s.battle;
  db.addEventListener('click', (e) => {
    e.stopPropagation();
    destroyBuilding(idx, slotIdx);
    S.popupSignature = '';
    renderPopup();
  });
  btns.appendChild(db);

  r.appendChild(btns);
  return r;
}

function buildBuildingsList(idx) {
  const slots = S.cellSlots.get(idx);
  if (!slots) return null;
  const buildings = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] && slots[i].t === 'bld') buildings.push(i);
  }
  if (buildings.length === 0) return null;

  const wrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'popup-title-small';
  title.textContent = 'Постройки';
  wrap.appendChild(title);
  for (const slotIdx of buildings) {
    const row = renderBuildingRow(idx, slotIdx);
    if (row) wrap.appendChild(row);
  }
  return wrap;
}

function renderCellPopup(idx) {
  const biomeIdx = S.claimed.get(idx);
  const biome = BIOMES[biomeIdx];
  const count = getPeopleOn(idx);
  const working = getWorkingOn(idx);
  const onBuildings = getWorkingOnBuildings(idx);
  const cap = getCellCap(idx);
  const enemies = getEnemiesOn(idx);
  const pool = getPoolPeople();
  const inBattle = S.cellHasBattle.has(idx);
  const hp = getCellHpSum(idx);

  const syn = S.cellSynergy[idx] || 1;
  const prodMult = getCellProdMult(idx);
  const biomeOut = working * BASE_RATE * syn * prodMult;

  const reserved = S.cellSlotReserved.get(idx);
  let reservedCount = 0;
  if (reserved) for (const r of reserved) if (r) reservedCount++;

  popup.innerHTML = `
    <div class="popup-header">
      <div class="popup-swatch" style="background:${biome.color};border:1px solid ${biome.border}"></div>
      <div class="popup-header-info">
        <div class="popup-title">${biome.ru}</div>
        <div class="popup-subtitle">Ресурс: ${biome.resource} · Враг: ${ENEMIES[biomeIdx].name}</div>
      </div>
    </div>
  `;

  const rows = document.createElement('div');
  rows.innerHTML = synergyRowHTML(syn) + buildThreatRows(idx) + buildBuffRows(idx) + `
    <div class="popup-row" id="pv-battle-row" style="${inBattle ? '' : 'display:none'}">
      <span class="label" style="color:#ffa050">⚔ Идёт сражение</span>
      <span class="value battle">частично остановлено</span>
    </div>
    <div class="popup-row" id="pv-imp-row" style="${enemies > 0 ? '' : 'display:none'}">
      <span class="label">Врагов на клетке</span>
      <span class="value imp" id="pv-imp-count">${enemies}</span>
    </div>
    <div class="popup-row">
      <span class="label">HP людей</span>
      <span class="value hp" id="pv-hp">${hp.max > 0 ? Math.round(hp.cur) + ' / ' + hp.max : '—'}</span>
    </div>
    <div class="popup-row">
      <span class="label">Закреплено слотов</span>
      <span class="value">${reservedCount} / ${cap}</span>
    </div>
    <div class="popup-row">
      <span class="label">Рабочих занято</span>
      <span class="value" id="pv-working">${working} / ${count}</span>
    </div>
    ${onBuildings > 0 ? `<div class="popup-row"><span class="label" style="padding-left:14px;font-size:11px">в т.ч. на постройках</span><span class="value" style="font-size:11px">${onBuildings}</span></div>` : ''}
    <div class="popup-row">
      <span class="label">${biome.resource}</span>
      <span class="value res">+${biomeOut.toFixed(1)}/с</span>
    </div>
    <div class="popup-row">
      <span class="label">Свободных рабочих</span>
      <span class="value pool" id="pv-pool">${pool}</span>
    </div>
  `;
  popup.appendChild(rows);

  const bldList = buildBuildingsList(idx);
  if (bldList) popup.appendChild(bldList);

  popup.appendChild(buildAssignControls(idx));

  const buildBtn = document.createElement('button');
  buildBtn.className = 'action-btn build-btn';
  buildBtn.textContent = '🏗 Построить';
  buildBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    S.pendingBuildMode = true;
    S.popupSignature = '';
    renderPopup();
  });
  popup.appendChild(buildBtn);

  if (hasMonolithActive()) {
    const raidBtn = document.createElement('button');
    raidBtn.className = 'action-btn danger-btn';
    raidBtn.id = 'pv-raid';
    raidBtn.disabled = !!S.raid || !!S.boss;
    if (S.raid) raidBtn.textContent = `🔥 Набег идёт · ${Math.max(0, RAID_DURATION - S.raid.elapsed).toFixed(0)} с`;
    else if (S.boss) raidBtn.textContent = `💀 Босс на свободе!`;
    else raidBtn.textContent = `🔥 Начать набег демонов`;
    raidBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRaid();
    });
    popup.appendChild(raidBtn);
  }
}

function renderPortalPopup(idx) {
  const biomeIdx = S.claimed.get(idx);
  const biome = BIOMES[biomeIdx];
  const count = getPeopleOn(idx);
  const working = getWorkingOn(idx);
  const enemies = getEnemiesOn(idx);
  const pool = getPoolPeople();
  const inBattle = S.cellHasBattle.has(idx);
  const hp = getCellHpSum(idx);
  const upgradeCost = getPortalUpgradeCost();
  const canUpgrade = canUpgradePortal();
  const maxed = S.portalLevel >= PORTAL_MAX_LEVEL;
  const spawnTime = getSpawnTime();
  const secondsLeft = Math.max(0, spawnTime - S.spawnTimer);
  const nextSpawnTime = Math.max(PORTAL_SPAWN_TIME_MIN,
      PORTAL_SPAWN_TIME_START - S.portalLevel *
      (PORTAL_SPAWN_TIME_START - PORTAL_SPAWN_TIME_MIN) / (PORTAL_MAX_LEVEL - 1));

  const syn = S.cellSynergy[idx] || 1;
  const prodMult = getCellProdMult(idx);
  const biomeOut = working * BASE_RATE * syn * prodMult;

  popup.innerHTML = `
    <div class="popup-header">
      <div class="popup-swatch" style="background:radial-gradient(circle, #ffd070, #a07020);border:1px solid #ffd070"></div>
      <div class="popup-header-info">
        <div class="popup-title">Портал призыва · Ур. ${S.portalLevel}${maxed ? ' (макс)' : ''}</div>
        <div class="popup-subtitle">Биом: ${biome.ru} (${biome.resource})</div>
      </div>
    </div>
  `;

  const stats = document.createElement('div');
  stats.innerHTML = synergyRowHTML(syn) + buildThreatRows(idx) + buildBuffRows(idx) + `
    <div class="popup-row" id="pv-battle-row" style="${inBattle ? '' : 'display:none'}">
      <span class="label" style="color:#ffa050">⚔ Идёт сражение</span>
      <span class="value battle">частично остановлено</span>
    </div>
    <div class="popup-row" id="pv-imp-row" style="${enemies > 0 ? '' : 'display:none'}">
      <span class="label">Врагов на портале</span>
      <span class="value imp" id="pv-imp-count">${enemies}</span>
    </div>
    <div class="popup-row">
      <span class="label">HP людей</span>
      <span class="value hp" id="pv-hp">${hp.max > 0 ? Math.round(hp.cur) + ' / ' + hp.max : '—'}</span>
    </div>
    <div class="popup-row">
      <span class="label">Вместимость портала</span>
      <span class="value">${getPortalCap()} человек</span>
    </div>
    <div class="popup-row">
      <span class="label">${biome.resource}</span>
      <span class="value res">+${biomeOut.toFixed(1)}/с</span>
    </div>
    <div class="popup-row">
      <span class="label">Свободных рабочих</span>
      <span class="value pool" id="pv-pool">${pool}</span>
    </div>
    <div class="popup-row">
      <span class="label">Следующий рабочий</span>
      <span class="value" id="pv-spawn">${S.totalPeople >= getPortalCap() ? '— (лимит)' : secondsLeft.toFixed(1) + ' с'}</span>
    </div>
  `;
  popup.appendChild(stats);

  const bldList = buildBuildingsList(idx);
  if (bldList) popup.appendChild(bldList);

  popup.appendChild(buildAssignControls(idx));

  const buildBtn = document.createElement('button');
  buildBtn.className = 'action-btn build-btn';
  buildBtn.textContent = '🏗 Построить';
  buildBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    S.pendingBuildMode = true;
    S.popupSignature = '';
    renderPopup();
  });
  popup.appendChild(buildBtn);

  if (hasMonolithActive()) {
    const raidBtn = document.createElement('button');
    raidBtn.className = 'action-btn danger-btn';
    raidBtn.id = 'pv-raid';
    raidBtn.disabled = !!S.raid || !!S.boss;
    if (S.raid) raidBtn.textContent = `🔥 Набег идёт · ${Math.max(0, RAID_DURATION - S.raid.elapsed).toFixed(0)} с`;
    else if (S.boss) raidBtn.textContent = `💀 Босс на свободе!`;
    else raidBtn.textContent = `🔥 Начать набег демонов`;
    raidBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRaid();
    });
    popup.appendChild(raidBtn);
  }

  const costTitle = document.createElement('div');
  costTitle.className = 'popup-title-small';
  costTitle.textContent = `Улучшение портала · Ур. ${S.portalLevel} → ${S.portalLevel + 1}`;
  popup.appendChild(costTitle);

  const costRow = document.createElement('div');
  if (maxed) {
    costRow.innerHTML = `<div class="popup-row"><span class="label" style="color:#8ac88a">Портал максимального уровня</span></div>`;
  } else {
    costRow.innerHTML = `
      <div class="popup-row">
        <span class="label">
          <span class="cost-dot" style="background:#a040d0;border:1px solid #d090e8"></span>
          Кровь хаоса
        </span>
        <span class="value ${canUpgrade ? 'ok' : 'miss'}">${formatNumber(S.chaosBlood)} / ${formatNumber(upgradeCost)}</span>
      </div>
      <div class="popup-row">
        <span class="label" style="font-size:11px;color:#666">Скорость спавна</span>
        <span class="value" style="font-size:11px;color:#8ac88a">${spawnTime.toFixed(1)} с → ${nextSpawnTime.toFixed(1)} с</span>
      </div>
    `;
  }
  popup.appendChild(costRow);

  const newlyUnlocked = [];
  for (let i = 0; i < BIOMES.length; i++) {
    if (BIOME_UNLOCK_LEVEL[i] === S.portalLevel + 1) newlyUnlocked.push(BIOMES[i].ru);
  }
  if (newlyUnlocked.length > 0) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:#a080c0;margin-top:8px;line-height:1.4;';
    hint.innerHTML = `🔓 Откроется: ${newlyUnlocked.join(', ')}`;
    popup.appendChild(hint);
  }

  if (!maxed) {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = canUpgrade ? `Улучшить портал (−${formatNumber(upgradeCost)} крови)` : 'Недостаточно крови';
    btn.disabled = !canUpgrade;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      upgradePortal();
    });
    popup.appendChild(btn);
  }
}

function renderBuildPopup(idx) {
  popup.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'popup-header';
  header.innerHTML = `
    <div class="popup-swatch" style="background:linear-gradient(135deg,#2a4a3a,#1a2a1a);border:1px solid #4a8a5a"></div>
    <div class="popup-header-info">
      <div class="popup-title">Постройки</div>
      <div class="popup-subtitle">Здание занимает слот. Если места нет — займёт слот человека.</div>
    </div>
  `;
  popup.appendChild(header);

  const slots = S.cellSlots.get(idx);
  let emptyCount = 0, humanCount = 0;
  if (slots) {
    for (const s of slots) {
      if (s === null) emptyCount++;
      else if (s.t === 'h') humanCount++;
    }
  }

  const info = document.createElement('div');
  info.innerHTML = `
    <div class="popup-row">
      <span class="label">Свободных слотов</span>
      <span class="value">${emptyCount}</span>
    </div>
    ${emptyCount === 0 ? `<div class="popup-row"><span class="label">Людей на добыче (будут заменены)</span><span class="value">${humanCount}</span></div>` : ''}
  `;
  popup.appendChild(info);

  if (emptyCount === 0 && humanCount === 0) {
    const warn = document.createElement('div');
    warn.style.cssText = 'color:#d06060;font-size:12px;margin:10px 0;';
    warn.textContent = 'Нет места для постройки.';
    popup.appendChild(warn);
  }

  const title = document.createElement('div');
  title.className = 'popup-title-small';
  title.textContent = 'Доступные постройки';
  popup.appendChild(title);

  let hasMonolith = false;
  for (const slots2 of S.cellSlots.values()) {
    for (const s of slots2) {
      if (s && s.t === 'bld' && BUILDING_MAP[s.id] && BUILDING_MAP[s.id].effect === 'monolith') {
        hasMonolith = true; break;
      }
    }
    if (hasMonolith) break;
  }

  BUILDINGS.forEach((b) => {
    if (b.upgradeOnly) return;
    if (b.effect === 'monolith' && hasMonolith) return;

    const affordable = canAffordBuilding(b);
    const hasPlace = emptyCount > 0 || humanCount > 0;
    const btn = document.createElement('button');
    btn.className = 'biome-btn';
    btn.disabled = !affordable || !hasPlace;

    const swatch = document.createElement('span');
    swatch.className = 'biome-swatch';
    swatch.style.background = b.color;

    const infoSpan = document.createElement('span');
    infoSpan.className = 'biome-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'biome-name';
    nameEl.textContent = b.name;
    const descEl = document.createElement('span');
    descEl.className = 'biome-res';
    descEl.textContent = describeBuilding(b);
    infoSpan.append(nameEl, descEl);

    btn.append(swatch, infoSpan);

    const costSpan = document.createElement('span');
    costSpan.className = 'build-cost';
    for (const k in b.cost) {
      const bi = parseInt(k);
      const need = b.cost[k];
      const has = S.resources[bi];
      const ok = has >= need;
      const item = document.createElement('span');
      item.className = 'build-cost-item ' + (ok ? 'ok' : 'miss');
      const dot = document.createElement('span');
      dot.className = 'cost-dot';
      dot.style.background = BIOMES[bi].resColor;
      dot.style.border = `1px solid ${BIOMES[bi].border}`;
      item.append(dot);
      item.append(document.createTextNode(need));
      costSpan.appendChild(item);
    }
    btn.appendChild(costSpan);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (placeBuilding(idx, b.id)) {
        S.pendingBuildMode = false;
        S.popupSignature = '';
        renderPopup();
      }
    });
    popup.appendChild(btn);
  });

  const backBtn = document.createElement('button');
  backBtn.className = 'action-btn';
  backBtn.textContent = '← Назад';
  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    S.pendingBuildMode = false;
    S.popupSignature = '';
    renderPopup();
  });
  popup.appendChild(backBtn);
}

function describeBuilding(b) {
  const consumeStr = b.consumes ? ` · −${Object.values(b.consumes).reduce((a, v) => a + v, 0)}/с` : '';
  switch (b.effect) {
    case 'tower': return `${b.power} урона/с${consumeStr}`;
    case 'warehouse': return `+${Math.round(b.power*100)}% производства${consumeStr}`;
    case 'armor': return `+${b.power} HP людям${consumeStr}`;
    case 'weapon': return `+${b.power} dmg людям${consumeStr}`;
    case 'healer': return `лечит 1 HP/с${consumeStr}`;
    case 'monolith': return `позволяет начать набег демонов`;
    case 'house': return `+${b.power} к капу людей${consumeStr}`;
    default: return '';
  }
}

export function positionPopup(clientX, clientY) {
  popup.style.left = '0px';
  popup.style.top = '0px';
  const rect = popup.getBoundingClientRect();
  let px = clientX + 14;
  let py = clientY + 14;
  if (px + rect.width > window.innerWidth - 8) px = clientX - rect.width - 14;
  if (py + rect.height > window.innerHeight - 8) py = clientY - rect.height - 14;
  popup.style.left = Math.max(8, px) + 'px';
  popup.style.top = Math.max(8, py) + 'px';
}

export function hidePopup() {
  popup.classList.add('hidden');
  S.pendingIdx = null;
  S.pendingBuildMode = false;
  S.popupType = null;
  S.popupIdx = -1;
  S.popupSignature = '';
  S.lastRenderedPool = -1;
}

// ============ LEGEND ============
export function renderLegend() {
  const legend = document.getElementById('legend');
  legend.innerHTML = '';
  BIOMES.forEach((b, i) => {
    const unlocked = isBiomeUnlocked(i);
    const item = document.createElement('div');
    item.className = 'legend-item' + (unlocked ? '' : ' locked');
    const sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.background = b.color;
    sw.style.border = `1px solid ${b.border}`;
    const name = document.createElement('span');
    name.textContent = b.ru;
    const val = document.createElement('span');
    if (unlocked) {
      val.className = 'legend-val';
      val.textContent = b.resource;
    } else {
      val.className = 'legend-lock';
      val.textContent = `Ур. ${BIOME_UNLOCK_LEVEL[i]}`;
    }
    item.append(sw, name, val);
    legend.appendChild(item);
  });
}
