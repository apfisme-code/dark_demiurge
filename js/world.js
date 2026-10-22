// ===========================================================================
// world.js — геометрия мира.
//
// Всё, что не меняется в течение партии и выводится из положения портала
// и захваченных клеток. Здесь же — производные клетковые кэши (синергия и
// доля пустотной границы), потому что они считаются по той же геометрии.
// ===========================================================================
import {
  TOTAL_POINTS, WORLD_SCALE, MIN_EDGE_RATIO,
  SYNERGY_MIN, SYNERGY_MAX, BIOMES,
  WORLD_RELAX_PASSES, GEOMETRY_EPSILON, EDGE_MATCH_EPSILON,
  CELL_CAP_SCALE, CELL_CAP_MIN, CELL_CAP_MAX,
} from './config.js';
import { S, canvas, ctx } from './state.js';
import { buildSprites } from './sprites.js';

// ============== SETUP ============
export function setup() {
  S.dpr = window.devicePixelRatio || 1;
  S.width = window.innerWidth;
  const hh = document.getElementById('header').offsetHeight;
  S.height = window.innerHeight - hh;
  canvas.width = S.width * S.dpr;
  canvas.height = S.height * S.dpr;
  canvas.style.width = S.width + 'px';
  canvas.style.height = S.height + 'px';
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
}

export function clampCam() {
  if (S.worldW <= S.width) S.camX = (S.worldW - S.width) / 2;
  else S.camX = Math.max(0, Math.min(S.worldW - S.width, S.camX));
  if (S.worldH <= S.height) S.camY = (S.worldH - S.height) / 2;
  else S.camY = Math.max(0, Math.min(S.worldH - S.height, S.camY));
}

export function generatePoints() {
  let pts = [];
  for (let i = 0; i < TOTAL_POINTS; i++) pts.push([Math.random() * S.worldW, Math.random() * S.worldH]);
  const bounds = [0, 0, S.worldW, S.worldH];
  for (let k = 0; k < WORLD_RELAX_PASSES; k++) {
    const d = d3.Delaunay.from(pts);
    const v = d.voronoi(bounds);
    const newPts = [];
    for (let i = 0; i < pts.length; i++) {
      const cell = v.cellPolygon(i);
      if (!cell || cell.length < 3) { newPts.push(pts[i]); continue; }
      let area = 0, cx = 0, cy = 0;
      for (let j = 0; j < cell.length - 1; j++) {
        const [x0, y0] = cell[j], [x1, y1] = cell[j + 1];
        const cross = x0 * y1 - x1 * y0;
        area += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
      }
      area /= 2;
      if (Math.abs(area) < GEOMETRY_EPSILON) { newPts.push(pts[i]); continue; }
      cx /= 6 * area; cy /= 6 * area;
      cx = Math.max(1, Math.min(S.worldW - 1, cx));
      cy = Math.max(1, Math.min(S.worldH - 1, cy));
      newPts.push([cx, cy]);
    }
    pts = newPts;
  }
  return pts;
}

export function polyArea(cell) {
  let a = 0;
  for (let i = 0; i < cell.length - 1; i++) a += cell[i][0] * cell[i+1][1] - cell[i+1][0] * cell[i][1];
  return Math.abs(a / 2);
}

export function cellPerimeter(cell) {
  let p = 0;
  for (let i = 0; i < cell.length - 1; i++) p += Math.hypot(cell[i+1][0] - cell[i][0], cell[i+1][1] - cell[i][1]);
  return p;
}

export function findSharedEdge(polyA, polyB) {
  const eps = EDGE_MATCH_EPSILON;
  const common = [];
  for (const pa of polyA) {
    let matched = false;
    for (const pb of polyB) {
      if (Math.abs(pa[0] - pb[0]) < eps && Math.abs(pa[1] - pb[1]) < eps) { matched = true; break; }
    }
    if (!matched) continue;
    let dup = false;
    for (const c of common) {
      if (Math.abs(c[0] - pa[0]) < eps && Math.abs(c[1] - pa[1]) < eps) { dup = true; break; }
    }
    if (!dup) common.push(pa);
  }
  if (common.length < 2) return null;
  let bestLen = 0, bestP1 = null, bestP2 = null;
  for (let a = 0; a < common.length; a++) {
    for (let b = a + 1; b < common.length; b++) {
      const d = Math.hypot(common[a][0] - common[b][0], common[a][1] - common[b][1]);
      if (d > bestLen) { bestLen = d; bestP1 = common[a]; bestP2 = common[b]; }
    }
  }
  if (!bestP1 || !bestP2) return null;
  return { len: bestLen, p1: bestP1, p2: bestP2 };
}

export function computeSharedEdges() {
  S.sharedEdge = new Array(S.points.length);
  for (let i = 0; i < S.points.length; i++) S.sharedEdge[i] = new Map();
  for (let i = 0; i < S.points.length; i++) {
    const cellI = S.voronoi.cellPolygon(i);
    if (!cellI) continue;
    for (const j of S.neighborLists[i]) {
      if (j <= i) continue;
      const cellJ = S.voronoi.cellPolygon(j);
      if (!cellJ) continue;
      const edge = findSharedEdge(cellI, cellJ);
      if (!edge) continue;
      S.sharedEdge[i].set(j, edge);
      S.sharedEdge[j].set(i, edge);
    }
  }
}

export function computeCellCaps() {
  S.cellCaps = new Array(S.points.length).fill(1);
  const avgArea = (S.worldW * S.worldH) / TOTAL_POINTS;
  for (let i = 0; i < S.points.length; i++) {
    const cell = S.voronoi.cellPolygon(i);
    if (!cell) continue;
    const raw = Math.round(polyArea(cell) / avgArea * CELL_CAP_SCALE);
    S.cellCaps[i] = Math.max(CELL_CAP_MIN, Math.min(CELL_CAP_MAX, raw));
  }
}

export function computeCellRadii() {
  S.cellRadius = new Array(S.points.length).fill(8);
  S.cellPolygonCache = new Array(S.points.length).fill(null);
  S.cellCentroidCache = new Array(S.points.length).fill(null);
  S.cellBBoxCache = new Array(S.points.length).fill(null);
  S.cellPerimeterCache = new Array(S.points.length).fill(0);

  for (let i = 0; i < S.points.length; i++) {
    const cell = S.voronoi.cellPolygon(i);
    if (!cell) continue;
    S.cellPolygonCache[i] = cell;
    const n = cell.length - 1;
    S.cellRadius[i] = Math.sqrt(polyArea(cell) / Math.PI);

    let sx = 0, sy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let j = 0; j < n; j++) {
      const x = cell[j][0], y = cell[j][1];
      sx += x; sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    S.cellCentroidCache[i] = [sx / n, sy / n];
    S.cellBBoxCache[i] = [minX, minY, maxX, maxY];
    S.cellPerimeterCache[i] = cellPerimeter(cell);
  }
}

export function recomputeBiomeAreas() {
  S.biomeAreas = new Array(BIOMES.length).fill(0);
  S.totalClaimedArea = 0;
  for (const [idx, biome] of S.claimed) {
    const a = polyArea(S.cellPolygonCache[idx]);
    S.biomeAreas[biome] += a;
    S.totalClaimedArea += a;
  }
}

export function recomputeAllCaches() {
  S.cellSynergy = new Array(S.points.length).fill(1);
  S.cellVoidFraction = new Array(S.points.length).fill(0);

  for (const [idx, myBiome] of S.claimed) {
    const perimeter = S.cellPerimeterCache[idx] || 0;
    if (perimeter < GEOMETRY_EPSILON) continue;
    const edges = S.sharedEdge[idx];
    let claimedLen = 0, sameLen = 0;
    if (edges) {
      for (const [n, edge] of edges) {
        if (!S.claimed.has(n)) continue;
        claimedLen += edge.len;
        if (S.claimed.get(n) === myBiome) sameLen += edge.len;
      }
    }
    S.cellVoidFraction[idx] = Math.max(0, perimeter - claimedLen) / perimeter;
    S.cellSynergy[idx] = SYNERGY_MIN + (SYNERGY_MAX - SYNERGY_MIN) * (sameLen / perimeter);
  }

  recomputeBiomeAreas();
}

export function previewSynergy(idx, biomeIdx) {
  const perimeter = S.cellPerimeterCache[idx] || 0;
  if (perimeter < GEOMETRY_EPSILON) return 1;
  let sameLen = 0;
  const edges = S.sharedEdge[idx];
  if (edges) {
    for (const [n, edge] of edges) {
      if (!S.claimed.has(n)) continue;
      if (S.claimed.get(n) === biomeIdx) sameLen += edge.len;
    }
  }
  return SYNERGY_MIN + (SYNERGY_MAX - SYNERGY_MIN) * (sameLen / perimeter);
}

// ============ СЛОТЫ ============
export function getSlotGrid(count) {
  if (count <= 1) return [1, 1];
  if (count === 2) return [2, 1];
  if (count <= 4) return [2, 2];
  if (count <= 6) return [3, 2];
  if (count <= 9) return [3, 3];
  if (count <= 12) return [4, 3];
  if (count <= 16) return [4, 4];
  if (count <= 20) return [5, 4];
  if (count <= 25) return [5, 5];
  return [6, 5];
}

export function getSlotPositions(count, radius) {
  if (count <= 0) return [];
  const [cols, rows] = getSlotGrid(count);
  const gridN = Math.max(cols, rows);
  const spacing = Math.min((radius * 1.55) / gridN, 46);
  const positions = [];
  let placed = 0;
  for (let r = 0; r < rows; r++) {
    const rowCount = Math.min(cols, count - placed);
    for (let c = 0; c < rowCount; c++) {
      positions.push([(c - (rowCount - 1) / 2) * spacing, (r - (rows - 1) / 2) * spacing]);
      placed++;
    }
    if (placed >= count) break;
  }
  return positions;
}

export function generateWorld() {
  setup();
  S.worldW = Math.round(S.width * WORLD_SCALE);
  S.worldH = Math.round(S.height * WORLD_SCALE);

  S.points = generatePoints();
  S.delaunay = d3.Delaunay.from(S.points);
  S.voronoi = S.delaunay.voronoi([0, 0, S.worldW, S.worldH]);

  S.neighborLists = [];
  for (let i = 0; i < S.points.length; i++) S.neighborLists.push(Array.from(S.delaunay.neighbors(i)));

  S.MIN_EDGE_LENGTH = Math.sqrt((S.worldW * S.worldH) / TOTAL_POINTS) * MIN_EDGE_RATIO;
  computeSharedEdges();
  computeCellCaps();
  computeCellRadii();
  buildSprites();

  const cx = S.worldW / 2, cy = S.worldH / 2;
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < S.points.length; i++) {
    const d = (S.points[i][0] - cx) ** 2 + (S.points[i][1] - cy) ** 2;
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  S.portalCellIdx = bestIdx;
}
