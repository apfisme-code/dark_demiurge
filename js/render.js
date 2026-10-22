// ===========================================================================
// render.js — отрисовка мира на канвас.
//
// Единственный модуль, который знает про ctx. Не меняет состояние.
// ===========================================================================
import { BIOMES, BUILDING_MAP } from './config.js';
import {
  S, ctx, popup,
  getPoolPeople, getClaimCost, getImpPeriod,
} from './state.js';
import { getSlotGrid, getSlotPositions } from './world.js';

// ============== DRAWING ============
export function draw() {
  ctx.fillStyle = '#020205';
  ctx.fillRect(0, 0, S.width, S.height);
  if (!S.voronoi) return;

  ctx.save();
  ctx.translate(-S.camX, -S.camY);

  ctx.strokeStyle = 'rgba(120, 100, 200, 0.15)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, S.worldW, S.worldH);

  const camR = S.camX + S.width;
  const camB = S.camY + S.height;

  for (let i = 0; i < S.points.length; i++) {
    if (S.claimed.has(i)) continue;
    const cell = S.cellPolygonCache[i];
    if (!cell) continue;
    const bb = S.cellBBoxCache[i];
    if (bb && (bb[2] < S.camX || bb[0] > camR || bb[3] < S.camY || bb[1] > camB)) continue;

    const claimable = S.claimableSet.has(i);
    const hovered = (i === S.hoveredIndex && claimable);

    ctx.beginPath();
    ctx.moveTo(cell[0][0], cell[0][1]);
    for (let j = 1; j < cell.length; j++) ctx.lineTo(cell[j][0], cell[j][1]);
    ctx.closePath();

    if (hovered) ctx.fillStyle = 'rgba(255, 200, 140, 0.20)';
    else if (claimable) ctx.fillStyle = 'rgba(60, 60, 95, 0.30)';
    else ctx.fillStyle = 'rgba(15, 15, 24, 0.55)';
    ctx.fill();

    ctx.strokeStyle = claimable ? 'rgba(130, 130, 180, 0.4)' : 'rgba(50, 50, 80, 0.28)';
    ctx.lineWidth = claimable ? 1 : 0.6;
    ctx.stroke();

    if (claimable) {
      const c = S.cellCentroidCache[i];
      if (!c) continue;
      const cost = getClaimCost(i);
      const canPay = S.chaosBlood >= cost;
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const txt = String(cost);
      const w = ctx.measureText(txt).width;
      const pw = w + 16, ph = 18;
      const px = c[0] - pw / 2, py = c[1] - ph / 2;
      ctx.fillStyle = canPay ? 'rgba(120, 50, 160, 0.85)' : 'rgba(80, 40, 110, 0.55)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(px, py, pw, ph, 9);
      else ctx.rect(px, py, pw, ph);
      ctx.fill();
      ctx.fillStyle = canPay ? '#f0d0ff' : '#a080c0';
      ctx.fillText(txt, c[0], c[1]);
    }
  }

  for (const [idx, biomeIdx] of S.claimed) {
    const cell = S.cellPolygonCache[idx];
    if (!cell) continue;
    const bb = S.cellBBoxCache[idx];
    if (bb && (bb[2] < S.camX || bb[0] > camR || bb[3] < S.camY || bb[1] > camB)) continue;

    const b = BIOMES[biomeIdx];
    const syn = S.cellSynergy[idx] || 1;
    const inBattle = S.cellHasBattle.has(idx);

    ctx.beginPath();
    ctx.moveTo(cell[0][0], cell[0][1]);
    for (let j = 1; j < cell.length; j++) ctx.lineTo(cell[j][0], cell[j][1]);
    ctx.closePath();

    ctx.strokeStyle = inBattle ? 'rgba(255, 80, 80, 0.6)' : b.border;
    ctx.lineWidth = 8;
    ctx.globalAlpha = 0.13;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = b.color;
    ctx.fill();

    if (inBattle) {
      const t = performance.now() * 0.008;
      const pulse = 0.5 + 0.5 * Math.sin(t);
      ctx.fillStyle = `rgba(200, 40, 40, ${0.12 + 0.15 * pulse})`;
      ctx.fill();
    } else if (syn > 1.05) {
      const alpha = Math.min(0.20, (syn - 1) * 0.22);
      ctx.fillStyle = `rgba(90, 220, 120, ${alpha})`;
      ctx.fill();
    } else if (syn < 0.95) {
      const alpha = Math.min(0.22, (1 - syn) * 0.32);
      ctx.fillStyle = `rgba(220, 80, 80, ${alpha})`;
      ctx.fill();
    }

    ctx.strokeStyle = inBattle ? 'rgba(255, 100, 100, 0.95)' : b.border;
    ctx.lineWidth = inBattle ? 2.4 : 1.6;
    ctx.stroke();
  }

  ctx.save();
  ctx.lineCap = 'round';
  for (const [idx] of S.claimed) {
    const bb = S.cellBBoxCache[idx];
    if (bb && (bb[2] < S.camX || bb[0] > camR || bb[3] < S.camY || bb[1] > camB)) continue;
    const edges = S.sharedEdge[idx];
    if (!edges) continue;
    for (const [n, edge] of edges) {
      if (S.claimed.has(n)) continue;
      if (edge.len < 1) continue;
      ctx.strokeStyle = 'rgba(160, 64, 208, 0.35)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(edge.p1[0], edge.p1[1]);
      ctx.lineTo(edge.p2[0], edge.p2[1]);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(224, 160, 255, 0.95)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(edge.p1[0], edge.p1[1]);
      ctx.lineTo(edge.p2[0], edge.p2[1]);
      ctx.stroke();
    }
  }
  ctx.restore();

  for (const [idx, biomeIdx] of S.claimed) {
    const cell = S.cellPolygonCache[idx];
    if (!cell) continue;
    const bb = S.cellBBoxCache[idx];
    if (bb && (bb[2] < S.camX || bb[0] > camR || bb[3] < S.camY || bb[1] > camB)) continue;

    const c = S.cellCentroidCache[idx];
    if (!c) continue;
    const mx = c[0], my = c[1];
    const cr = S.cellRadius[idx] || 12;

    const slots = S.cellSlots.get(idx);
    if (!slots) continue;
    const reserved = S.cellSlotReserved.get(idx);

    const cap = slots.length;
    const positions = getSlotPositions(cap, cr);
    const [cols, rows] = getSlotGrid(cap);
    const gridN = Math.max(cols, rows);
    const spacing = Math.min((cr * 1.55) / gridN, 46);
    const slotSize = Math.min(spacing * 0.92, 30, cr * 0.55);

    for (let i = 0; i < cap; i++) {
      const pos = positions[i];
      if (!pos) continue;
      const sxx = mx + pos[0];
      const syy = my + pos[1];
      const s = slots[i];
      const isReserved = reserved && reserved[i];

      if (s && s.t === 'portal') {
        const t2 = performance.now() * 0.003;
        const pulse = 0.6 + 0.4 * Math.sin(t2);
        ctx.beginPath();
        ctx.arc(sxx, syy, slotSize * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 180, 80, ${0.15 + 0.15 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 210, 120, ${0.7 + 0.3 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sxx, syy, slotSize * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sxx, syy, slotSize * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 240, 180, ${pulse})`;
        ctx.fill();
        continue;
      }

      ctx.beginPath();
      ctx.arc(sxx, syy, slotSize * 0.52, 0, Math.PI * 2);
      const hasOccupant = s && s.t !== null;
      ctx.fillStyle = hasOccupant ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.35)';
      ctx.fill();

      if (isReserved && !s) {
        const t2 = performance.now() * 0.004;
        const pulse = 0.5 + 0.5 * Math.sin(t2);
        ctx.strokeStyle = `rgba(255, 210, 120, ${0.45 + 0.4 * pulse})`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(sxx, syy, slotSize * 0.52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (!s) {
        ctx.globalAlpha = 0.32;
        ctx.drawImage(S.biomeSprites[biomeIdx], sxx - slotSize / 2, syy - slotSize / 2, slotSize, slotSize);
        ctx.globalAlpha = 1;
        continue;
      }

      const hw = slotSize * 0.85;
      const hh = hw * (18 / 14);
      const iw = slotSize * 0.95;
      const ih = iw * (18 / 16);

      if (s.t === 'h') {
        ctx.drawImage(S.biomeSprites[biomeIdx], sxx - slotSize / 2, syy - slotSize / 2, slotSize, slotSize);
        ctx.drawImage(S.humanSprite, sxx - hw / 2, syy - hh * 0.35, hw, hh);
        if (s.hp < s.maxHp) {
          const bw = slotSize * 0.9, bh = 3;
          const bx = sxx - bw / 2, by = syy - hh * 0.35 - 5;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.fillStyle = '#6bc07a';
          ctx.fillRect(bx, by, bw * (s.hp / s.maxHp), bh);
        }
      } else if (s.t === 'i') {
        const es = S.enemySprites[s.biomeIdx || 0];
        ctx.drawImage(es, sxx - iw / 2, syy - ih * 0.35, iw, ih);
        const bw = slotSize * 0.9, bh = 3;
        const bx = sxx - bw / 2, by = syy - ih * 0.55;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#d04040';
        ctx.fillRect(bx, by, bw * Math.max(0, s.hp / s.maxHp), bh);
      } else if (s.t === 'b') {
        const hx = sxx - slotSize * 0.22;
        const ix = sxx + slotSize * 0.22;
        ctx.drawImage(S.humanSprite, hx - hw / 2, syy - hh * 0.35, hw * 0.85, hh * 0.85);
        const es = S.enemySprites[s.i.biomeIdx || 0];
        ctx.drawImage(es, ix - iw / 2, syy - ih * 0.35, iw * 0.85, ih * 0.85);
        const bw = slotSize * 0.75, bh = 3;
        const hbx = hx - bw / 2, hby = syy - hh * 0.55;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(hbx, hby, bw, bh);
        ctx.fillStyle = '#6bc07a';
        ctx.fillRect(hbx, hby, bw * Math.max(0, s.h.hp / s.h.maxHp), bh);
        const ibx = ix - bw / 2, iby = syy - ih * 0.55;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(ibx, iby, bw, bh);
        ctx.fillStyle = '#d04040';
        ctx.fillRect(ibx, iby, bw * Math.max(0, s.i.hp / s.i.maxHp), bh);
      } else if (s.t === 'bld') {
        const bs = S.buildingSprites[s.id];
        const bInfo = BUILDING_MAP[s.id];
        const isHouse = bInfo && bInfo.effect === 'house';
        const bsW = slotSize * (20 / 22);
        const bsH = slotSize;
        ctx.drawImage(bs, sxx - bsW / 2, syy - bsH / 2, bsW, bsH);

        if (s.battle) {
          const hx = sxx - slotSize * 0.22;
          const ix = sxx + slotSize * 0.22;
          ctx.drawImage(S.humanSprite, hx - hw / 2, syy - hh * 0.35, hw * 0.85, hh * 0.85);
          const es = S.enemySprites[s.battle.i.biomeIdx || 0];
          ctx.drawImage(es, ix - iw / 2, syy - ih * 0.35, iw * 0.85, ih * 0.85);
          const bw = slotSize * 0.75, bh = 3;
          const hbx = hx - bw / 2, hby = syy - hh * 0.55;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(hbx, hby, bw, bh);
          ctx.fillStyle = '#6bc07a';
          ctx.fillRect(hbx, hby, bw * Math.max(0, s.worker.hp / s.worker.maxHp), bh);
          const ibx = ix - bw / 2, iby = syy - ih * 0.55;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(ibx, iby, bw, bh);
          ctx.fillStyle = '#d04040';
          ctx.fillRect(ibx, iby, bw * Math.max(0, s.battle.i.hp / s.battle.i.maxHp), bh);
        } else if (!s.worker) {
          if (!isHouse) {
            const t2 = performance.now() * 0.005;
            const pulse = 0.5 + 0.5 * Math.sin(t2);
            ctx.strokeStyle = `rgba(255, 200, 100, ${0.6 + 0.4 * pulse})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(sxx, syy, slotSize * 0.58, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          const t3 = performance.now() * 0.005;
          const pulse3 = 0.6 + 0.4 * Math.sin(t3);
          const vx = sxx + slotSize * 0.35;
          const vy = syy - slotSize * 0.35;
          ctx.fillStyle = `rgba(255, 80, 80, ${pulse3})`;
          ctx.beginPath();
          ctx.arc(vx, vy, 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(80, 0, 0, 0.8)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        } else if (s.worker) {
          ctx.drawImage(S.humanSprite, sxx - hw * 0.5, syy + slotSize * 0.15, hw * 0.7, hh * 0.7);
        }
      }
    }

    const period = getImpPeriod(idx);
    if (period < Infinity) {
      const elapsed = S.cellImpTimers.get(idx) || 0;
      const ratio = elapsed / period;
      if (ratio > 0.6) {
        const t2 = performance.now() * 0.008;
        const pulse = 0.5 + 0.5 * Math.sin(t2);
        const r = 4 + ratio * 3;
        ctx.beginPath();
        ctx.arc(mx + cr * 0.7, my - cr * 0.7, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 80, 80, ${0.4 + 0.4 * pulse * ratio})`;
        ctx.fill();
      }
    }

    if (idx === S.portalCellIdx) {
      const t = performance.now() * 0.0025;
      const pulse = 0.55 + 0.35 * Math.sin(t);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 210, 120, ${pulse})`;
      ctx.lineWidth = 2.8;
      ctx.setLineDash([9, 6]);
      ctx.beginPath();
      ctx.moveTo(cell[0][0], cell[0][1]);
      for (let j = 1; j < cell.length; j++) ctx.lineTo(cell[j][0], cell[j][1]);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const pool = getPoolPeople();
      if (pool > 0) {
        const txt = `Свободно: ${pool}`;
        ctx.font = 'bold 12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(txt).width;
        const pw = w + 18, ph = 20;
        const px = mx - pw / 2;
        const py = my - Math.max(24, cr * 0.82) - ph;
        ctx.fillStyle = 'rgba(30, 60, 100, 0.92)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(px, py, pw, ph, 10);
        else ctx.rect(px, py, pw, ph);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 200, 255, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = '#c8ecff';
        ctx.fillText(txt, mx, py + ph / 2);
      }
    }
  }

  // Boss
  if (S.boss) {
    const c = S.cellCentroidCache[S.boss.cellIdx];
    if (c) {
      const bmx = c[0], bmy = c[1];
      const bcr = S.cellRadius[S.boss.cellIdx] || 12;
      const t = performance.now() * 0.004;
      const pulse = 0.6 + 0.4 * Math.sin(t);

      // Aura
      ctx.beginPath();
      ctx.arc(bmx, bmy, bcr * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 20, 20, ${0.15 + 0.15 * pulse})`;
      ctx.fill();

      // Body
      ctx.beginPath();
      ctx.arc(bmx, bmy, bcr * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#400000';
      ctx.fill();
      ctx.strokeStyle = '#ff3030';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(bmx, bmy, bcr * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 40, 40, ${0.7 + 0.2 * pulse})`;
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#ffe060';
      ctx.beginPath();
      ctx.arc(bmx - bcr * 0.15, bmy - bcr * 0.1, bcr * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bmx + bcr * 0.15, bmy - bcr * 0.1, bcr * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // HP bar
      const bw = bcr * 1.3, bh = 5;
      const bx = bmx - bw / 2, by = bmy - bcr * 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#ff4040';
      ctx.fillRect(bx, by, bw * Math.max(0, S.boss.hp / S.boss.maxHp), bh);
      ctx.strokeStyle = '#a02020';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }

  if (S.pendingIdx !== null && !popup.classList.contains('hidden')) {
    const cell = S.cellPolygonCache[S.pendingIdx];
    if (cell) {
      const t = performance.now() * 0.004;
      const pulse = 0.5 + 0.5 * Math.sin(t);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 210, 120, ${0.45 + 0.55 * pulse})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -performance.now() * 0.02;
      ctx.beginPath();
      ctx.moveTo(cell[0][0], cell[0][1]);
      for (let j = 1; j < cell.length; j++) ctx.lineTo(cell[j][0], cell[j][1]);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  ctx.restore();

  const vg = ctx.createRadialGradient(
    S.width / 2, S.height / 2, Math.min(S.width, S.height) * 0.35,
    S.width / 2, S.height / 2, Math.max(S.width, S.height) * 0.75
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, S.width, S.height);
}
