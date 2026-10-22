// ===========================================================================
// sprites.js — предрендер графики в offscreen-канвасы.
//
// Каждая иконка рисуется один раз при старте, дальше только drawImage.
// Формы намеренно нарисованы кодом: игра — один файл без ассетов.
// ===========================================================================
import { BIOMES, ENEMIES, BUILDINGS } from './config.js';
import { S } from './state.js';

// ============== СПРАЙТЫ ============
export function makeSprite(w, h, drawFn) {
  const scale = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const cc = c.getContext('2d');
  cc.scale(scale, scale);
  drawFn(cc, w, h);
  return c;
}

export function drawBiomeIconShape(cc, biomeIdx, x, y) {
  switch (biomeIdx) {
    case 0: {
      cc.fillStyle = '#4a2a10'; cc.fillRect(x - 1.5, y + 1, 3, 8);
      cc.fillStyle = '#1a5a2a';
      cc.beginPath(); cc.moveTo(x, y - 10); cc.lineTo(x - 7, y + 1); cc.lineTo(x + 7, y + 1); cc.closePath(); cc.fill();
      cc.fillStyle = '#2a7a3a';
      cc.beginPath(); cc.moveTo(x, y - 10); cc.lineTo(x - 5, y - 2); cc.lineTo(x + 5, y - 2); cc.closePath(); cc.fill();
      break;
    }
    case 1: {
      cc.fillStyle = '#4a5a2a';
      cc.beginPath();
      cc.moveTo(x - 7, y + 2); cc.lineTo(x - 6, y - 3); cc.lineTo(x - 1, y - 6);
      cc.lineTo(x + 5, y - 4); cc.lineTo(x + 7, y + 2); cc.lineTo(x + 3, y + 6);
      cc.lineTo(x - 3, y + 6); cc.closePath(); cc.fill();
      cc.fillStyle = '#8aa02a';
      cc.beginPath(); cc.arc(x - 2, y - 1, 1.8, 0, Math.PI * 2); cc.fill();
      cc.beginPath(); cc.arc(x + 2, y + 2, 1.5, 0, Math.PI * 2); cc.fill();
      break;
    }
    case 2: {
      cc.fillStyle = '#0f0f0f';
      cc.beginPath(); cc.arc(x - 3, y + 2, 4, 0, Math.PI * 2); cc.fill();
      cc.beginPath(); cc.arc(x + 4, y + 3, 3.5, 0, Math.PI * 2); cc.fill();
      cc.beginPath(); cc.arc(x, y - 3, 4.5, 0, Math.PI * 2); cc.fill();
      break;
    }
    case 3: {
      cc.fillStyle = '#7ac0e8';
      cc.beginPath();
      cc.moveTo(x, y - 9); cc.lineTo(x + 5, y - 1); cc.lineTo(x, y + 9); cc.lineTo(x - 5, y - 1);
      cc.closePath(); cc.fill();
      cc.fillStyle = '#d0ecff';
      cc.beginPath();
      cc.moveTo(x, y - 9); cc.lineTo(x + 3, y - 2); cc.lineTo(x, y + 2); cc.lineTo(x - 3, y - 2);
      cc.closePath(); cc.fill();
      break;
    }
    case 4: {
      cc.fillStyle = '#7a6a8a';
      cc.beginPath();
      cc.moveTo(x - 7, y + 4); cc.lineTo(x - 5, y - 4); cc.lineTo(x + 1, y - 7);
      cc.lineTo(x + 6, y - 2); cc.lineTo(x + 4, y + 5); cc.lineTo(x - 2, y + 6);
      cc.closePath(); cc.fill();
      cc.strokeStyle = '#a08aa8'; cc.lineWidth = 1; cc.stroke();
      break;
    }
    case 5: {
      cc.fillStyle = '#2a5a10';
      cc.beginPath();
      cc.moveTo(x - 7, y - 4); cc.quadraticCurveTo(x, y - 8, x + 7, y - 4);
      cc.quadraticCurveTo(x, y + 2, x - 7, y - 4); cc.fill();
      cc.fillStyle = '#6a4a20';
      cc.beginPath();
      cc.moveTo(x, y - 2);
      cc.quadraticCurveTo(x - 4, y + 4, x - 2, y + 6);
      cc.quadraticCurveTo(x, y + 8, x + 2, y + 6);
      cc.quadraticCurveTo(x + 4, y + 4, x, y - 2);
      cc.fill();
      cc.fillStyle = '#a07040';
      cc.beginPath(); cc.arc(x - 0.5, y + 4, 1, 0, Math.PI * 2); cc.fill();
      break;
    }
    case 6: {
      cc.fillStyle = '#15151f';
      cc.beginPath();
      cc.moveTo(x, y - 10); cc.lineTo(x + 3, y - 2); cc.lineTo(x + 5, y + 5);
      cc.lineTo(x - 2, y + 7); cc.lineTo(x - 5, y + 2); cc.closePath(); cc.fill();
      cc.strokeStyle = '#7a7ac0'; cc.lineWidth = 1; cc.stroke();
      break;
    }
  }
}

export function drawHumanShape(cc, cx, cy) {
  const x = cx, y = cy;
  cc.strokeStyle = '#1a0f08'; cc.lineWidth = 1.8; cc.lineCap = 'round';
  cc.beginPath();
  cc.moveTo(x - 1.5, y + 2); cc.lineTo(x - 2.6, y + 6);
  cc.moveTo(x + 1.5, y + 2); cc.lineTo(x + 2.6, y + 6);
  cc.stroke();
  cc.fillStyle = '#5a3a20';
  cc.beginPath();
  cc.moveTo(x - 3.2, y - 2); cc.lineTo(x + 3.2, y - 2);
  cc.lineTo(x + 3.6, y + 3); cc.lineTo(x - 3.6, y + 3);
  cc.closePath(); cc.fill();
  cc.fillStyle = '#1a0f08';
  cc.fillRect(x - 3.6, y + 0.8, 7.2, 1.2);
  cc.strokeStyle = '#5a3a20'; cc.lineWidth = 2;
  cc.beginPath();
  cc.moveTo(x - 3, y - 1); cc.lineTo(x - 4.8, y + 2.2);
  cc.moveTo(x + 3, y - 1); cc.lineTo(x + 4.8, y + 2.2);
  cc.stroke();
  cc.fillStyle = '#e0b890';
  cc.beginPath(); cc.arc(x - 4.8, y + 2.6, 1, 0, Math.PI * 2); cc.fill();
  cc.beginPath(); cc.arc(x + 4.8, y + 2.6, 1, 0, Math.PI * 2); cc.fill();
  cc.beginPath(); cc.arc(x, y - 5, 2.8, 0, Math.PI * 2); cc.fill();
  cc.fillStyle = '#3a2010';
  cc.beginPath(); cc.arc(x, y - 5.5, 2.8, Math.PI, 0); cc.fill();
}

export function drawEnemyShape(cc, cx, cy, enemy) {
  const x = cx, y = cy;
  cc.fillStyle = enemy.color;
  cc.beginPath();
  cc.moveTo(x - 3.5, y - 1); cc.lineTo(x + 3.5, y - 1);
  cc.lineTo(x + 3.8, y + 3.5); cc.lineTo(x - 3.8, y + 3.5);
  cc.closePath(); cc.fill();
  cc.strokeStyle = enemy.dark; cc.lineWidth = 1.8; cc.lineCap = 'round';
  cc.beginPath();
  cc.moveTo(x - 1.5, y + 3); cc.lineTo(x - 2.8, y + 6.5);
  cc.moveTo(x + 1.5, y + 3); cc.lineTo(x + 2.8, y + 6.5);
  cc.stroke();
  cc.fillStyle = enemy.color;
  cc.beginPath(); cc.arc(x, y - 4, 3.4, 0, Math.PI * 2); cc.fill();
  cc.strokeStyle = enemy.dark; cc.lineWidth = 1.6;
  cc.beginPath();
  cc.moveTo(x - 3, y - 6); cc.lineTo(x - 5, y - 9);
  cc.moveTo(x + 3, y - 6); cc.lineTo(x + 5, y - 9);
  cc.stroke();
  cc.fillStyle = '#ffe060';
  cc.beginPath(); cc.arc(x - 1.4, y - 5, 0.9, 0, Math.PI * 2); cc.fill();
  cc.beginPath(); cc.arc(x + 1.4, y - 5, 0.9, 0, Math.PI * 2); cc.fill();
  cc.fillStyle = enemy.dark;
  cc.globalAlpha = 0.75;
  cc.beginPath();
  cc.moveTo(x - 3.5, y - 1); cc.lineTo(x - 7, y - 3); cc.lineTo(x - 5.5, y + 1);
  cc.closePath(); cc.fill();
  cc.beginPath();
  cc.moveTo(x + 3.5, y - 1); cc.lineTo(x + 7, y - 3); cc.lineTo(x + 5.5, y + 1);
  cc.closePath(); cc.fill();
  cc.globalAlpha = 1;
}

export function drawBuildingShape(cc, cx, cy, building) {
  const x = cx, y = cy;
  const icon = building.icon;

  if (!icon.startsWith('house')) {
    cc.fillStyle = building.color;
    cc.fillRect(x - 6, y - 2, 12, 9);
    cc.strokeStyle = 'rgba(0,0,0,0.5)'; cc.lineWidth = 1;
    cc.strokeRect(x - 6, y - 2, 12, 9);
  }

  switch (icon) {
    case 'tower1':
    case 'tower2':
    case 'tower3': {
      cc.fillStyle = building.color;
      cc.beginPath();
      cc.moveTo(x - 7, y - 2); cc.lineTo(x, y - 10); cc.lineTo(x + 7, y - 2);
      cc.closePath(); cc.fill();
      cc.fillStyle = '#000';
      cc.fillRect(x - 2, y - 6, 4, 3);
      if (icon === 'tower2' || icon === 'tower3') {
        cc.fillStyle = '#ffe060';
        cc.fillRect(x - 1, y - 5, 2, 1);
      }
      if (icon === 'tower3') {
        cc.strokeStyle = '#c02040'; cc.lineWidth = 1;
        cc.beginPath();
        cc.moveTo(x + 5, y - 12); cc.lineTo(x + 5, y - 8);
        cc.stroke();
        cc.fillStyle = '#c02040';
        cc.beginPath();
        cc.moveTo(x + 6, y - 12); cc.lineTo(x + 10, y - 10); cc.lineTo(x + 6, y - 8);
        cc.closePath(); cc.fill();
      }
      break;
    }
    case 'warehouse1':
    case 'warehouse2':
    case 'warehouse3': {
      cc.fillStyle = '#5a3a10';
      cc.beginPath();
      cc.moveTo(x - 7, y - 2); cc.lineTo(x, y - 8); cc.lineTo(x + 7, y - 2);
      cc.closePath(); cc.fill();
      if (icon === 'warehouse2' || icon === 'warehouse3') {
        cc.fillStyle = '#ffe060';
        cc.fillRect(x - 1, y + 1, 2, 3);
      }
      if (icon === 'warehouse3') {
        cc.fillStyle = '#ffe060';
        cc.fillRect(x - 4, y + 1, 2, 2);
        cc.fillRect(x + 2, y + 1, 2, 2);
      }
      break;
    }
    case 'armor1':
    case 'armor2':
    case 'armor3': {
      cc.fillStyle = '#a0a0b0';
      cc.beginPath();
      cc.moveTo(x, y - 10);
      cc.lineTo(x - 5, y - 7); cc.lineTo(x - 4, y + 1);
      cc.lineTo(x, y + 4); cc.lineTo(x + 4, y + 1);
      cc.lineTo(x + 5, y - 7); cc.closePath(); cc.fill();
      if (icon === 'armor2' || icon === 'armor3') {
        cc.fillStyle = '#ffe060';
        cc.beginPath(); cc.arc(x, y - 3, 1.5, 0, Math.PI * 2); cc.fill();
      }
      if (icon === 'armor3') {
        cc.fillStyle = '#d0a0ff';
        cc.beginPath(); cc.arc(x, y - 6, 1.2, 0, Math.PI * 2); cc.fill();
      }
      break;
    }
    case 'weapon1':
    case 'weapon2':
    case 'weapon3': {
      cc.strokeStyle = '#c0c0d0'; cc.lineWidth = 2;
      cc.beginPath();
      cc.moveTo(x - 5, y + 4); cc.lineTo(x + 5, y - 6);
      cc.stroke();
      cc.fillStyle = '#803020';
      cc.fillRect(x - 5, y + 2, 4, 2);
      if (icon === 'weapon2' || icon === 'weapon3') {
        cc.fillStyle = '#ffe060';
        cc.beginPath(); cc.arc(x + 5, y - 6, 1.5, 0, Math.PI * 2); cc.fill();
      }
      if (icon === 'weapon3') {
        cc.fillStyle = '#d0a0ff';
        cc.beginPath(); cc.arc(x + 5, y - 6, 0.8, 0, Math.PI * 2); cc.fill();
      }
      break;
    }
    case 'healer': {
      cc.fillStyle = '#e04040';
      cc.fillRect(x - 2, y - 9, 4, 12);
      cc.fillRect(x - 6, y - 5, 12, 4);
      cc.fillStyle = '#fff';
      cc.fillRect(x - 1, y - 8, 2, 10);
      cc.fillRect(x - 5, y - 4, 10, 2);
      break;
    }
    case 'monolith': {
      cc.fillStyle = '#2a1040';
      cc.beginPath();
      cc.moveTo(x - 5, y + 6); cc.lineTo(x - 3, y - 10);
      cc.lineTo(x, y - 12); cc.lineTo(x + 3, y - 10);
      cc.lineTo(x + 5, y + 6); cc.closePath(); cc.fill();
      cc.strokeStyle = '#a060d0'; cc.lineWidth = 1; cc.stroke();
      cc.fillStyle = '#d090ff';
      cc.beginPath(); cc.arc(x, y - 4, 2, 0, Math.PI * 2); cc.fill();
      break;
    }
    case 'house1':
    case 'house2':
    case 'house3': {
      cc.fillStyle = '#8a6a40';
      cc.fillRect(x - 6, y - 2, 12, 9);
      cc.strokeStyle = 'rgba(0,0,0,0.5)'; cc.lineWidth = 1;
      cc.strokeRect(x - 6, y - 2, 12, 9);
      cc.fillStyle = '#a03020';
      cc.beginPath();
      cc.moveTo(x - 8, y - 2); cc.lineTo(x, y - 10); cc.lineTo(x + 8, y - 2);
      cc.closePath(); cc.fill();
      cc.fillStyle = '#3a1a08';
      cc.fillRect(x - 1.5, y + 2, 3, 5);
      if (icon === 'house2' || icon === 'house3') {
        cc.fillStyle = '#ffe060';
        cc.fillRect(x - 4, y + 1, 2.5, 2.5);
      }
      if (icon === 'house3') {
        cc.fillStyle = '#ffe060';
        cc.fillRect(x + 1.5, y + 1, 2.5, 2.5);
        cc.fillStyle = '#5a4030';
        cc.fillRect(x + 4, y - 8, 2, 4);
      }
      break;
    }
  }
}

export function buildSprites() {
  S.biomeSprites = BIOMES.map((_, i) => makeSprite(24, 24, (cc) => drawBiomeIconShape(cc, i, 12, 12)));
  S.humanSprite = makeSprite(14, 18, (cc) => drawHumanShape(cc, 7, 9));
  S.enemySprites = ENEMIES.map((e) => makeSprite(16, 18, (cc) => drawEnemyShape(cc, 8, 9, e)));
  S.buildingSprites = BUILDINGS.map((b) => makeSprite(20, 22, (cc) => drawBuildingShape(cc, 10, 11, b)));
}
