import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { compileLevel, simulatePush } from '../minigame/src/core/simulator.js';
import { SKINS } from '../minigame/src/core/constants.js';
import { MASTER_BENCHMARKS } from '../minigame/src/core/leaderboard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS_DIR = path.join(ROOT, 'design', 'ui-screens');
const ASSETS_DIR = path.join(ROOT, 'design', 'ui-assets');
fs.mkdirSync(SCREENS_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const LEVELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'minigame/levels/levels_001_020.json'), 'utf8'));

// Precompute real gameplay states for Level 4 (小猫) using the shared deterministic simulator
const lv4Compiled = compileLevel(LEVELS[3]);
// Mid-play state: after Push 1 of standard solution ([0, 7, 'v']) -> 18 tiles down, 30 standing!
const lv4AfterPush1 = simulatePush(
  lv4Compiled.H, lv4Compiled.W, lv4Compiled.present, lv4Compiled.types,
  new Uint8Array(lv4Compiled.W * lv4Compiled.H),
  lv4Compiled.def.sol[0][0], lv4Compiled.def.sol[0][1], lv4Compiled.def.sol[0][2]
);
// Win state: all 48 tiles down
const lv4Win = new Uint8Array(lv4Compiled.W * lv4Compiled.H);
for (let i = 0; i < lv4Compiled.present.length; i++) if (lv4Compiled.present[i]) lv4Win[i] = 1;
// Fail state: after Push 1 + Push 2 + suboptimal Push 3 (leaves standing tiles!)
const lv4AfterPush2 = simulatePush(
  lv4Compiled.H, lv4Compiled.W, lv4Compiled.present, lv4Compiled.types,
  lv4AfterPush1.nextFallen,
  lv4Compiled.def.sol[1][0], lv4Compiled.def.sol[1][1], lv4Compiled.def.sol[1][2]
);
const lv4FailRes = simulatePush(
  lv4Compiled.H, lv4Compiled.W, lv4Compiled.present, lv4Compiled.types,
  lv4AfterPush2.nextFallen,
  0, 0, '<' // tiny dead-end 1-tile move spending final 3rd push -> 9 standing left!
);

const PAYLOAD = {
  levels: LEVELS,
  skins: SKINS,
  benchmarks: MASTER_BENCHMARKS,
  lv4MidFallen: Array.from(lv4AfterPush1.nextFallen),
  lv4WinFallen: Array.from(lv4Win),
  lv4FailFallen: Array.from(lv4FailRes.nextFallen),
  lv4FailStanding: lv4Compiled.total - lv4FailRes.nextFallen.reduce((a, b) => a + b, 0)
};

const RENDERER_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>UI Design Kit Renderer</title>
</head>
<body style="margin:0;background:#111;">
<div id="status" style="color:#fff;font:14px monospace;padding:8px;">Rendering...</div>
<script>
const DATA = ${JSON.stringify(PAYLOAD)};
const FONT = '"Noto Sans CJK SC", "PingFang SC", "WenQuanYi Zen Hei", sans-serif';

// Story-book cozy palette strictly tuned to reference IMG_8545.jpeg
const PAL = {
  R: { top: '#f26158', bot: '#d43f37', lip: '#b32d26', out: '#6b201b' },
  O: { top: '#ffa03b', bot: '#f27f1d', lip: '#cf600c', out: '#7a3509' },
  Y: { top: '#ffd859', bot: '#f0b82e', lip: '#cc9214', out: '#78520b' },
  G: { top: '#6bc470', bot: '#4da353', lip: '#37823d', out: '#204d24' },
  S: { top: '#68b7fa', bot: '#4496e3', lip: '#2e76bf', out: '#1e4b7a' },
  P: { top: '#ff8fb5', bot: '#ee6a96', lip: '#cc4b78', out: '#782643' },
  C: { top: '#fae5c3', bot: '#e8c99b', lip: '#cca774', out: '#7a5832' },
  T: { top: '#e8a864', bot: '#cf8942', lip: '#ad6b2a', out: '#693d15' },
  B: { top: '#9c623b', bot: '#7d4927', lip: '#5e3419', out: '#3b1f0e' },
  K: { top: '#633e2b', bot: '#4d2e1e', lip: '#3a2014', out: '#24120a' },
  W: { top: '#fffbf2', bot: '#efe4d1', lip: '#d6c6ab', out: '#7d684f' }
};

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function strokeTextChunky(ctx, text, x, y, fill, stroke, lineWidth, align = 'center') {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawStar4(ctx, cx, cy, r, alpha = 0.85, color = '#fff0bd') {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx, cy, cx + r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + r);
  ctx.quadraticCurveTo(cx, cy, cx - r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGlowingWindow(ctx, x, y, w, h, arched = true) {
  ctx.save();
  // Warm golden outer glow
  const grd = ctx.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, Math.max(w, h) * 1.45);
  grd.addColorStop(0, 'rgba(255, 224, 125, 0.55)');
  grd.addColorStop(0.55, 'rgba(255, 186, 76, 0.16)');
  grd.addColorStop(1, 'rgba(255, 186, 76, 0)');
  ctx.fillStyle = grd;
  ctx.fillRect(x - w, y - h, w * 3, h * 3);

  // Window frame
  ctx.fillStyle = '#3b2e4d';
  if (arched) {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2 + 2.5, Math.PI, 0);
    ctx.lineTo(x + w + 2.5, y + h + 2.5);
    ctx.lineTo(x - 2.5, y + h + 2.5);
    ctx.closePath();
    ctx.fill();
  } else {
    rr(ctx, x - 2.5, y - 2.5, w + 5, h + 5, 4);
    ctx.fill();
  }

  // Warm lit panes
  const wg = ctx.createLinearGradient(x, y, x, y + h);
  wg.addColorStop(0, '#fff3b8');
  wg.addColorStop(1, '#ffc857');
  ctx.fillStyle = wg;
  if (arched) {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
  } else {
    rr(ctx, x, y, w, h, 3);
    ctx.fill();
  }

  // Mullion crossbars
  ctx.strokeStyle = '#6c4932';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h * 0.54);
  ctx.lineTo(x + w, y + h * 0.54);
  ctx.stroke();
  ctx.restore();
}

// =========================================================================
// 1. STARLIT FAIRYTALE VILLAGE BACKGROUND (Strictly matches IMG_8545.jpeg)
// =========================================================================
function drawNightVillageBg(ctx, W = 750, H = 1334) {
  // Deep twilight sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2a2f57');
  sky.addColorStop(0.32, '#3c4375');
  sky.addColorStop(0.68, '#464d80');
  sky.addColorStop(1, '#2b3059');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Subtle moonlight ambient glow behind center
  const moonGlow = ctx.createRadialGradient(W * 0.52, H * 0.25, 30, W * 0.52, H * 0.35, W * 0.72);
  moonGlow.addColorStop(0, 'rgba(130, 146, 224, 0.22)');
  moonGlow.addColorStop(1, 'rgba(42, 47, 87, 0)');
  ctx.fillStyle = moonGlow;
  ctx.fillRect(0, 0, W, H);

  // Stars & soft sparkles
  const stars = [
    [130, 74, 8, 0.7], [218, 46, 5, 0.55], [378, 126, 9, 0.75], [456, 84, 6, 0.6],
    [544, 218, 11, 0.9], [665, 194, 6, 0.55], [88, 182, 6, 0.5], [294, 178, 5, 0.5],
    [694, 52, 7, 0.6], [420, 210, 5, 0.45], [585, 112, 5, 0.45], [164, 216, 6, 0.5]
  ];
  for (const [sx, sy, sr, sa] of stars) drawStar4(ctx, sx, sy, sr, sa);

  const dots = [
    [62, 110, 2.2], [176, 124, 1.8], [262, 96, 2.4], [336, 64, 2.0], [492, 140, 2.1],
    [618, 152, 2.4], [712, 142, 2.0], [112, 240, 1.8], [648, 250, 2.0], [38, 60, 1.8]
  ];
  ctx.fillStyle = 'rgba(235, 240, 255, 0.48)';
  for (const [dx, dy, dr] of dots) {
    ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill();
  }

  // Far distant fairytale castle silhouettes (very soft)
  ctx.save();
  ctx.fillStyle = 'rgba(38, 43, 82, 0.62)';
  // Left distant spire
  ctx.beginPath();
  ctx.moveTo(0, 480); ctx.lineTo(0, 250); ctx.lineTo(28, 178); ctx.lineTo(56, 250);
  ctx.lineTo(56, 310); ctx.lineTo(92, 275); ctx.lineTo(132, 318); ctx.lineTo(132, 480);
  ctx.closePath(); ctx.fill();
  // Right distant roofs
  ctx.beginPath();
  ctx.moveTo(W, 560); ctx.lineTo(W, 255); ctx.lineTo(W - 42, 232); ctx.lineTo(W - 88, 286);
  ctx.lineTo(W - 122, 330); ctx.lineTo(W - 122, 560);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // Midground cozy storybook village towers & cottages peeking on LEFT edge
  ctx.save();
  ctx.fillStyle = '#363c6b';
  ctx.strokeStyle = '#25294c';
  ctx.lineWidth = 3;

  // Left tall turret tower (top-left)
  ctx.beginPath();
  ctx.rect(-6, 224, 62, 210);
  ctx.fill(); ctx.stroke();
  // Conical turret roof
  ctx.fillStyle = '#474e84';
  ctx.beginPath();
  ctx.moveTo(-14, 228); ctx.lineTo(25, 142); ctx.lineTo(66, 228);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // Flagpole
  ctx.strokeStyle = '#5c649e'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(25, 144); ctx.lineTo(25, 118); ctx.stroke();
  ctx.fillStyle = '#7078b5';
  ctx.beginPath(); ctx.moveTo(25, 120); ctx.lineTo(44, 127); ctx.lineTo(25, 134); ctx.closePath(); ctx.fill();

  // Left cozy cottage mid-left extending down behind bottom clouds
  ctx.fillStyle = '#333866';
  ctx.strokeStyle = '#23274a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.rect(-6, 360, 82, H - 350); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#464d82';
  ctx.beginPath(); ctx.moveTo(-14, 364); ctx.lineTo(35, 310); ctx.lineTo(86, 364); ctx.closePath(); ctx.fill(); ctx.stroke();

  // Lower-left cozy gable house peeking in foreground
  ctx.fillStyle = '#313662';
  ctx.beginPath(); ctx.rect(-4, 1088, 72, H - 1070); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#444b7e';
  ctx.beginPath(); ctx.moveTo(-10, 1090); ctx.lineTo(32, 1052); ctx.lineTo(74, 1090); ctx.closePath(); ctx.fill(); ctx.stroke();

  // RIGHT side fairytale roofs & tower extending down behind bottom clouds
  ctx.fillStyle = '#353b69';
  ctx.beginPath(); ctx.rect(W - 64, 290, 72, H - 280); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#474e84';
  ctx.beginPath(); ctx.moveTo(W - 76, 294); ctx.lineTo(W - 22, 220); ctx.lineTo(W + 14, 294); ctx.closePath(); ctx.fill(); ctx.stroke();

  // Lower-right cottage peeking in foreground
  ctx.fillStyle = '#323763';
  ctx.beginPath(); ctx.rect(W - 76, 1092, 82, H - 1070); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#444b7e';
  ctx.beginPath(); ctx.moveTo(W - 84, 1096); ctx.lineTo(W - 35, 1054); ctx.lineTo(W + 10, 1096); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  // Warm glowing storybook windows along left & right edges
  drawGlowingWindow(ctx, 13, 244, 24, 30, true);
  drawGlowingWindow(ctx, 2, 388, 22, 28, false);
  drawGlowingWindow(ctx, 34, 388, 22, 28, false);
  drawGlowingWindow(ctx, 12, 515, 22, 28, true);
  drawGlowingWindow(ctx, 16, 1118, 22, 26, false);

  drawGlowingWindow(ctx, W - 38, 345, 22, 28, true);
  drawGlowingWindow(ctx, W - 36, 442, 22, 28, false);
  drawGlowingWindow(ctx, W - 44, 1122, 24, 28, true);

  // Soft layered indigo-violet clouds along the bottom edge
  const backClouds = [
    [40, H - 52, 88], [148, H - 30, 82], [268, H - 18, 76], [385, H - 24, 80],
    [508, H - 20, 78], [626, H - 32, 86], [724, H - 56, 88]
  ];
  ctx.save();
  ctx.fillStyle = '#4a5082';
  for (const [cx, cy, cr] of backClouds) {
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillRect(0, H - 36, W, 40);

  const frontClouds = [
    [16, H - 16, 76], [116, H + 6, 72], [234, H + 12, 68], [358, H + 8, 70],
    [486, H + 12, 72], [608, H + 4, 76], [716, H - 18, 78]
  ];
  ctx.fillStyle = '#383d6b';
  for (const [cx, cy, cr] of frontClouds) {
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillRect(0, H - 14, W, 20);
  ctx.restore();
}

// =========================================================================
// 2. CARVED WOOD COMPONENTS & AWNING
// =========================================================================
function drawWoodTexture(ctx, x, y, w, h, r) {
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.strokeStyle = 'rgba(58, 28, 12, 0.14)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const gy = y + h * (0.22 + i * 0.21);
    ctx.beginPath();
    ctx.moveTo(x - 10, gy);
    ctx.bezierCurveTo(x + w * 0.3, gy - 6, x + w * 0.65, gy + 7, x + w + 10, gy - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHangingSign(ctx, x, y, w, h, text, angleDeg = -2.8) {
  ctx.save();
  // Vertical wooden hanger ropes from top of viewport
  const lx = x + w * 0.15;
  const rx = x + w * 0.85;
  const drawRope = (px, ringY) => {
    ctx.fillStyle = '#8b5431';
    ctx.strokeStyle = '#3c2010';
    ctx.lineWidth = 3;
    ctx.fillRect(px - 4.5, -10, 9, ringY + 12);
    ctx.strokeRect(px - 4.5, -10, 9, ringY + 12);
    // Golden brass ring
    ctx.strokeStyle = '#3c2010';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(px, ringY + 3, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#f5c767';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(px, ringY + 3, 9, 0, Math.PI * 2); ctx.stroke();
  };
  drawRope(lx, y + 7);
  drawRope(rx, y - 3);

  // Tilted carved wooden signboard
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  const bx = -w / 2;
  const by = -h / 2;

  // Drop shadow
  ctx.save();
  ctx.fillStyle = 'rgba(15, 16, 38, 0.42)';
  rr(ctx, bx + 4, by + 10, w, h, 16);
  ctx.fill();
  ctx.restore();

  // Outer 3D lip
  ctx.fillStyle = '#5a3118';
  rr(ctx, bx, by + 5, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = '#3b1f0e';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Main wood body
  const wg = ctx.createLinearGradient(0, by, 0, by + h);
  wg.addColorStop(0, '#ab693e');
  wg.addColorStop(0.55, '#8d532d');
  wg.addColorStop(1, '#754121');
  ctx.fillStyle = wg;
  rr(ctx, bx, by, w, h, 16);
  ctx.fill();
  drawWoodTexture(ctx, bx, by, w, h, 16);

  // Inner warm top highlight
  ctx.strokeStyle = 'rgba(255, 224, 178, 0.36)';
  ctx.lineWidth = 2.5;
  rr(ctx, bx + 3, by + 3, w - 6, h - 6, 13);
  ctx.stroke();

  // Crisp comic outline
  ctx.strokeStyle = '#3b1f0e';
  ctx.lineWidth = 3.5;
  rr(ctx, bx, by, w, h, 16);
  ctx.stroke();

  if (text) {
    ctx.font = '900 32px ' + FONT;
    strokeTextChunky(ctx, text, 0, 2, '#fff8eb', '#3b1f0e', 6.5);
  }
  ctx.restore();
}

function drawWoodCircleBtn(ctx, cx, cy, r, iconType, badgeText = '') {
  ctx.save();
  // Drop shadow
  ctx.fillStyle = 'rgba(14, 16, 38, 0.42)';
  ctx.beginPath(); ctx.arc(cx, cy + 7, r, 0, Math.PI * 2); ctx.fill();

  // 3D wood rim base
  ctx.fillStyle = '#5a3118';
  ctx.beginPath(); ctx.arc(cx, cy + 4, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a1e0e';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Main face gradient
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#b37043');
  g.addColorStop(0.55, '#8e532d');
  g.addColorStop(1, '#6f3e1e');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  // Inner beveled ring
  ctx.strokeStyle = 'rgba(255, 226, 182, 0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.stroke();

  // Outer outline
  ctx.strokeStyle = '#3a1e0e';
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  // Cream sculpted icons
  ctx.fillStyle = '#ffeed3';
  ctx.strokeStyle = '#472512';
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (iconType === 'help') {
    ctx.font = '900 ' + Math.round(r * 1.15) + 'px ' + FONT;
    strokeTextChunky(ctx, '?', cx, cy + 2, '#ffeed3', '#472512', 5);
  } else if (iconType === 'close') {
    const s = r * 0.36;
    ctx.lineWidth = 6.5; ctx.strokeStyle = '#472512';
    ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = '#ffeed3';
    ctx.stroke();
  } else if (iconType === 'sound' || iconType === 'mute') {
    const sc = r / 34;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.moveTo(-14, -6); ctx.lineTo(-6, -6); ctx.lineTo(4, -14);
    ctx.lineTo(4, 14); ctx.lineTo(-6, 6); ctx.lineTo(-14, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (iconType === 'sound') {
      ctx.strokeStyle = '#ffeed3'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.arc(6, 0, 7, -0.75, 0.75); ctx.stroke();
      ctx.beginPath(); ctx.arc(6, 0, 12.5, -0.82, 0.82); ctx.stroke();
    } else {
      ctx.strokeStyle = '#ff7066'; ctx.lineWidth = 3.8;
      ctx.beginPath(); ctx.moveTo(8, -6); ctx.lineTo(18, 6); ctx.moveTo(18, -6); ctx.lineTo(8, 6); ctx.stroke();
    }
    ctx.restore();
  } else if (iconType === 'gear') {
    const sc = r / 34;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.beginPath();
    const teeth = 8;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i * Math.PI) / teeth;
      const rad = i % 2 === 0 ? 15.5 : 11.2;
      const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8b512c';
    ctx.beginPath(); ctx.arc(0, 0, 5.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (iconType === 'trophy') {
    const sc = r / 34;
    ctx.save(); ctx.translate(cx, cy + 1); ctx.scale(sc, sc);
    ctx.fillStyle = '#ffd666';
    // Cup body
    ctx.beginPath();
    ctx.moveTo(-11, -13); ctx.lineTo(11, -13); ctx.lineTo(9, 1);
    ctx.quadraticCurveTo(0, 8, -9, 1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Handles
    ctx.strokeStyle = '#ffd666'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(-11, -7, 4.5, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(11, -7, 4.5, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    // Stem & base
    ctx.fillStyle = '#ffd666'; ctx.strokeStyle = '#472512'; ctx.lineWidth = 2.4;
    ctx.fillRect(-3, 5, 6, 6); ctx.strokeRect(-3, 5, 6, 6);
    rr(ctx, -9, 10, 18, 4.5, 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (iconType === 'palette') {
    const sc = r / 34;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.fillStyle = '#ffeed3';
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 13, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const spots = [[-7, -4, '#f26158'], [0, -7, '#ffd859'], [7, -3, '#68b7fa'], [6, 5, '#6bc470']];
    for (const [sx, sy, col] of spots) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#8b512c';
    ctx.beginPath(); ctx.arc(-5, 5, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (iconType === 'back') {
    const sc = r / 34;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.moveTo(-13, 0); ctx.lineTo(-1, -11); ctx.lineTo(-1, -4.5);
    ctx.lineTo(13, -4.5); ctx.lineTo(13, 4.5); ctx.lineTo(-1, 4.5); ctx.lineTo(-1, 11); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (iconType === 'share') {
    const sc = r / 34;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.strokeStyle = '#ffeed3'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, -8); ctx.moveTo(-7, 0); ctx.lineTo(7, 8); ctx.stroke();
    for (const [px, py] of [[-7, 0], [7, -8], [7, 8]]) {
      ctx.fillStyle = '#ffeed3'; ctx.beginPath(); ctx.arc(px, py, 4.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  if (badgeText) {
    ctx.font = 'bold 14px ' + FONT;
    strokeTextChunky(ctx, badgeText, cx, cy + r + 15, '#e8e2ff', '#25294c', 3.5);
  }
  ctx.restore();
}

function drawWoodPillBtn(ctx, x, y, w, h, label, opts = {}) {
  const { variant = 'wood', icon = null, redDot = false, disabled = false, fontSize = 27 } = opts;
  ctx.save();
  if (disabled) ctx.globalAlpha = 0.56;
  const r = h / 2;

  // Drop shadow
  ctx.fillStyle = 'rgba(14, 15, 38, 0.42)';
  rr(ctx, x, y + 7, w, h, r);
  ctx.fill();

  // Colors by variant: 'wood' (default), 'orange' (primary CTA / rescue), 'green' (confirm)
  const theme = variant === 'orange'
    ? { top: '#ffad42', mid: '#f08122', bot: '#cf5d10', lip: '#993e06', out: '#4a1f06', hi: 'rgba(255,244,205,0.45)' }
    : variant === 'green'
    ? { top: '#6cc97a', mid: '#4ca85a', bot: '#378743', lip: '#25612e', out: '#183d1e', hi: 'rgba(230,255,232,0.4)' }
    : { top: '#ae6c40', mid: '#8c522c', bot: '#6d3d1d', lip: '#512b13', out: '#3a1e0e', hi: 'rgba(255,224,180,0.34)' };

  // Bottom 3D lip
  ctx.fillStyle = theme.lip;
  rr(ctx, x, y + 4.5, w, h, r);
  ctx.fill();
  ctx.strokeStyle = theme.out;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Main pill body
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, theme.top);
  g.addColorStop(0.55, theme.mid);
  g.addColorStop(1, theme.bot);
  ctx.fillStyle = g;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
  if (variant === 'wood') drawWoodTexture(ctx, x, y, w, h, r);

  // Inner top rim highlight
  ctx.strokeStyle = theme.hi;
  ctx.lineWidth = 2.5;
  rr(ctx, x + 3.5, y + 3.5, w - 7, h - 7, r - 3.5);
  ctx.stroke();

  // Outer outline
  ctx.strokeStyle = theme.out;
  ctx.lineWidth = 3.5;
  rr(ctx, x, y, w, h, r);
  ctx.stroke();

  // Optional icon + text layout
  ctx.font = '900 ' + fontSize + 'px ' + FONT;
  const textW = ctx.measureText(label).width;
  const iconSpace = icon ? 38 : 0;
  const totalW = iconSpace + textW;
  const startX = x + (w - totalW) / 2;
  const cy = y + h / 2 + 1;

  if (icon === 'undo') {
    const ix = startX + 16;
    ctx.save();
    ctx.fillStyle = '#fff3dc'; ctx.strokeStyle = '#472512'; ctx.lineWidth = 2.8; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ix - 14, cy - 3); ctx.lineTo(ix - 1, cy - 14); ctx.lineTo(ix - 1, cy - 7);
    ctx.quadraticCurveTo(ix + 14, cy - 7, ix + 13, cy + 11);
    ctx.quadraticCurveTo(ix + 8, cy + 1, ix - 1, cy + 1);
    ctx.lineTo(ix - 1, cy + 8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (icon === 'bulb') {
    const ix = startX + 14;
    ctx.save();
    // Bulb glow
    ctx.fillStyle = '#ffe56b'; ctx.strokeStyle = '#5c3312'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(ix, cy - 5, 11.5, Math.PI * 0.72, Math.PI * 2.28);
    ctx.lineTo(ix + 6, cy + 8); ctx.lineTo(ix - 6, cy + 8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d98a4a';
    rr(ctx, ix - 5.5, cy + 8, 11, 7, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fffbe0';
    ctx.beginPath(); ctx.arc(ix - 3.5, cy - 8, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (icon === 'reset') {
    const ix = startX + 14;
    ctx.save();
    ctx.strokeStyle = '#472512'; ctx.lineWidth = 8.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(ix, cy + 1, 11, -0.5, Math.PI * 1.48); ctx.stroke();
    ctx.strokeStyle = '#fff0d6'; ctx.lineWidth = 4.6;
    ctx.beginPath(); ctx.arc(ix, cy + 1, 11, -0.5, Math.PI * 1.48); ctx.stroke();
    ctx.fillStyle = '#fff0d6'; ctx.strokeStyle = '#472512'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(ix + 1, cy - 15); ctx.lineTo(ix + 10, cy - 9); ctx.lineTo(ix + 1, cy - 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (icon === 'play') {
    const ix = startX + 14;
    ctx.save();
    ctx.fillStyle = '#fff8e8'; ctx.strokeStyle = '#4a1f06'; ctx.lineWidth = 2.6; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(ix - 7, cy - 10); ctx.lineTo(ix + 10, cy); ctx.lineTo(ix - 7, cy + 10); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (icon === 'star') {
    const ix = startX + 14;
    ctx.font = '900 24px ' + FONT;
    strokeTextChunky(ctx, '★', ix, cy, '#ffe16b', '#472512', 4);
  }

  strokeTextChunky(ctx, label, startX + iconSpace + textW / 2, cy, '#fffaf0', theme.out, 5.5);

  // Glossy red notification dot (just like "提示 3" in IMG_8545.jpeg)
  if (redDot) {
    const rx = x + w - 16;
    const ry = y + 4;
    ctx.fillStyle = '#fff7e8';
    ctx.beginPath(); ctx.arc(rx, ry, 13.5, 0, Math.PI * 2); ctx.fill();
    const rg = ctx.createRadialGradient(rx - 3, ry - 4, 2, rx, ry, 11);
    rg.addColorStop(0, '#ff7b6b');
    rg.addColorStop(1, '#d92820');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(rx, ry, 10.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawScallopedAwning(ctx, x, y, w, h, count = 11) {
  ctx.save();
  const sw = w / count;
  // Soft shadow cast onto board below awning
  ctx.fillStyle = 'rgba(42, 22, 10, 0.24)';
  for (let i = 0; i < count; i++) {
    const sx = x + i * sw;
    ctx.beginPath();
    ctx.arc(sx + sw / 2, y + h - sw * 0.28 + 8, sw * 0.5, 0, Math.PI);
    ctx.fill();
  }

  for (let i = 0; i < count; i++) {
    const sx = x + i * sw;
    const isRed = i % 2 === 0;
    const g = ctx.createLinearGradient(sx, y, sx, y + h);
    if (isRed) {
      g.addColorStop(0, '#d15043');
      g.addColorStop(0.7, '#ba3d32');
      g.addColorStop(1, '#962b22');
    } else {
      g.addColorStop(0, '#faead0');
      g.addColorStop(0.7, '#eed5b0');
      g.addColorStop(1, '#cfa97a');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx, y + 6);
    ctx.lineTo(sx + sw, y + 6);
    ctx.lineTo(sx + sw, y + h - sw * 0.42);
    ctx.arc(sx + sw / 2, y + h - sw * 0.42, sw / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();

    // Subtle top sheen
    ctx.fillStyle = isRed ? 'rgba(255, 200, 185, 0.2)' : 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(sx + 4, y + 8, sw - 8, 9);

    ctx.strokeStyle = '#472414';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }
  ctx.restore();
}

function drawAwningWoodFrame(ctx, x, y, w, h, innerBg = '#a7b687', awningCount = 11) {
  ctx.save();
  // Soft outer drop shadow
  ctx.fillStyle = 'rgba(12, 14, 34, 0.48)';
  rr(ctx, x + 2, y + 12, w, h, 38);
  ctx.fill();

  // Outer carved wooden frame 3D bottom lip
  ctx.fillStyle = '#5a3118';
  rr(ctx, x, y + 7, w, h, 36);
  ctx.fill();
  ctx.strokeStyle = '#3a1e0e';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Main wooden frame body
  const fg = ctx.createLinearGradient(x, y, x, y + h);
  fg.addColorStop(0, '#a8673d');
  fg.addColorStop(0.5, '#8b512c');
  fg.addColorStop(1, '#714020');
  ctx.fillStyle = fg;
  rr(ctx, x, y, w, h, 36);
  ctx.fill();
  drawWoodTexture(ctx, x, y, w, h, 36);

  // Outer bevel highlight
  ctx.strokeStyle = 'rgba(255, 224, 178, 0.34)';
  ctx.lineWidth = 3;
  rr(ctx, x + 4, y + 4, w - 8, h - 8, 32);
  ctx.stroke();

  // Inner recessed wood bevel
  const pad = 22;
  ctx.fillStyle = '#60351a';
  rr(ctx, x + pad - 5, y + pad - 5, w - (pad - 5) * 2, h - (pad - 5) * 2, 22);
  ctx.fill();

  // Inner surface (olive-sage felt OR warm parchment)
  ctx.fillStyle = innerBg;
  rr(ctx, x + pad, y + pad, w - pad * 2, h - pad * 2, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(42, 26, 12, 0.28)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Outer frame comic outline
  ctx.strokeStyle = '#3a1e0e';
  ctx.lineWidth = 4;
  rr(ctx, x, y, w, h, 36);
  ctx.stroke();

  // Red & cream scalloped awning along top edge!
  const awnW = w - 62;
  drawScallopedAwning(ctx, x + 31, y - 14, awnW, 66, awningCount);
  ctx.restore();
}

// =========================================================================
// 3. CHUNKY TOY DOMINOES & PIXEL TILES (Strictly matches IMG_8545.jpeg)
// =========================================================================
function drawPixelTile3D(ctx, x, y, size, colorCode) {
  const p = PAL[colorCode] || PAL.O;
  const r = Math.max(8, size * 0.22);
  const lip = Math.max(4, size * 0.11);
  ctx.save();
  // Drop shadow
  ctx.fillStyle = 'rgba(45, 58, 28, 0.28)';
  rr(ctx, x + 1, y + 4, size, size, r);
  ctx.fill();

  // 3D bottom lip
  ctx.fillStyle = p.lip;
  rr(ctx, x, y, size, size, r);
  ctx.fill();

  // Top face
  const g = ctx.createLinearGradient(x, y, x, y + size - lip);
  g.addColorStop(0, p.top);
  g.addColorStop(1, p.bot);
  ctx.fillStyle = g;
  rr(ctx, x, y, size, size - lip * 0.62, r);
  ctx.fill();

  // Glossy top cushion highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  rr(ctx, x + size * 0.12, y + size * 0.08, size * 0.76, size * 0.18, r * 0.5);
  ctx.fill();

  // Crisp comic outline
  ctx.strokeStyle = p.out;
  ctx.lineWidth = Math.max(2, size * 0.036);
  rr(ctx, x + 1, y + 1, size - 2, size - 2, r);
  ctx.stroke();
  ctx.restore();
}

function drawDomino3D(ctx, x, y, size, type) {
  const r = Math.max(9, size * 0.22);
  const lip = Math.max(5, size * 0.13);
  const isTurn = type === '^' || type === '>' || type === 'v' || type === '<';
  const isSplit = type === '+';

  const st = isTurn
    ? { top: '#bde2ff', bot: '#8ec4fb', lip: '#649ee3', out: '#3c629c' }
    : isSplit
    ? { top: '#ffad47', bot: '#f28222', lip: '#c75d0c', out: '#7d3607' }
    : { top: '#fff2df', bot: '#f7dec0', lip: '#dfb98e', out: '#7c4e2c' };

  ctx.save();
  // Soft shadow onto sage cell
  ctx.fillStyle = 'rgba(42, 55, 26, 0.34)';
  rr(ctx, x + 1, y + 5, size, size, r);
  ctx.fill();

  // 3D standing block base
  ctx.fillStyle = st.lip;
  rr(ctx, x, y, size, size, r);
  ctx.fill();

  // Top cushioned surface
  const g = ctx.createLinearGradient(x, y, x, y + size - lip);
  g.addColorStop(0, st.top);
  g.addColorStop(1, st.bot);
  ctx.fillStyle = g;
  rr(ctx, x, y, size, size - lip * 0.65, r);
  ctx.fill();

  // Soft glossy highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.44)';
  rr(ctx, x + size * 0.12, y + size * 0.07, size * 0.76, size * 0.16, r * 0.5);
  ctx.fill();

  // Crisp outline
  ctx.strokeStyle = st.out;
  ctx.lineWidth = Math.max(2.2, size * 0.038);
  rr(ctx, x + 1, y + 1, size - 2, size - 2, r);
  ctx.stroke();

  const cx = x + size / 2;
  const cy = y + (size - lip * 0.55) / 2;

  if (type === '.') {
    // Two vertical warm chocolate pips
    const pr = size * 0.088;
    const off = size * 0.175;
    for (const dy of [-off, off]) {
      ctx.fillStyle = '#744627';
      ctx.beginPath(); ctx.arc(cx, cy + dy, pr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255, 232, 200, 0.35)';
      ctx.beginPath(); ctx.arc(cx - pr * 0.25, cy + dy - pr * 0.25, pr * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  } else if (isTurn) {
    const ang = type === '>' ? 0 : type === 'v' ? Math.PI / 2 : type === '<' ? Math.PI : -Math.PI / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const s = size * 0.26;
    ctx.fillStyle = '#4e7cc0';
    ctx.strokeStyle = '#294878';
    ctx.lineWidth = Math.max(2.2, size * 0.036);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.42);
    ctx.lineTo(s * 0.05, -s * 0.42);
    ctx.lineTo(s * 0.05, -s * 0.92);
    ctx.lineTo(s * 1.02, 0);
    ctx.lineTo(s * 0.05, s * 0.92);
    ctx.lineTo(s * 0.05, s * 0.42);
    ctx.lineTo(-s, s * 0.42);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (isSplit) {
    // Crisp 4-way orange split arrows strictly matching gameplay semantics
    const arm = size * 0.30;
    const head = size * 0.105;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#6e2d06';
    ctx.lineWidth = Math.max(5.5, size * 0.095);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-arm + head * 0.5, 0); ctx.lineTo(arm - head * 0.5, 0);
    ctx.moveTo(0, -arm + head * 0.5); ctx.lineTo(0, arm - head * 0.5);
    ctx.stroke();

    ctx.strokeStyle = '#fff5e0';
    ctx.lineWidth = Math.max(3, size * 0.052);
    ctx.stroke();

    ctx.fillStyle = '#fff5e0';
    ctx.strokeStyle = '#6e2d06';
    ctx.lineWidth = Math.max(1.8, size * 0.028);
    ctx.lineJoin = 'round';
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      ctx.beginPath();
      ctx.moveTo(dx * (arm + 2), dy * (arm + 2));
      ctx.lineTo(dx * (arm - head * 1.35) - dy * head, dy * (arm - head * 1.35) + dx * head);
      ctx.lineTo(dx * (arm - head * 1.35) + dy * head, dy * (arm - head * 1.35) - dx * head);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawPushTokens(ctx, rightX, cy, limit, used) {
  const s = 34;
  const gap = 10;
  const totalW = limit * s + (limit - 1) * gap;
  const sx = rightX - totalW;
  ctx.font = '900 28px ' + FONT;
  strokeTextChunky(ctx, '推力', sx - 16, cy + 1, '#fff6e6', '#2b2042', 5.5, 'right');

  for (let i = 0; i < limit; i++) {
    const tx = sx + i * (s + gap);
    const ty = cy - s / 2;
    const spent = i < used;
    ctx.save();
    ctx.fillStyle = spent ? '#6a82a3' : '#d9b58a';
    rr(ctx, tx, ty + 3, s, s, 8); ctx.fill();
    const g = ctx.createLinearGradient(tx, ty, tx, ty + s);
    if (spent) {
      g.addColorStop(0, '#96adc9'); g.addColorStop(1, '#7c96b8');
    } else {
      g.addColorStop(0, '#fff2db'); g.addColorStop(1, '#f0d3ab');
    }
    ctx.fillStyle = g;
    rr(ctx, tx, ty, s, s - 2, 8); ctx.fill();
    ctx.strokeStyle = spent ? '#445875' : '#734627';
    ctx.lineWidth = 2.6;
    rr(ctx, tx, ty, s, s, 8); ctx.stroke();
    ctx.restore();
  }
}

function drawMiniPixelArt(ctx, lvDef, x, y, w, h) {
  const H = lvDef.art.length;
  const W = lvDef.art[0].length;
  const cs = Math.floor(Math.min(w / W, h / H));
  const ox = x + (w - cs * W) / 2;
  const oy = y + (h - cs * H) / 2;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = lvDef.art[r][c];
      if (!ch || ch === '.') continue;
      const p = PAL[ch] || PAL.O;
      ctx.fillStyle = p.top;
      rr(ctx, ox + c * cs + 0.5, oy + r * cs + 0.5, Math.max(2, cs - 1.2), Math.max(2, cs - 1.2), Math.max(1.5, cs * 0.18));
      ctx.fill();
    }
  }
}

function drawComplianceFooter(ctx, W = 750, H = 1334) {
  const fy = H - 46;
  ctx.save();
  ctx.fillStyle = '#4fb866';
  ctx.strokeStyle = '#1e572b';
  ctx.lineWidth = 2.4;
  rr(ctx, 28, fy, 46, 26, 6);
  ctx.fill(); ctx.stroke();
  ctx.font = '900 17px ' + FONT;
  strokeTextChunky(ctx, '8+', 51, fy + 14, '#ffffff', '#1e572b', 2.5);

  ctx.font = 'bold 18px ' + FONT;
  strokeTextChunky(ctx, 'v1.0.0 · 健康游戏忠告', 86, fy + 14, '#d9dcf5', '#22264a', 3.5, 'left');
  ctx.restore();
}

function drawGameBoard(ctx, lvDef, fallenArr, boardX, boardY, boardW, boardH, opts = {}) {
  drawAwningWoodFrame(ctx, boardX, boardY, boardW, boardH, '#a7b687', 11);

  const H = lvDef.art.length;
  const W = lvDef.art[0].length;
  const padX = 40;
  const padTop = 62;
  const padBot = 36;
  const availW = boardW - padX * 2;
  const availH = boardH - padTop - padBot;
  const gap = 8;
  const cs = Math.floor(Math.min((availW - (W - 1) * gap) / W, (availH - (H - 1) * gap) / H));
  const gridW = W * cs + (W - 1) * gap;
  const gridH = H * cs + (H - 1) * gap;
  const gx = boardX + (boardW - gridW) / 2;
  const gy = boardY + padTop + (availH - gridH) / 2;

  // Recessed sage tile slots (like IMG_8545.jpeg)
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const cx = gx + c * (cs + gap);
      const cy = gy + r * (cs + gap);
      ctx.fillStyle = '#93a374';
      rr(ctx, cx, cy, cs, cs, Math.max(7, cs * 0.2));
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 240, 0.16)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Draw dominoes & fallen pixel tiles
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = lvDef.art[r][c];
      if (!ch || ch === '.') continue;
      const idx = r * W + c;
      const cx = gx + c * (cs + gap);
      const cy = gy + r * (cs + gap);
      if (fallenArr[idx]) {
        drawPixelTile3D(ctx, cx, cy, cs, ch);
      } else {
        const tp = lvDef.types[r][c];
        drawDomino3D(ctx, cx, cy, cs, tp);
      }
    }
  }

  // Optional swipe guide highlight on active domino
  if (opts.highlightCell) {
    const [hr, hc, hdir] = opts.highlightCell;
    const cx = gx + hc * (cs + gap);
    const cy = gy + hr * (cs + gap);
    ctx.save();
    ctx.strokeStyle = '#ffe052';
    ctx.lineWidth = 5;
    ctx.shadowColor = '#ffbe26';
    ctx.shadowBlur = 14;
    rr(ctx, cx - 3, cy - 3, cs + 6, cs + 6, 15);
    ctx.stroke();
    // Yellow swipe indicator pill
    const dx = hdir === '>' ? 1 : hdir === '<' ? -1 : 0;
    const dy = hdir === 'v' ? 1 : hdir === '^' ? -1 : 0;
    const px = cx + cs / 2 + dx * cs * 0.42;
    const py = cy + cs / 2 + dy * cs * 0.42;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd645';
    ctx.strokeStyle = '#4a2610';
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(px, py, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '900 20px ' + FONT;
    strokeTextChunky(ctx, '滑', px, py + 1, '#4a2610', '', 0);
    ctx.restore();
  }

  // Optional festive confetti sparkles for Win screen
  if (opts.confetti) {
    const cols = ['#ffd859', '#ff8fb5', '#68b7fa', '#6bc470', '#ffa03b', '#fff5d6'];
    const pts = [
      [85, 80, 14], [190, 52, 11], [595, 76, 15], [648, 162, 12], [68, 224, 10],
      [626, 610, 14], [92, 640, 12], [320, 66, 9], [462, 58, 11], [660, 420, 10]
    ];
    pts.forEach(([px, py, pr], i) => {
      drawStar4(ctx, boardX + px, boardY + py, pr, 0.95, cols[i % cols.length]);
    });
  }
}

// =========================================================================
// 4. ALL 10 ACTUAL UI DESIGN SCREENS (750 x 1334)
// =========================================================================

// SCREEN 01: Splash / Health Game Advice Screen
function renderScreen01_Splash(ctx) {
  drawNightVillageBg(ctx);

  // Center grand hanging wooden emblem plaque
  drawHangingSign(ctx, 135, 190, 480, 150, '', -1.5);
  ctx.save();
  ctx.translate(375, 265);
  ctx.rotate((-1.5 * Math.PI) / 180);
  ctx.font = '900 62px ' + FONT;
  strokeTextChunky(ctx, '推倒一幅画', 0, -10, '#fff7e6', '#3a1e0e', 10);
  ctx.font = 'bold 22px ' + FONT;
  strokeTextChunky(ctx, '单指多米诺 · 连锁像素画', 0, 38, '#ffdca3', '#3a1e0e', 5);
  ctx.restore();

  // Mini showcase board icon in center (Flower pixel art)
  drawAwningWoodFrame(ctx, 205, 405, 340, 340, '#a7b687', 7);
  drawMiniPixelArt(ctx, DATA.levels[0], 255, 478, 240, 224);
  drawStar4(ctx, 185, 430, 14, 0.95, '#ffe37a');
  drawStar4(ctx, 565, 452, 16, 0.95, '#ff9ec2');
  drawStar4(ctx, 545, 720, 12, 0.9, '#8fd0ff');

  // Carved wooden loading progress bar
  const barX = 125, barY = 796, barW = 500, barH = 38;
  ctx.save();
  ctx.fillStyle = '#4f2a13';
  ctx.strokeStyle = '#361b0b';
  ctx.lineWidth = 3.5;
  rr(ctx, barX, barY, barW, barH, 19); ctx.fill(); ctx.stroke();
  const pg = ctx.createLinearGradient(barX, barY, barX + barW * 0.78, barY);
  pg.addColorStop(0, '#ffb84d'); pg.addColorStop(1, '#ff7b29');
  ctx.fillStyle = pg;
  rr(ctx, barX + 5, barY + 5, (barW - 10) * 0.78, barH - 10, 14); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  rr(ctx, barX + 12, barY + 8, (barW - 24) * 0.76, 8, 4); ctx.fill();
  ctx.restore();
  ctx.font = 'bold 21px ' + FONT;
  strokeTextChunky(ctx, '正在摆放骨牌与颜料... 78%', 375, barY + 62, '#e4e7ff', '#25294c', 4.5);

  // Wooden parchment card: Full 32-word Health Game Advice + CADPA 8+ (C01 Compliance)
  const cx = 64, cy = 916, cw = 622, ch = 304;
  ctx.save();
  ctx.fillStyle = 'rgba(15, 16, 38, 0.45)';
  rr(ctx, cx, cy + 8, cw, ch, 26); ctx.fill();
  ctx.fillStyle = '#8b512c';
  ctx.strokeStyle = '#3a1e0e'; ctx.lineWidth = 4;
  rr(ctx, cx, cy, cw, ch, 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#faf0dc';
  rr(ctx, cx + 14, cy + 14, cw - 28, ch - 28, 18); ctx.fill();
  ctx.strokeStyle = '#c8a97e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();

  // CADPA 8+ pill inside top-left of card
  ctx.save();
  ctx.fillStyle = '#4fb866'; ctx.strokeStyle = '#1e572b'; ctx.lineWidth = 2.5;
  rr(ctx, cx + 32, cy + 32, 62, 34, 8); ctx.fill(); ctx.stroke();
  ctx.font = '900 22px ' + FONT;
  strokeTextChunky(ctx, '8+', cx + 63, cy + 50, '#ffffff', '#1e572b', 3);
  ctx.font = '900 24px ' + FONT;
  ctx.fillStyle = '#4a2b17'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('健康游戏忠告 · 适龄提示 CADPA 8+', cx + 108, cy + 50);

  ctx.fillStyle = '#5e402a';
  ctx.font = 'bold 24px ' + FONT;
  ctx.textAlign = 'center';
  const lines = [
    '抵制不良游戏，拒绝盗版游戏。',
    '注意自我保护，谨防受骗上当。',
    '适度游戏益脑，沉迷游戏伤身。',
    '合理安排时间，享受健康生活。'
  ];
  lines.forEach((t, i) => ctx.fillText(t, 375, cy + 114 + i * 44));
  ctx.restore();

  ctx.font = 'bold 18px ' + FONT;
  strokeTextChunky(ctx, 'v1.0.0 · 原创单机休闲益智小游戏', 375, 1272, '#c8cdf0', '#23274a', 3.5);
}

// SCREEN 02 & 03: Level Select Home Screen (0/20 initial OR 5/20 progress)
function renderScreen_LevelSelect(ctx, clearedCount) {
  drawNightVillageBg(ctx);

  // Top hanging wooden sign + round wood icon buttons (capsule-safe right clearance)
  drawHangingSign(ctx, 28, 56, 266, 76, '选关画廊', -2.4);
  drawWoodCircleBtn(ctx, 412, 82, 34, 'trophy', '排行');
  drawWoodCircleBtn(ctx, 496, 82, 34, 'palette', '皮肤');
  drawWoodCircleBtn(ctx, 580, 82, 34, 'sound', '音效');
  drawWoodCircleBtn(ctx, 664, 82, 34, 'gear', '设置');

  // Wooden Progress & Quick-Start Banner
  const bx = 30, by = 152, bw = 690, bh = 104;
  ctx.save();
  ctx.fillStyle = 'rgba(14, 15, 36, 0.44)';
  rr(ctx, bx, by + 7, bw, bh, 24); ctx.fill();
  ctx.fillStyle = '#5b3218';
  rr(ctx, bx, by + 5, bw, bh, 24); ctx.fill();
  const bg = ctx.createLinearGradient(0, by, 0, by + bh);
  bg.addColorStop(0, '#a6663c'); bg.addColorStop(1, '#794524');
  ctx.fillStyle = bg;
  rr(ctx, bx, by, bw, bh, 24); ctx.fill();
  drawWoodTexture(ctx, bx, by, bw, bh, 24);
  ctx.strokeStyle = '#3a1e0e'; ctx.lineWidth = 3.5;
  rr(ctx, bx, by, bw, bh, 24); ctx.stroke();
  ctx.restore();

  const gold = clearedCount;
  const bestChain = clearedCount >= 5 ? 44 : 0;
  const rank = clearedCount >= 5 ? 8 : 11;
  const nextLv = Math.min(20, clearedCount + 1);

  ctx.font = '900 26px ' + FONT;
  strokeTextChunky(ctx, '已完成 ' + clearedCount + ' / 20 幅画', bx + 26, by + 36, '#fff8eb', '#3b1f0e', 5, 'left');
  ctx.font = 'bold 20px ' + FONT;
  strokeTextChunky(ctx, '★ ' + gold + ' 枚金框 · 最高连 ×' + bestChain + ' · 排行第' + rank + '名', bx + 26, by + 72, '#ffe0a8', '#3b1f0e', 4, 'left');

  drawWoodPillBtn(
    ctx, bx + bw - 216, by + 18, 196, 66,
    clearedCount === 0 ? '开始第1关' : '继续第' + nextLv + '关',
    { variant: 'orange', fontSize: 24 }
  );

  // Big Scalloped-Awning Wooden Gallery Frame (4 x 5 = 20 real level cards)
  const gx = 30, gy = 282, gw = 690, gh = 864;
  drawAwningWoodFrame(ctx, gx, gy, gw, gh, '#a3b384', 11);

  const cols = 4, rows = 5;
  const padX = 34, padTop = 64, padBot = 30, gap = 14;
  const cw = (gw - padX * 2 - (cols - 1) * gap) / cols;
  const ch = (gh - padTop - padBot - (rows - 1) * gap) / rows;

  for (let idx = 0; idx < 20; idx++) {
    const lv = DATA.levels[idx];
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = gx + padX + col * (cw + gap);
    const y = gy + padTop + row * (ch + gap);

    const passed = lv.levelId <= clearedCount;
    const unlocked = lv.levelId <= nextLv;
    const isNext = !passed && lv.levelId === nextLv;
    const numTag = String(lv.levelId).padStart(2, '0');

    ctx.save();
    // Card drop shadow
    ctx.fillStyle = 'rgba(42, 54, 24, 0.28)';
    rr(ctx, x + 1, y + 4, cw, ch, 18); ctx.fill();

    // Card surface
    ctx.fillStyle = passed ? '#fffaf0' : (isNext ? '#fff3dc' : '#eae0cd');
    rr(ctx, x, y, cw, ch, 18); ctx.fill();

    // Card border (Gold perfect frame / Bright orange playable / Soft brown)
    ctx.strokeStyle = passed ? '#f2b705' : (isNext ? '#ff8e24' : '#85603e');
    ctx.lineWidth = passed || isNext ? 4 : 2.5;
    rr(ctx, x + 1, y + 1, cw - 2, ch - 2, 17); ctx.stroke();

    if (passed) {
      // Cleared level: shows COMPLETED colorful pixel painting on sage felt + gold star + name
      ctx.fillStyle = '#97ab78';
      rr(ctx, x + 10, y + 10, cw - 20, ch - 42, 12); ctx.fill();
      drawMiniPixelArt(ctx, lv, x + 16, y + 16, cw - 32, ch - 54);

      // Top-left level badge
      ctx.fillStyle = 'rgba(59, 31, 14, 0.78)';
      rr(ctx, x + 12, y + 12, 34, 22, 7); ctx.fill();
      ctx.font = '900 14px ' + FONT;
      strokeTextChunky(ctx, numTag, x + 29, y + 23.5, '#fff8eb', '', 0);

      // Top-right golden star
      ctx.font = '900 22px ' + FONT;
      strokeTextChunky(ctx, '★', x + cw - 20, y + 23, '#ffd43b', '#754705', 3.5);

      // Completed painting name
      ctx.font = '900 20px ' + FONT;
      ctx.fillStyle = '#4a2c16'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(lv.name, x + cw / 2, y + ch - 7);
    } else {
      // Uncleared level: clearly shows "待完成"
      ctx.fillStyle = isNext ? '#d96610' : '#82674d';
      ctx.font = '900 16px ' + FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(numTag, x + 12, y + 10);

      if (isNext) {
        // Ready-to-push mini standing domino
        drawDomino3D(ctx, x + cw / 2 - 20, y + 26, 40, '.');
      } else {
        // Soft dashed mystery canvas frame
        ctx.save();
        ctx.strokeStyle = 'rgba(125, 95, 65, 0.48)';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([6, 4]);
        rr(ctx, x + cw / 2 - 26, y + 28, 52, 36, 8);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(125, 95, 65, 0.55)';
        ctx.font = '900 22px ' + FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', x + cw / 2, y + 47);
      }

      // Prominent "待完成" badge
      const pw = 88, ph = 28;
      const px = x + (cw - pw) / 2;
      const py = y + ch - 62;
      ctx.fillStyle = isNext ? '#ff8e24' : 'rgba(133, 96, 62, 0.22)';
      rr(ctx, px, py, pw, ph, 14); ctx.fill();
      if (isNext) {
        ctx.strokeStyle = '#8f3f0c'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.font = '900 17px ' + FONT;
      ctx.fillStyle = isNext ? '#fffaf0' : '#6e5239';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('待完成', x + cw / 2, py + ph / 2 + 1);

      ctx.fillStyle = isNext ? '#6b3b18' : '#82674d';
      ctx.font = 'bold 18px ' + FONT;
      ctx.textBaseline = 'bottom';
      ctx.fillText('第' + lv.levelId + '关', x + cw / 2, y + ch - 7);
    }
    ctx.restore();
  }

  // Bottom carved wooden dual buttons: Leaderboard & 20-Art Collage
  drawWoodPillBtn(ctx, 30, 1172, 332, 76, '排行榜 · 第' + rank + '名', { variant: 'wood', icon: 'star', fontSize: 25 });
  drawWoodPillBtn(ctx, 388, 1172, 332, 76, '全家福海报 (' + clearedCount + '/20)', { variant: 'wood', disabled: true, fontSize: 23 });

  drawComplianceFooter(ctx);
}

// SCREEN 04: Gameplay Active (Strictly matching IMG_8545.jpeg & real Level 4 小猫 data!)
function renderScreen04_Gameplay(ctx) {
  drawNightVillageBg(ctx);

  // Top-left back-to-select pill + hanging wooden level sign
  drawWoodCircleBtn(ctx, 56, 78, 30, 'back');
  drawHangingSign(ctx, 104, 68, 286, 80, '第 4 关 · ??', -3.0);

  // Top-right round wooden icons (matching IMG_8545.jpeg) + push counter tokens
  drawWoodCircleBtn(ctx, 496, 72, 34, 'trophy');
  drawWoodCircleBtn(ctx, 586, 72, 34, 'palette');
  drawWoodCircleBtn(ctx, 676, 72, 34, 'sound');
  drawPushTokens(ctx, 710, 152, 3, 1);

  // Central Scalloped-Awning Wood Frame with REAL Level 4 (小猫) after Push 1!
  drawGameBoard(ctx, DATA.levels[3], DATA.lv4MidFallen, 26, 240, 698, 796, {
    highlightCell: [1, 6, 'v']
  });

  // Bottom 3 carved wooden pill buttons (Undo / Hint 3 with red dot / Reset)
  const by = 1100, bh = 88, gap = 22;
  const bw = (750 - 52 - gap * 2) / 3;
  drawWoodPillBtn(ctx, 26, by, bw, bh, '撤销', { icon: 'undo', fontSize: 28 });
  drawWoodPillBtn(ctx, 26 + bw + gap, by, bw, bh, '提示 3', { icon: 'bulb', redDot: true, fontSize: 28 });
  drawWoodPillBtn(ctx, 26 + (bw + gap) * 2, by, bw, bh, '重摆', { icon: 'reset', fontSize: 28 });

  // One-line subtle gameplay tip
  ctx.font = 'bold 20px ' + FONT;
  strokeTextChunky(ctx, '已倒骨牌会挡住后续连锁 · 撤销永久免费', 375, 1228, '#d4d8f8', '#22264a', 3.5);

  drawComplianceFooter(ctx);
}

// SCREEN 05: Victory Inline Panel (Non-occluding below completed glowing Level 4 Cat art!)
function renderScreen05_Win(ctx) {
  drawNightVillageBg(ctx);

  drawWoodCircleBtn(ctx, 56, 78, 30, 'back');
  drawHangingSign(ctx, 104, 68, 286, 80, '第 4 关 · 小猫', -3.0);
  drawWoodCircleBtn(ctx, 496, 72, 34, 'trophy');
  drawWoodCircleBtn(ctx, 586, 72, 34, 'palette');
  drawWoodCircleBtn(ctx, 676, 72, 34, 'sound');
  drawPushTokens(ctx, 710, 152, 3, 3);

  // Completed glowing Level 4 Cat pixel art — 100% unobstructed!
  drawGameBoard(ctx, DATA.levels[3], DATA.lv4WinFallen, 26, 218, 698, 742, { confetti: true });

  // Non-occluding Carved Wood Victory Panel directly below the board
  const px = 26, py = 986, pw = 698, ph = 266;
  ctx.save();
  ctx.fillStyle = 'rgba(14, 15, 36, 0.5)';
  rr(ctx, px, py + 10, pw, ph, 28); ctx.fill();
  ctx.fillStyle = '#5a3118';
  rr(ctx, px, py + 6, pw, ph, 28); ctx.fill();
  const pg = ctx.createLinearGradient(0, py, 0, py + ph);
  pg.addColorStop(0, '#a8673d'); pg.addColorStop(1, '#754120');
  ctx.fillStyle = pg;
  rr(ctx, px, py, pw, ph, 28); ctx.fill();
  drawWoodTexture(ctx, px, py, pw, ph, 28);
  ctx.strokeStyle = '#3a1e0e'; ctx.lineWidth = 4;
  rr(ctx, px, py, pw, ph, 28); ctx.stroke();
  // Warm parchment inner top section
  ctx.fillStyle = '#fcf2df';
  rr(ctx, px + 16, py + 16, pw - 32, 134, 18); ctx.fill();
  ctx.strokeStyle = '#d4b283'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();

  // Small share circle button in top-right of win card
  drawWoodCircleBtn(ctx, px + pw - 56, py + 62, 28, 'share');

  ctx.font = 'bold 21px ' + FONT;
  ctx.fillStyle = '#9c6b3b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('全部推倒！点亮新画作', 375, py + 44);
  ctx.font = '900 40px ' + FONT;
  strokeTextChunky(ctx, '小猫', 375, py + 88, '#4a2b17', '#ffe29e', 2);
  ctx.font = 'bold 21px ' + FONT;
  ctx.fillStyle = '#7a5230'; ctx.textAlign = 'center';
  ctx.fillText('3 推推倒 48 块 · 最长连锁 ×20 · ★ 完美金框', 375, py + 128);

  // 3 Wooden action pills: 选关 | 重玩 | 下一关 →
  const by = py + 168, bh = 78, gap = 14;
  drawWoodPillBtn(ctx, px + 18, by, 142, bh, '选关', { fontSize: 25 });
  drawWoodPillBtn(ctx, px + 18 + 142 + gap, by, 152, bh, '重玩', { fontSize: 25 });
  drawWoodPillBtn(ctx, px + 18 + 142 + 152 + gap * 2, by, pw - 36 - 294 - gap * 2, bh, '下一关 →', { variant: 'orange', fontSize: 27 });

  drawComplianceFooter(ctx);
}

// SCREEN 06: Fail / Rescue Inline Panel
function renderScreen06_Fail(ctx) {
  drawNightVillageBg(ctx);

  drawWoodCircleBtn(ctx, 56, 78, 30, 'back');
  drawHangingSign(ctx, 104, 68, 286, 80, '第 4 关 · ??', -3.0);
  drawWoodCircleBtn(ctx, 496, 72, 34, 'trophy');
  drawWoodCircleBtn(ctx, 586, 72, 34, 'palette');
  drawWoodCircleBtn(ctx, 676, 72, 34, 'sound');
  drawPushTokens(ctx, 710, 152, 3, 3);

  // Board with remaining standing dominoes visible
  drawGameBoard(ctx, DATA.levels[3], DATA.lv4FailFallen, 26, 218, 698, 742);

  // Non-occluding Carved Wood Rescue Panel directly below board
  const px = 26, py = 986, pw = 698, ph = 262;
  ctx.save();
  ctx.fillStyle = 'rgba(14, 15, 36, 0.5)';
  rr(ctx, px, py + 10, pw, ph, 28); ctx.fill();
  ctx.fillStyle = '#5a3118';
  rr(ctx, px, py + 6, pw, ph, 28); ctx.fill();
  const pg = ctx.createLinearGradient(0, py, 0, py + ph);
  pg.addColorStop(0, '#a8673d'); pg.addColorStop(1, '#754120');
  ctx.fillStyle = pg;
  rr(ctx, px, py, pw, ph, 28); ctx.fill();
  drawWoodTexture(ctx, px, py, pw, ph, 28);
  ctx.strokeStyle = '#3a1e0e'; ctx.lineWidth = 4;
  rr(ctx, px, py, pw, ph, 28); ctx.stroke();
  ctx.fillStyle = '#fcf2df';
  rr(ctx, px + 16, py + 16, pw - 32, 128, 18); ctx.fill();
  ctx.strokeStyle = '#d4b283'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();

  ctx.font = '900 34px ' + FONT;
  ctx.fillStyle = '#4a2b17'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('推力用完啦', 375, py + 58);
  ctx.font = 'bold 23px ' + FONT;
  ctx.fillStyle = '#855a37';
  ctx.fillText('还有 ' + DATA.lv4FailStanding + ' 块骨牌站着，换个顺序试试？', 375, py + 106);

  const by = py + 162, bh = 80, gap = 14;
  const bw = (pw - 36 - gap * 2) / 3;
  drawWoodPillBtn(ctx, px + 18, by, bw, bh, '撤销', { icon: 'undo', fontSize: 25 });
  drawWoodPillBtn(ctx, px + 18 + bw + gap, by, bw, bh, '+1推力', { variant: 'orange', icon: 'play', fontSize: 25 });
  drawWoodPillBtn(ctx, px + 18 + (bw + gap) * 2, by, bw, bh, '重摆', { icon: 'reset', fontSize: 25 });

  drawComplianceFooter(ctx);
}

// Helper: Modal shell with dimmed background + awning wooden modal frame + title + close button
function drawModalShell(ctx, title, subtitle, mx = 34, my = 128, mw = 682, mh = 1126) {
  ctx.save();
  ctx.fillStyle = 'rgba(14, 16, 36, 0.62)';
  ctx.fillRect(0, 0, 750, 1334);
  ctx.restore();

  drawAwningWoodFrame(ctx, mx, my, mw, mh, '#faf0dc', 11);

  ctx.font = '900 36px ' + FONT;
  strokeTextChunky(ctx, title, mx + 40, my + 98, '#4a2b17', '#fff8eb', 2, 'left');
  ctx.font = 'bold 20px ' + FONT;
  ctx.fillStyle = '#8b6340'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(subtitle, mx + 40, my + 138);

  drawWoodCircleBtn(ctx, mx + mw - 62, my + 106, 30, 'close');
}

// SCREEN 07: Leaderboard Modal (Progress / Chain / WeChat Friends)
function renderScreen07_Leaderboard(ctx) {
  renderScreen_LevelSelect(ctx, 5);
  const mx = 34, my = 116, mw = 682, mh = 1146;
  drawModalShell(ctx, '画师排行榜', '当前排第 8 名 · 5/20 画 · 最高连 ×44', mx, my, mw, mh);

  // 3-tab wooden segmented bar
  const tabY = my + 172, tabH = 56, gap = 12;
  const tabW = (mw - 76 - gap * 2) / 3;
  drawWoodPillBtn(ctx, mx + 38, tabY, tabW, tabH, '通关画师榜', { variant: 'orange', fontSize: 21 });
  drawWoodPillBtn(ctx, mx + 38 + tabW + gap, tabY, tabW, tabH, '最强连锁榜', { variant: 'wood', fontSize: 21 });
  drawWoodPillBtn(ctx, mx + 38 + (tabW + gap) * 2, tabY, tabW, tabH, '微信好友', { variant: 'wood', fontSize: 21 });

  // Merge real benchmarks + player (5/20, 5 gold, x44 -> Rank #8!)
  const rows = [
    ...DATA.benchmarks.slice(0, 7).map((b, i) => ({ ...b, rank: i + 1, isMe: false })),
    { name: '我（当前画师）', avatarColor: '#e67e22', avatarLabel: '我', clearedCount: 5, goldFrames: 5, bestChain: 44, rank: 8, isMe: true }
  ];

  const listX = mx + 38, listY = tabY + tabH + 18, listW = mw - 76;
  const rowH = 72, rowGap = 9;
  const medals = ['#f2b705', '#9aa7b8', '#d9823b'];

  rows.forEach((row, idx) => {
    const ry = listY + idx * (rowH + rowGap);
    ctx.save();
    ctx.fillStyle = row.isMe ? '#fff0cf' : '#f4e6ce';
    rr(ctx, listX, ry, listW - 14, rowH, 16); ctx.fill();
    ctx.strokeStyle = row.isMe ? '#f08b22' : '#d6bc96';
    ctx.lineWidth = row.isMe ? 3.5 : 2;
    ctx.stroke();

    // Rank badge
    const rx = listX + 38, rcy = ry + rowH / 2;
    if (row.rank <= 3) {
      ctx.fillStyle = medals[row.rank - 1];
      ctx.strokeStyle = '#5c3312'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(rx, rcy, 19, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '900 21px ' + FONT;
      strokeTextChunky(ctx, String(row.rank), rx, rcy + 1, '#ffffff', '#5c3312', 3.5);
    } else {
      ctx.font = '900 23px ' + FONT;
      ctx.fillStyle = row.isMe ? '#cf5f0c' : '#805b3a';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(row.rank), rx, rcy + 1);
    }

    // Painter avatar medallion
    ctx.fillStyle = row.avatarColor;
    ctx.strokeStyle = '#5a351c'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(listX + 94, rcy, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '900 20px ' + FONT;
    strokeTextChunky(ctx, row.avatarLabel, listX + 94, rcy + 1, '#ffffff', '#4a2b17', 3);

    // Name
    ctx.fillStyle = row.isMe ? '#b54d05' : '#422714';
    ctx.font = '900 24px ' + FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(row.name, listX + 132, rcy + 1);

    // Right stats
    const rightX = listX + listW - 32;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#3d2210';
    ctx.font = '900 23px ' + FONT;
    ctx.fillText(row.clearedCount + '/20 画', rightX, ry + 24);
    ctx.fillStyle = '#b87e0c';
    ctx.font = 'bold 17px ' + FONT;
    ctx.fillText('★' + row.goldFrames + ' 金框 · ×' + row.bestChain + '连', rightX, ry + 51);
    ctx.restore();
  });

  // Scrollbar hint
  ctx.fillStyle = 'rgba(130, 92, 56, 0.32)';
  rr(ctx, listX + listW - 8, listY + 6, 7, 390, 3.5); ctx.fill();

  // Pinned My-Rank Golden Summary Card
  const myY = my + mh - 216;
  ctx.save();
  ctx.fillStyle = '#ffefd0';
  ctx.strokeStyle = '#e8a215'; ctx.lineWidth = 3.5;
  rr(ctx, listX, myY, listW, 92, 18); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#472610'; ctx.font = '900 24px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('我的排名：第 8 名', listX + 22, myY + 31);
  ctx.fillStyle = '#c45b0a'; ctx.font = '900 22px ' + FONT; ctx.textAlign = 'right';
  ctx.fillText('5/20 画 · ★5 · ×44连', listX + listW - 22, myY + 31);
  ctx.fillStyle = '#875b34'; ctx.font = 'bold 20px ' + FONT; ctx.textAlign = 'left';
  ctx.fillText('再通关 2 关即可超越「蝴蝶追光者」', listX + 22, myY + 66);
  ctx.restore();

  // Bottom Share CTA
  drawWoodPillBtn(ctx, listX, my + mh - 108, listW, 76, '分享我的战绩', { variant: 'orange', fontSize: 27 });
}

// SCREEN 08: Skins & Sound Packs Modal
function renderScreen08_Skins(ctx) {
  renderScreen_LevelSelect(ctx, 5);
  const mx = 34, my = 152, mw = 682, mh = 1044;
  drawModalShell(ctx, '骨牌皮肤与音色', '当前完美金框 ★ 5（0提示0额外推力通关可得）', mx, my, mw, mh);

  const listX = mx + 38, listW = mw - 76;
  const cardH = 186, gap = 18;
  const gold = 5;

  DATA.skins.forEach((s, idx) => {
    const cy = my + 180 + idx * (cardH + gap);
    const unlocked = gold >= s.unlockGoldFrames;
    const isActive = idx === 0;

    ctx.save();
    ctx.fillStyle = isActive ? '#fff2d4' : '#f4e6ce';
    rr(ctx, listX, cy, listW, cardH, 22); ctx.fill();
    ctx.strokeStyle = isActive ? '#f0961e' : '#cfa97a';
    ctx.lineWidth = isActive ? 4 : 2.5;
    ctx.stroke();

    // Swatch felt + mini domino preview
    const sx = listX + 20, sy = cy + 24, ss = 138;
    ctx.fillStyle = s.frameOuter;
    rr(ctx, sx, sy, ss, ss, 20); ctx.fill();
    ctx.strokeStyle = '#4a2812'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = s.feltBg;
    rr(ctx, sx + 9, sy + 9, ss - 18, ss - 18, 14); ctx.fill();

    // Mini domino in skin's real colors
    const ds = 74, dx = sx + (ss - ds) / 2, dy = sy + (ss - ds) / 2;
    ctx.fillStyle = s.normalEdge;
    rr(ctx, dx, dy + 4, ds, ds, 14); ctx.fill();
    ctx.fillStyle = s.normalTop;
    rr(ctx, dx, dy, ds, ds - 4, 14); ctx.fill();
    ctx.strokeStyle = '#5c381f'; ctx.lineWidth = 2.5;
    rr(ctx, dx, dy, ds, ds, 14); ctx.stroke();
    ctx.fillStyle = s.pipColor;
    ctx.beginPath(); ctx.arc(dx + ds / 2, dy + ds * 0.34, 6.5, 0, Math.PI * 2);
    ctx.arc(dx + ds / 2, dy + ds * 0.64, 6.5, 0, Math.PI * 2); ctx.fill();

    // Title & unlock/sound desc
    ctx.fillStyle = '#422613';
    ctx.font = '900 30px ' + FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(s.name, sx + ss + 24, cy + 56);

    ctx.fillStyle = '#855c39';
    ctx.font = 'bold 21px ' + FONT;
    ctx.fillText('音色：' + s.soundName, sx + ss + 24, cy + 98);

    ctx.fillStyle = unlocked ? '#3f8f4d' : '#b87614';
    ctx.font = 'bold 19px ' + FONT;
    ctx.fillText(unlocked ? '✓ 已永久解锁' : '★ ' + gold + '/' + s.unlockGoldFrames + ' 完美金框解锁', sx + ss + 24, cy + 136);
    ctx.restore();

    const bw = 148, bh = 62;
    const bx = listX + listW - bw - 18, by = cy + (cardH - bh) / 2;
    if (isActive) {
      drawWoodPillBtn(ctx, bx, by, bw, bh, '使用中', { variant: 'green', fontSize: 22 });
    } else if (unlocked) {
      drawWoodPillBtn(ctx, bx, by, bw, bh, '使用', { variant: 'orange', fontSize: 22 });
    } else {
      drawWoodPillBtn(ctx, bx, by, bw, bh, '试用3关', { variant: 'wood', fontSize: 22 });
    }
  });
}

// SCREEN 09: 20-Art Collage Graduation Poster Modal
function renderScreen09_Collage(ctx) {
  renderScreen_LevelSelect(ctx, 20);
  const mx = 34, my = 116, mw = 682, mh = 1146;
  drawModalShell(ctx, '首版 20 画全家福', '最高连锁 ×74 · ★ 20/20 完美金框收集达成', mx, my, mw, mh);

  // Inner golden-bordered sage showcase frame containing ALL 20 real pixel artworks!
  const fx = mx + 34, fy = my + 174, fw = mw - 68, fh = 816;
  ctx.save();
  ctx.fillStyle = '#92ab78';
  rr(ctx, fx, fy, fw, fh, 22); ctx.fill();
  ctx.strokeStyle = '#e8a81c'; ctx.lineWidth = 7;
  rr(ctx, fx, fy, fw, fh, 22); ctx.stroke();
  ctx.strokeStyle = '#6e4308'; ctx.lineWidth = 2.5;
  rr(ctx, fx - 3.5, fy - 3.5, fw + 7, fh + 7, 25); ctx.stroke();
  ctx.restore();

  const cols = 4, rows = 5, pad = 18, gap = 12;
  const cw = (fw - pad * 2 - (cols - 1) * gap) / cols;
  const ch = (fh - pad * 2 - (rows - 1) * gap) / rows;
  for (let i = 0; i < 20; i++) {
    const lv = DATA.levels[i];
    const x = fx + pad + (i % cols) * (cw + gap);
    const y = fy + pad + Math.floor(i / cols) * (ch + gap);
    ctx.fillStyle = 'rgba(255, 251, 240, 0.22)';
    rr(ctx, x, y, cw, ch, 12); ctx.fill();
    drawMiniPixelArt(ctx, lv, x + 8, y + 6, cw - 16, ch - 30);
    ctx.fillStyle = '#fff9ec';
    ctx.font = 'bold 16px ' + FONT;
    strokeTextChunky(ctx, lv.name, x + cw / 2, y + ch - 12, '#fff9ec', '#3d4c2a', 3);
  }

  const by = my + mh - 116;
  drawWoodPillBtn(ctx, fx, by, (fw - 18) / 2, 76, '保存海报到相册', { variant: 'wood', fontSize: 23 });
  drawWoodPillBtn(ctx, fx + (fw + 18) / 2, by, (fw - 18) / 2, 76, '分享全家福战绩', { variant: 'orange', fontSize: 23 });
}

// SCREEN 10: Settings & Compliance Info Modal
function renderScreen10_Settings(ctx) {
  renderScreen_LevelSelect(ctx, 5);
  const mx = 34, my = 200, mw = 682, mh = 940;
  drawModalShell(ctx, '设置与关于', '推倒一幅画 v1.0.0 · 原创单机休闲益智', mx, my, mw, mh);

  const ix = mx + 40, iw = mw - 80;
  const drawToggleRow = (ry, title, sub, isOn) => {
    ctx.save();
    ctx.fillStyle = '#f3e4c9';
    ctx.strokeStyle = '#cfa97a'; ctx.lineWidth = 2.5;
    rr(ctx, ix, ry, iw, 96, 20); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#422613'; ctx.font = '900 26px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(title, ix + 24, ry + 34);
    ctx.fillStyle = '#855c39'; ctx.font = 'bold 19px ' + FONT;
    ctx.fillText(sub, ix + 24, ry + 68);

    // Wooden pill toggle switch
    const tw = 96, th = 48, tx = ix + iw - tw - 22, ty = ry + 24;
    ctx.fillStyle = isOn ? '#5ab868' : '#a8927a';
    ctx.strokeStyle = '#3e2110'; ctx.lineWidth = 3;
    rr(ctx, tx, ty, tw, th, 24); ctx.fill(); ctx.stroke();
    const kx = isOn ? tx + tw - 24 : tx + 24;
    ctx.fillStyle = '#fff5e0';
    ctx.beginPath(); ctx.arc(kx, ty + 24, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  };

  drawToggleRow(my + 182, '骨牌与五声音阶音效', '开启后按连锁节奏奏响 G 调五声音阶', true);
  drawToggleRow(my + 296, '连锁推倒震动反馈', '开启后每次倒牌伴随细腻轻震动', true);

  // CADPA 8+ & Health Advice block
  const cy = my + 426, ch = 368;
  ctx.save();
  ctx.fillStyle = '#f5e8d0';
  ctx.strokeStyle = '#cfa97a'; ctx.lineWidth = 2.5;
  rr(ctx, ix, cy, iw, ch, 22); ctx.fill(); ctx.stroke();

  ctx.fillStyle = '#4fb866'; ctx.strokeStyle = '#1e572b'; ctx.lineWidth = 2.5;
  rr(ctx, ix + 24, cy + 26, 62, 34, 8); ctx.fill(); ctx.stroke();
  ctx.font = '900 22px ' + FONT;
  strokeTextChunky(ctx, '8+', ix + 55, cy + 44, '#ffffff', '#1e572b', 3);

  ctx.fillStyle = '#422613'; ctx.font = '900 25px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('适龄提示：CADPA 8+', ix + 100, cy + 44);

  ctx.fillStyle = '#6c492d'; ctx.font = 'bold 20px ' + FONT;
  ctx.fillText('纯单机轻量解谜，无内购付费、无暴力内容。', ix + 24, cy + 92);

  ctx.strokeStyle = 'rgba(140, 100, 62, 0.25)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ix + 24, cy + 124); ctx.lineTo(ix + iw - 24, cy + 124); ctx.stroke();

  ctx.fillStyle = '#422613'; ctx.font = '900 24px ' + FONT; ctx.textAlign = 'center';
  ctx.fillText('【健康游戏忠告】', ix + iw / 2, cy + 158);
  ctx.fillStyle = '#5e3f27'; ctx.font = 'bold 22px ' + FONT;
  ['抵制不良游戏，拒绝盗版游戏。', '注意自我保护，谨防受骗上当。', '适度游戏益脑，沉迷游戏伤身。', '合理安排时间，享受健康生活。'].forEach((l, i) => {
    ctx.fillText(l, ix + iw / 2, cy + 206 + i * 38);
  });
  ctx.restore();

  drawWoodPillBtn(ctx, ix + 130, my + mh - 110, iw - 260, 70, '我知道了', { variant: 'orange', fontSize: 25 });
}

// =========================================================================
// 5. ALL 8 MODULAR TRANSPARENT-PNG UI ASSETS
// =========================================================================
function renderAsset_ButtonsSheet(ctx) {
  // Transparent background — crisp modular button & badge sprites
  const icons = ['help', 'sound', 'mute', 'gear', 'trophy', 'palette', 'back', 'close', 'share'];
  icons.forEach((ic, i) => {
    drawWoodCircleBtn(ctx, 72 + i * 110, 74, 42, ic);
  });

  // Pill buttons
  drawWoodPillBtn(ctx, 36, 174, 240, 88, '撤销', { icon: 'undo', fontSize: 28 });
  drawWoodPillBtn(ctx, 304, 174, 240, 88, '提示 3', { icon: 'bulb', redDot: true, fontSize: 28 });
  drawWoodPillBtn(ctx, 572, 174, 240, 88, '重摆', { icon: 'reset', fontSize: 28 });

  drawWoodPillBtn(ctx, 36, 304, 290, 86, '下一关 →', { variant: 'orange', fontSize: 28 });
  drawWoodPillBtn(ctx, 354, 304, 260, 86, '+1推力', { variant: 'orange', icon: 'play', fontSize: 28 });
  drawWoodPillBtn(ctx, 642, 304, 220, 86, '使用中', { variant: 'green', fontSize: 26 });

  drawWoodPillBtn(ctx, 36, 434, 280, 82, '空白木质主钮', { variant: 'wood', fontSize: 24 });
  drawWoodPillBtn(ctx, 344, 434, 280, 82, '禁用态木钮', { variant: 'wood', disabled: true, fontSize: 24 });

  // Medals (1st / 2nd / 3rd) + CADPA 8+ + Pending Tag
  const medals = [['1', '#f2b705'], ['2', '#9aa7b8'], ['3', '#d9823b']];
  medals.forEach(([num, col], i) => {
    const cx = 86 + i * 102, cy = 610;
    ctx.fillStyle = col; ctx.strokeStyle = '#5c3312'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '900 34px ' + FONT;
    strokeTextChunky(ctx, num, cx, cy + 2, '#ffffff', '#5c3312', 5);
  });

  //待完成 Orange & Muted Tags
  ctx.fillStyle = '#ff8e24'; ctx.strokeStyle = '#8f3f0c'; ctx.lineWidth = 3;
  rr(ctx, 410, 582, 136, 52, 26); ctx.fill(); ctx.stroke();
  ctx.font = '900 26px ' + FONT; strokeTextChunky(ctx, '待完成', 478, 609, '#fffaf0', '#8f3f0c', 3.5);

  ctx.fillStyle = '#ded2be'; ctx.strokeStyle = '#85603e'; ctx.lineWidth = 2.5;
  rr(ctx, 574, 582, 136, 52, 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#6e5239'; ctx.font = '900 26px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('待完成', 642, 609);

  // CADPA 8+ badge
  ctx.fillStyle = '#4fb866'; ctx.strokeStyle = '#1e572b'; ctx.lineWidth = 3.5;
  rr(ctx, 744, 582, 88, 52, 12); ctx.fill(); ctx.stroke();
  ctx.font = '900 30px ' + FONT; strokeTextChunky(ctx, '8+', 788, 609, '#ffffff', '#1e572b', 4);
}

function renderAsset_DominoSheet(ctx) {
  // Row 1: Standing domino types (Normal, 4 Turns, Split) at crisp 116x116
  const standTypes = ['.', '^', '>', 'v', '<', '+'];
  standTypes.forEach((tp, i) => {
    drawDomino3D(ctx, 44 + i * 156, 48, 120, tp);
  });

  // Row 2: Push counter tokens (Remaining & Spent) + Recessed grid slot
  drawPushTokens(ctx, 460, 268, 3, 1);
  ctx.fillStyle = '#93a374';
  rr(ctx, 540, 210, 116, 116, 22); ctx.fill();
  ctx.strokeStyle = '#7b8c5c'; ctx.lineWidth = 3; ctx.stroke();

  // Rows 3-4: All 11 Master Pixel Art Tile Colors
  const codes = Object.keys(PAL);
  codes.forEach((code, i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    drawPixelTile3D(ctx, 44 + col * 156, 386 + row * 168, 120, code);
    ctx.font = '900 20px ' + FONT;
    strokeTextChunky(ctx, code, 104 + col * 156, 524 + row * 168, '#ffffff', '#3a1e0e', 4);
  });
}

function renderAsset_AppIcon(ctx) {
  drawNightVillageBg(ctx, 512, 512);
  drawAwningWoodFrame(ctx, 44, 56, 424, 412, '#a7b687', 7);
  // Show iconic half-revealed flower + glowing standing dominoes with generous padding
  const lv1 = DATA.levels[0];
  const cs = 46, gap = 6;
  const gx = 44 + (424 - (5 * cs + 4 * gap)) / 2;
  const gy = 56 + 68 + (318 - (6 * cs + 5 * gap)) / 2;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const ch = lv1.art[r][c];
      if (!ch || ch === '.') continue;
      const cx = gx + c * (cs + gap);
      const cy = gy + r * (cs + gap);
      if (r < 4) drawPixelTile3D(ctx, cx, cy, cs, ch);
      else drawDomino3D(ctx, cx, cy, cs, lv1.types[r][c]);
    }
  }
  drawStar4(ctx, 434, 92, 16, 0.95, '#ffe37a');
  drawStar4(ctx, 78, 430, 14, 0.9, '#ff9ec2');
}

function renderAsset_ShareCover(ctx) {
  drawNightVillageBg(ctx, 500, 400);
  // Left hanging wooden title sign
  drawHangingSign(ctx, 20, 44, 214, 72, '推倒一幅画', -3.0);
  ctx.font = 'bold 18px ' + FONT;
  strokeTextChunky(ctx, '一推连倒 74 块', 124, 162, '#ffe194', '#26294f', 4.5);
  strokeTextChunky(ctx, '你能几推点亮？', 124, 194, '#fff6e6', '#26294f', 4.5);
  drawWoodPillBtn(ctx, 32, 238, 184, 58, '立即试玩 →', { variant: 'orange', fontSize: 22 });

  // Right miniature awning board showing completed Rainbow Cloud (Lv.15)
  drawAwningWoodFrame(ctx, 242, 42, 236, 318, '#a7b687', 7);
  drawMiniPixelArt(ctx, DATA.levels[14], 266, 108, 188, 174);
  ctx.font = '900 18px ' + FONT;
  strokeTextChunky(ctx, '彩虹云 · 74连清屏', 360, 316, '#fff8eb', '#3b1f0e', 4);
  drawStar4(ctx, 464, 58, 12, 0.95, '#ffe37a');
}

// =========================================================================
// 6. EXPORT ALL 18 IMAGES TO NODE SERVER
// =========================================================================
async function exportOne(folder, filename, w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  fn(ctx, w, h);
  const dataUrl = c.toDataURL('image/png');
  const res = await fetch('/save?folder=' + encodeURIComponent(folder) + '&file=' + encodeURIComponent(filename), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: dataUrl
  });
  if (!res.ok) throw new Error('Failed saving ' + filename);
}

async function runAll() {
  const jobs = [
    ['screens', '01_splash_health_advice.png', 750, 1334, renderScreen01_Splash],
    ['screens', '02_level_select_initial.png', 750, 1334, ctx => renderScreen_LevelSelect(ctx, 0)],
    ['screens', '03_level_select_progress.png', 750, 1334, ctx => renderScreen_LevelSelect(ctx, 5)],
    ['screens', '04_gameplay_active.png', 750, 1334, renderScreen04_Gameplay],
    ['screens', '05_gameplay_win.png', 750, 1334, renderScreen05_Win],
    ['screens', '06_gameplay_fail.png', 750, 1334, renderScreen06_Fail],
    ['screens', '07_leaderboard_modal.png', 750, 1334, renderScreen07_Leaderboard],
    ['screens', '08_skins_modal.png', 750, 1334, renderScreen08_Skins],
    ['screens', '09_collage_poster_modal.png', 750, 1334, renderScreen09_Collage],
    ['screens', '10_settings_info_modal.png', 750, 1334, renderScreen10_Settings],

    ['assets', 'bg_night_village_750x1334.png', 750, 1334, ctx => drawNightVillageBg(ctx, 750, 1334)],
    ['assets', 'frame_board_awning.png', 740, 840, ctx => drawAwningWoodFrame(ctx, 20, 28, 700, 790, '#a7b687', 11)],
    ['assets', 'frame_modal_awning.png', 740, 1140, ctx => drawAwningWoodFrame(ctx, 20, 28, 700, 1090, '#faf0dc', 11)],
    ['assets', 'sign_hanging_wood.png', 420, 210, ctx => drawHangingSign(ctx, 64, 72, 290, 82, '', -2.8)],
    ['assets', 'sprites_buttons_sheet.png', 1024, 700, renderAsset_ButtonsSheet],
    ['assets', 'sprites_domino_tiles_sheet.png', 1024, 760, renderAsset_DominoSheet],
    ['assets', 'app_icon_512.png', 512, 512, renderAsset_AppIcon],
    ['assets', 'share_cover_500x400.png', 500, 400, renderAsset_ShareCover]
  ];

  await document.fonts.ready;
  for (const [folder, file, w, h, fn] of jobs) {
    await exportOne(folder, file, w, h, fn);
  }
  await fetch('/done', { method: 'POST' });
  document.getElementById('status').textContent = 'DONE ' + jobs.length;
}

runAll().catch(err => {
  document.getElementById('status').textContent = 'ERR: ' + err.message;
  fetch('/error', { method: 'POST', body: String(err.stack || err) });
});
</script>
</body>
</html>`;

let savedCount = 0;
let finishedResolve;
let finishedReject;
const finished = new Promise((res, rej) => { finishedResolve = res; finishedReject = rej; });

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(RENDERER_HTML);
    return;
  }
  if (req.method === 'POST' && u.pathname === '/save') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const folder = u.searchParams.get('folder') === 'assets' ? ASSETS_DIR : SCREENS_DIR;
      const file = path.basename(u.searchParams.get('file') || 'out.png');
      const dataUrl = Buffer.concat(chunks).toString('utf8');
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(folder, file), Buffer.from(base64, 'base64'));
      savedCount++;
      console.log(`  OK [${savedCount}] ${path.relative(ROOT, path.join(folder, file))}`);
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/done') {
    res.writeHead(200);
    res.end('ok');
    finishedResolve();
    return;
  }
  if (req.method === 'POST' && u.pathname === '/error') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200);
      res.end('ok');
      finishedReject(new Error(Buffer.concat(chunks).toString('utf8')));
    });
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const chrome = execFile('/usr/bin/google-chrome', [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=800,600',
  '--virtual-time-budget=10000',
  `http://127.0.0.1:${port}/`
], { maxBuffer: 10 * 1024 * 1024 }, () => {});

try {
  await Promise.race([
    finished,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Render timeout after 25s')), 25000))
  ]);
  console.log(`\nALL ${savedCount} UI DESIGN SCREENS & MODULAR ASSETS GENERATED SUCCESSFULLY.`);
} finally {
  chrome.kill();
  server.close();
}
