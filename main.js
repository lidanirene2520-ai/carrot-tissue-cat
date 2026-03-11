const canvas = document.getElementById("canvas");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const livesEl = document.getElementById("lives");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlayBodyEl = document.getElementById("overlayBody");
const btnStart = document.getElementById("btnStart");
const btnAgain = document.getElementById("btnAgain");
const btnPause = document.getElementById("btnPause");
const btnResetBest = document.getElementById("btnResetBest");

const ctx = canvas.getContext("2d");

const WORLD = { w: 480, h: 720 };
const PLAYER = { w: 56, h: 56 };
const ITEM = { w: 44, h: 44 };

const STORAGE_KEY = "carrot-tissue-cat-best";
const AVATAR_KEY = "carrot-tissue-cat-avatar";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => min + Math.random() * (max - min);

let dpr = 1;
let rafId = 0;

let state = "menu";
let score = 0;
let best = 0;
let lives = 3;
let timeMs = 0;

let player = { x: WORLD.w / 2, y: WORLD.h - 92, vx: 0, vy: 0, targetX: null, targetY: null };
let keys = new Set();
let items = [];
let catHeadCanvas = null;
let popups = [];
let goodFlashMs = 0;
let badFlashMs = 0;

let spawnAccum = 0;
let spawnEveryMs = 520;
let fallSpeed = 240;

function loadBest() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : 0;
  best = Number.isFinite(n) ? n : 0;
  bestEl.textContent = String(best);
}

function saveBest(nextBest) {
  best = nextBest;
  bestEl.textContent = String(best);
  localStorage.setItem(STORAGE_KEY, String(best));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function prepareAvatarCanvas(img) {
  const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const sx = Math.max(0, (sw - s) / 2);
  const sy = Math.max(0, (sh - s) / 2);
  const out = document.createElement("canvas");
  out.width = 128;
  out.height = 128;
  const c = out.getContext("2d");
  c.imageSmoothingEnabled = true;
  c.drawImage(img, sx, sy, s, s, 0, 0, out.width, out.height);
  return out;
}

function setAvatarFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      catHeadCanvas = prepareAvatarCanvas(img);
      resolve();
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

async function setAvatarFromBlob(blob) {
  const dataUrl = await blobToDataUrl(blob);
  localStorage.setItem(AVATAR_KEY, dataUrl);
  await setAvatarFromDataUrl(dataUrl);
}

async function loadAvatar() {
  const dataUrl = localStorage.getItem(AVATAR_KEY);
  if (!dataUrl) return;
  try {
    await setAvatarFromDataUrl(dataUrl);
  } catch {
    localStorage.removeItem(AVATAR_KEY);
    catHeadCanvas = null;
  }
}

function setOverlay(visible) {
  overlayEl.classList.toggle("hidden", !visible);
}

function setHud() {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  livesEl.textContent = String(lives);
}

function pulse(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function spawnPopup(text, x, y, color) {
  popups.push({
    text,
    x,
    y,
    color,
    ageMs: 0,
    ttlMs: 760,
    vy: -110,
  });
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const cssW = rect.width;
  const cssH = rect.width * (WORLD.h / WORLD.w);
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale((cssW / WORLD.w) * dpr, (cssH / WORLD.h) * dpr);
  ctx.imageSmoothingEnabled = true;
}

function resetGame() {
  score = 0;
  lives = 3;
  timeMs = 0;
  spawnAccum = 0;
  spawnEveryMs = 520;
  fallSpeed = 240;
  items = [];
  popups = [];
  goodFlashMs = 0;
  badFlashMs = 0;
  player = { x: WORLD.w / 2, y: WORLD.h - 92, vx: 0, vy: 0, targetX: null, targetY: null };
  setHud();
}

function startGame() {
  resetGame();
  state = "playing";
  setOverlay(false);
}

function gameOver() {
  state = "over";
  if (score > best) saveBest(score);
  overlayTitleEl.textContent = "游戏结束";
  overlayBodyEl.innerHTML = `本局分数：<b>${score}</b><br />接住🥕加分，躲开🧻保命。`;
  setOverlay(true);
}

function togglePause() {
  if (state === "playing") {
    state = "paused";
    overlayTitleEl.textContent = "已暂停";
    overlayBodyEl.innerHTML = "按“暂停”继续，或者点“再来一局”重开。";
    setOverlay(true);
    btnStart.style.display = "none";
    btnAgain.style.display = "inline-flex";
  } else if (state === "paused") {
    state = "playing";
    setOverlay(false);
  }
}

function showMenu() {
  state = "menu";
  overlayTitleEl.textContent = "开始游戏";
  overlayBodyEl.innerHTML = "你是一只小猫：接住🥕加分，碰到🧻掉生命。<br />方向键或 WASD 移动；触屏：按住拖动移动。";
  btnStart.style.display = "inline-flex";
  btnAgain.style.display = "inline-flex";
  setOverlay(true);
}

function spawnItem() {
  const isCarrot = Math.random() < 0.72;
  const x = rand(ITEM.w / 2 + 10, WORLD.w - ITEM.w / 2 - 10);
  const y = -ITEM.h;
  const r = ITEM.w / 2;
  const speed = fallSpeed * rand(0.9, 1.2);
  items.push({ x, y, r, speed, kind: isCarrot ? "carrot" : "tissue" });
}

function circlesOverlap(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr;
}

function playerCircle() {
  return { x: player.x, y: player.y, r: 22 };
}

function updateDifficulty(dtMs) {
  const t = timeMs / 1000;
  spawnEveryMs = clamp(520 - t * 9, 220, 520);
  fallSpeed = clamp(240 + t * 9, 240, 520);
}

function updatePlayer(dtMs) {
  const dt = dtMs / 1000;
  const maxSpeed = 540;
  const accel = 3400;
  const friction = 10;

  let ax = 0;
  let ay = 0;

  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const up = keys.has("ArrowUp") || keys.has("KeyW");
  const down = keys.has("ArrowDown") || keys.has("KeyS");

  if (left) ax -= accel;
  if (right) ax += accel;
  if (up) ay -= accel * 0.7;
  if (down) ay += accel * 0.7;

  if (player.targetX != null && player.targetY != null) {
    const dx = player.targetX - player.x;
    const dy = player.targetY - player.y;
    ax += clamp(dx * 28, -accel, accel);
    ay += clamp(dy * 20, -accel, accel);
  }

  player.vx += ax * dt;
  player.vy += ay * dt;

  player.vx -= player.vx * friction * dt;
  player.vy -= player.vy * friction * dt;

  player.vx = clamp(player.vx, -maxSpeed, maxSpeed);
  player.vy = clamp(player.vy, -maxSpeed, maxSpeed);

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  player.x = clamp(player.x, PLAYER.w / 2, WORLD.w - PLAYER.w / 2);
  player.y = clamp(player.y, WORLD.h * 0.45, WORLD.h - PLAYER.h / 2 - 16);
}

function updateItems(dtMs) {
  const dt = dtMs / 1000;
  for (const it of items) it.y += it.speed * dt;
  items = items.filter((it) => it.y < WORLD.h + it.r + 40);
}

function handleCollisions() {
  const pc = playerCircle();
  let hit = [];
  for (let i = 0; i < items.length; i++) {
    if (circlesOverlap(pc, items[i])) hit.push(i);
  }
  if (hit.length === 0) return;

  hit.sort((a, b) => b - a);
  for (const idx of hit) {
    const it = items[idx];
    items.splice(idx, 1);
    if (it.kind === "carrot") {
      score += 10;
      goodFlashMs = 180;
      spawnPopup("+10", it.x, it.y, "rgba(255, 214, 102, 1)");
      pulse(scoreEl, "fx-score");
      if (score > best) bestEl.textContent = String(score);
    } else {
      lives -= 1;
      badFlashMs = 240;
      spawnPopup("-1", it.x, it.y, "rgba(255, 110, 140, 1)");
      pulse(livesEl, "fx-life");
      if (lives <= 0) {
        setHud();
        gameOver();
        return;
      }
    }
  }
  setHud();
}

function updateEffects(dtMs) {
  if (goodFlashMs > 0) goodFlashMs = Math.max(0, goodFlashMs - dtMs);
  if (badFlashMs > 0) badFlashMs = Math.max(0, badFlashMs - dtMs);
  if (popups.length === 0) return;

  const dt = dtMs / 1000;
  for (const p of popups) {
    p.ageMs += dtMs;
    p.y += p.vy * dt;
    p.vy -= 40 * dt;
  }
  popups = popups.filter((p) => p.ageMs < p.ttlMs);
}

function drawEffects() {
  if (goodFlashMs > 0) {
    const a = 0.12 * (goodFlashMs / 180);
    ctx.fillStyle = `rgba(255, 214, 102, ${a})`;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  }
  if (badFlashMs > 0) {
    const a = 0.18 * (badFlashMs / 240);
    ctx.fillStyle = `rgba(255, 77, 109, ${a})`;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  }

  if (popups.length === 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "24px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial";
  for (const p of popups) {
    const t = clamp(p.ageMs / p.ttlMs, 0, 1);
    const alpha = 1 - t;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawRoundedRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBackground() {
  ctx.clearRect(0, 0, WORLD.w, WORLD.h);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let i = 0; i < 36; i++) {
    const x = (i * 47 + (timeMs / 18) % 47) % (WORLD.w + 60) - 30;
    const y = ((i * 83 + (timeMs / 28) % 83) % (WORLD.h + 80)) - 40;
    ctx.beginPath();
    ctx.arc(x, y, 1.4 + (i % 3) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  drawRoundedRect(14, 14, WORLD.w - 28, WORLD.h - 28, 18);
  ctx.fill();
}

function drawPlayer() {
  const x = player.x;
  const y = player.y;

  ctx.save();

  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.beginPath();
  ctx.ellipse(x, y + 22, 26, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "52px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
  drawEmojiWithContrast("🐱", x, y, "rgba(255, 220, 120, 0.55)");

  ctx.restore();
}

function drawEmojiWithContrast(emoji, x, y, glowColor) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(0,0,0,0.78)";
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 10;
  ctx.strokeText(emoji, x, y);
  ctx.shadowBlur = 0;
  ctx.fillText(emoji, x, y);
  ctx.restore();
}

function drawItems() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "38px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
  for (const it of items) {
    const emoji = it.kind === "carrot" ? "🥕" : "🧻";
    const glowColor = it.kind === "carrot" ? "rgba(255, 168, 0, 0.75)" : "rgba(255, 255, 255, 0.55)";
    drawEmojiWithContrast(emoji, it.x, it.y, glowColor);
  }
}

function drawTopHint() {
  if (state !== "playing" || timeMs > 7000) return;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "16px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("接🥕加分，躲🧻保命", WORLD.w / 2, 18);
}

function tick(now) {
  if (!tick.last) tick.last = now;
  const dtMs = clamp(now - tick.last, 0, 40);
  tick.last = now;

  if (state === "playing") {
    timeMs += dtMs;
    updateDifficulty(dtMs);
    updatePlayer(dtMs);

    spawnAccum += dtMs;
    while (spawnAccum >= spawnEveryMs) {
      spawnAccum -= spawnEveryMs;
      spawnItem();
    }

    updateItems(dtMs);
    handleCollisions();
  }
  updateEffects(dtMs);

  drawBackground();
  drawItems();
  drawPlayer();
  drawTopHint();
  drawEffects();

  rafId = requestAnimationFrame(tick);
}

function toWorldPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * WORLD.w;
  const y = ((clientY - rect.top) / rect.height) * WORLD.h;
  return { x, y };
}

window.addEventListener("resize", () => resizeCanvas());

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    if (state === "menu" || state === "over") startGame();
    else togglePause();
    return;
  }
  if (e.code === "Escape") {
    if (state === "playing") togglePause();
    return;
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

window.addEventListener("paste", async (e) => {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItem = items.find((it) => it.type && it.type.startsWith("image/"));
  const file = imageItem?.getAsFile?.();
  if (!file) return;
  try {
    await setAvatarFromBlob(file);
  } catch {}
});

canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
});

canvas.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = Array.from(e.dataTransfer?.files || []).find((f) => f.type && f.type.startsWith("image/"));
  if (!file) return;
  try {
    await setAvatarFromBlob(file);
  } catch {}
});

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toWorldPos(e.clientX, e.clientY);
  player.targetX = p.x;
  player.targetY = p.y;
});

canvas.addEventListener("pointermove", (e) => {
  if (player.targetX == null) return;
  const p = toWorldPos(e.clientX, e.clientY);
  player.targetX = p.x;
  player.targetY = p.y;
});

canvas.addEventListener("pointerup", () => {
  player.targetX = null;
  player.targetY = null;
});

btnStart.addEventListener("click", () => startGame());
btnAgain.addEventListener("click", () => startGame());
btnPause.addEventListener("click", () => togglePause());
btnResetBest.addEventListener("click", () => {
  saveBest(0);
});

function init() {
  resizeCanvas();
  loadBest();
  loadAvatar();
  setHud();
  showMenu();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

init();
