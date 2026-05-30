const gridSize = 7;
const frequencies = [392, 494, 587, 659, 784, 880];
const labels = ["ソ", "シ", "レ", "ミ", "高いソ", "高いラ"];
const keys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"]);

const state = {
  audio: null,
  running: false,
  level: 1,
  moves: 0,
  found: 0,
  sequence: [],
  targetIndex: 0,
  player: { x: 3, y: 3 },
  hazards: [],
  scanTimer: 0,
  difficulty: "standard",
  facing: "down",
  lastDistance: null,
  lastDirection: "音をきいて、たからをさがそう",
  sparkle: 0,
};

const elements = {
  canvas: document.querySelector("#visualizer"),
  level: document.querySelector("#level"),
  moves: document.querySelector("#moves"),
  score: document.querySelector("#score"),
  message: document.querySelector("#message"),
  start: document.querySelector("#startButton"),
  scan: document.querySelector("#scanButton"),
  repeat: document.querySelector("#repeatButton"),
  difficulty: document.querySelector("#difficulty"),
  speech: document.querySelector("#speechToggle"),
  visualHint: document.querySelector("#visualHint"),
  helperText: document.querySelector("#helperText"),
  proximityFill: document.querySelector("#proximityFill"),
  stageLevel: document.querySelector("#stageLevel"),
  stageScore: document.querySelector("#stageScore"),
  stageMoves: document.querySelector("#stageMoves"),
  stageCheer: document.querySelector("#stageCheer"),
};

const ctx = elements.canvas.getContext("2d");

function resizeCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.max(1, Math.round(rect.width * ratio));
  const nextHeight = Math.max(1, Math.round(rect.height * ratio));
  if (elements.canvas.width !== nextWidth || elements.canvas.height !== nextHeight) {
    elements.canvas.width = nextWidth;
    elements.canvas.height = nextHeight;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return { width: rect.width, height: rect.height };
}

function ensureAudio() {
  if (state.audio) return state.audio;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  state.audio = new AudioContext();
  return state.audio;
}

function speak(text, interrupt = true) {
  elements.message.textContent = text;
  if (!elements.speech.checked || !("speechSynthesis" in window)) return;
  if (interrupt) window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 1.02;
  window.speechSynthesis.speak(utterance);
}

function tone({ frequency, duration = 0.18, pan = 0, volume = 0.18, type = "sine", delay = 0 }) {
  const audio = ensureAudio();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const panner = audio.createStereoPanner();
  const now = audio.currentTime + delay;

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function noise({ duration = 0.16, pan = 0, volume = 0.08 }) {
  const audio = ensureAudio();
  const buffer = audio.createBuffer(1, audio.sampleRate * duration, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  const panner = audio.createStereoPanner();

  filter.type = "lowpass";
  filter.frequency.value = 280;
  gain.gain.value = volume;
  panner.pan.value = pan;
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(panner);
  panner.connect(audio.destination);
  source.start();
}

function randomCell(used = []) {
  let cell;
  do {
    cell = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize),
    };
  } while (
    (cell.x === state.player.x && cell.y === state.player.y) ||
    used.some((item) => item.x === cell.x && item.y === cell.y)
  );
  return cell;
}

function setupLevel() {
  const count = Math.min(3 + Math.floor((state.level - 1) / 2), 6);
  const used = [];
  state.sequence = Array.from({ length: count }, (_, index) => {
    const cell = randomCell(used);
    used.push(cell);
    return {
      ...cell,
      frequency: frequencies[index],
      label: labels[index],
    };
  });

  const hazardCount = state.difficulty === "relaxed" ? 2 : state.difficulty === "standard" ? 3 : 5;
  state.hazards = Array.from({ length: hazardCount }, () => {
    const cell = randomCell([...used, ...state.hazards]);
    used.push(cell);
    return cell;
  });

  state.targetIndex = 0;
  state.found = 0;
  state.moves = 0;
  state.player = { x: 3, y: 3 };
  state.lastDistance = distanceTo(state.sequence[0]);
  state.lastDirection = "音をきいて、たからをさがそう";
  updateHud();
}

function updateHud() {
  const scoreText = `${state.found}/${state.sequence.length || 3}`;
  elements.level.textContent = state.level;
  elements.moves.textContent = state.moves;
  elements.score.textContent = scoreText;
  elements.stageLevel.textContent = state.level;
  elements.stageMoves.textContent = `${state.moves}ほ`;
  elements.stageScore.textContent = scoreText;
  updateVisualHints();
}

function updateVisualHints() {
  const target = currentTarget();
  if (!target) {
    elements.proximityFill.style.width = "0%";
    elements.visualHint.textContent = "ゲームをはじめよう";
    elements.helperText.textContent = "ボタンをおすと声であんないするよ";
    elements.stageCheer.textContent = state.found > 0 ? "クリアおめでとう" : "いっしょに見つけよう";
    return;
  }

  const distance = distanceTo(target);
  const maxDistance = (gridSize - 1) * 2;
  const closeness = Math.max(0, Math.min(1, 1 - distance / maxDistance));
  elements.proximityFill.style.width = `${Math.round(closeness * 100)}%`;
  elements.visualHint.textContent = distance <= 1 ? "たからがすぐ近くで光っているよ" : state.lastDirection;
  elements.helperText.textContent = distance === 0
    ? "ここだよ。たからを見つけたね"
    : distance <= 2
      ? "いい感じ。音が近いよ"
      : "スペースで音をきいてみよう";
  elements.stageCheer.textContent = cheerText(distance, closeness);
}

function cheerText(distance, closeness) {
  if (!state.running) return state.found > 0 ? "クリアおめでとう" : "いっしょに見つけよう";
  if (distance === 0) return "そこだよ";
  if (distance <= 1) return "あと少し";
  if (closeness >= 0.65) return "いい音だよ";
  if (state.moves > 0 && state.moves % 5 === 0) return "スペースで聞こう";
  return "がんばれ";
}

function distanceTo(cell) {
  return Math.abs(cell.x - state.player.x) + Math.abs(cell.y - state.player.y);
}

function panTo(cell) {
  return (cell.x - state.player.x) / (gridSize - 1);
}

function currentTarget() {
  return state.sequence[state.targetIndex];
}

function scan() {
  if (!state.running) {
    speak("まだ始まっていません。ゲームをはじめるボタンを押してください。");
    return;
  }
  const target = currentTarget();
  const distance = distanceTo(target);
  const pan = panTo(target);
  const interval = Math.max(0.08, distance * 0.08);
  const volume = Math.max(0.08, 0.28 - distance * 0.025);

  tone({ frequency: target.frequency, pan, volume, duration: 0.14 });
  tone({ frequency: target.frequency, pan, volume, duration: 0.14, delay: interval });
  state.hazards.forEach((hazard) => {
    const hazardDistance = distanceTo(hazard);
    if (hazardDistance <= 2) noise({ pan: panTo(hazard), volume: 0.04 + (2 - hazardDistance) * 0.04 });
  });

  const direction = directionHint(target);
  state.lastDistance = distance;
  state.lastDirection = `${direction}、${distance}歩くらい`;
  updateVisualHints();
  speak(`次の音は${target.label}。${direction}。距離は${distance}歩です。`, false);
}

function directionHint(cell) {
  const horizontal = cell.x === state.player.x ? "" : cell.x > state.player.x ? "右" : "左";
  const vertical = cell.y === state.player.y ? "" : cell.y > state.player.y ? "下" : "上";
  if (!horizontal && !vertical) return "今いる場所です";
  return `${vertical}${horizontal}の方向`;
}

function move(dx, dy) {
  if (!state.running) return;
  if (dx < 0) state.facing = "left";
  if (dx > 0) state.facing = "right";
  if (dy < 0) state.facing = "up";
  if (dy > 0) state.facing = "down";
  const next = {
    x: Math.max(0, Math.min(gridSize - 1, state.player.x + dx)),
    y: Math.max(0, Math.min(gridSize - 1, state.player.y + dy)),
  };
  if (next.x === state.player.x && next.y === state.player.y) {
    tone({ frequency: 120, duration: 0.08, volume: 0.1, type: "square" });
    speak("ここから先へは行けません。", false);
    return;
  }

  state.player = next;
  state.moves += 1;
  state.lastDistance = distanceTo(currentTarget());
  updateHud();
  tone({ frequency: 220 + state.player.y * 25, duration: 0.06, volume: 0.06, pan: (state.player.x - 3) / 4 });

  if (state.hazards.some((hazard) => hazard.x === next.x && hazard.y === next.y)) {
    state.moves += state.difficulty === "sharp" ? 4 : 2;
    updateHud();
    noise({ pan: 0, volume: 0.12 });
    vibrate(90);
    speak("あぶない低い音に当たりました。手数が増えます。", false);
  }

  const target = currentTarget();
  if (target.x === next.x && target.y === next.y) collectTarget();
  else if (state.moves % 3 === 0) scan();
}

function collectTarget() {
  const target = currentTarget();
  state.found += 1;
  state.targetIndex += 1;
  state.sparkle = 42;
  updateHud();
  vibrate([40, 30, 80]);
  tone({ frequency: target.frequency, duration: 0.12, volume: 0.22 });
  tone({ frequency: target.frequency * 1.5, duration: 0.18, volume: 0.2, delay: 0.12 });

  if (state.found >= state.sequence.length) {
    state.running = false;
    const result = `レベル${state.level}クリア。${state.moves}手で見つけました。ボタンを押すと次のレベルです。`;
    state.level += 1;
    elements.start.textContent = "つぎのレベル";
    speak(result);
    return;
  }

  const next = currentTarget();
  state.lastDirection = "つぎの音をきいてみよう";
  speak(`${target.label}を見つけました。次は${next.label}です。`);
  setTimeout(scan, 650);
}

function vibrate(pattern) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function tutorial() {
  speak("おとのたからさがし。音が左から聞こえたら左へ、右から聞こえたら右へ進みます。音が近いほど大きく聞こえます。低い音はあぶないので、よけてください。矢印キーかWASDで歩きます。スペースで音を聞きます。");
}

function startGame() {
  ensureAudio().resume();
  state.difficulty = elements.difficulty.value;
  state.running = true;
  elements.start.textContent = "さいしょから";
  setupLevel();
  tutorial();
  setTimeout(() => {
    playSequence();
    setTimeout(scan, 1700);
  }, 4200);
}

function playSequence() {
  state.sequence.forEach((item, index) => {
    tone({ frequency: item.frequency, duration: 0.22, volume: 0.2, delay: index * 0.28 });
  });
}

function draw() {
  const { width, height } = resizeCanvas();
  ctx.clearRect(0, 0, width, height);
  const margin = 30;
  const topHud = Math.min(120, Math.max(86, height * 0.16));
  const bottomHud = Math.min(178, Math.max(154, height * 0.23));
  const availableHeight = Math.max(220, height - topHud - bottomHud);
  const mapSize = Math.max(210, Math.min(width - margin * 2, availableHeight));
  const cell = mapSize / gridSize;
  const originX = (width - mapSize) / 2;
  const originY = topHud + Math.max(0, (height - topHud - bottomHud - mapSize) / 2);

  drawWorldBackground(width, height);
  drawMap(originX, originY, cell);

  const target = currentTarget();
  if (target) {
    drawTreasureClue(target, originX, originY, cell);
  }

  state.hazards.forEach((hazard) => {
    drawLowToneStone(hazard, originX, originY, cell);
  });

  drawPlayer(originX + state.player.x * cell, originY + state.player.y * cell, cell);
  drawGuide(originX + state.player.x * cell, originY + state.player.y * cell, cell);
  drawSparkles(originX, originY, cell);
  if (state.sparkle > 0) state.sparkle -= 1;

  requestAnimationFrame(draw);
}

function drawWorldBackground(width, height) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#8fd7ff");
  sky.addColorStop(0.52, "#b9ec9f");
  sky.addColorStop(1, "#6bbf74");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  drawPixelCloud(98, 82, 4);
  drawPixelCloud(width - 190, 116, 3.4);

  ctx.fillStyle = "#4ca65b";
  for (let x = -40; x < width + 60; x += 52) {
    ctx.fillRect(x, height - 78, 34, 34);
    ctx.fillRect(x + 10, height - 98, 18, 22);
  }
}

function drawMap(x, y, cell) {
  ctx.save();
  ctx.shadowColor = "rgba(19, 52, 42, 0.28)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#315d49";
  ctx.fillRect(x - 10, y - 10, cell * gridSize + 20, cell * gridSize + 20);
  ctx.restore();

  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      const tileX = x + col * cell;
      const tileY = y + row * cell;
      const isPath = row === 3 || col === 3 || (row + col) % 5 === 0;
      ctx.fillStyle = isPath ? "#d8bc78" : (row + col) % 2 === 0 ? "#7bc86d" : "#6dbc64";
      ctx.fillRect(tileX, tileY, cell, cell);
      ctx.fillStyle = isPath ? "rgba(154, 104, 52, 0.18)" : "rgba(255,255,255,0.14)";
      ctx.fillRect(tileX + 5, tileY + 5, Math.max(6, cell * 0.12), Math.max(4, cell * 0.08));
      ctx.strokeStyle = "rgba(42, 91, 68, 0.22)";
      ctx.lineWidth = 2;
      ctx.strokeRect(tileX, tileY, cell, cell);
    }
  }
}

function drawTreasureClue(target, originX, originY, cell) {
  const distance = distanceTo(target);
  const centerX = originX + (target.x + 0.5) * cell;
  const centerY = originY + (target.y + 0.5) * cell;
  const time = performance.now() / 420;
  const visible = distance <= 2 || !state.running;
  const radius = cell * (0.55 + Math.sin(time) * 0.08);

  ctx.save();
  ctx.globalAlpha = distance <= 1 ? 0.92 : 0.32;
  ctx.fillStyle = "#ffe66d";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (!visible) {
    ctx.fillStyle = "rgba(255, 230, 109, 0.6)";
    drawMusicNote(centerX - 9, centerY - 11, cell * 0.22);
    return;
  }

  drawChest(centerX - cell * 0.24, centerY - cell * 0.15, cell * 0.48, distance === 0);
}

function drawLowToneStone(hazard, originX, originY, cell) {
  const x = originX + hazard.x * cell;
  const y = originY + hazard.y * cell;
  ctx.fillStyle = "rgba(95, 82, 92, 0.82)";
  ctx.fillRect(x + cell * 0.27, y + cell * 0.42, cell * 0.46, cell * 0.26);
  ctx.fillStyle = "#3f3645";
  ctx.fillRect(x + cell * 0.35, y + cell * 0.34, cell * 0.3, cell * 0.12);
  ctx.fillStyle = "#d9b3ff";
  drawMusicNote(x + cell * 0.43, y + cell * 0.19, cell * 0.16);
}

function drawPlayer(x, y, cell) {
  const step = Math.floor(performance.now() / 180) % 2;
  const px = x + cell * 0.5;
  const py = y + cell * 0.54 + (state.running ? step * 1.5 : 0);
  const scale = cell / 72;

  ctx.save();
  ctx.translate(px, py);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(31, 62, 52, 0.24)";
  ctx.fillRect(-18, 24, 36, 8);
  ctx.fillStyle = "#3157a4";
  ctx.fillRect(-15, -4, 30, 30);
  ctx.fillStyle = "#ffcf8a";
  ctx.fillRect(-13, -27, 26, 23);
  ctx.fillStyle = "#3b2a35";
  ctx.fillRect(-15, -33, 30, 9);
  ctx.fillRect(-18, -24, 6, 13);
  ctx.fillRect(12, -24, 6, 13);
  ctx.fillStyle = "#15212b";
  const eyeY = state.facing === "up" ? -20 : -17;
  ctx.fillRect(-8, eyeY, 4, 4);
  ctx.fillRect(5, eyeY, 4, 4);
  ctx.fillStyle = "#74f0bf";
  ctx.fillRect(-18, -2, 8, 24);
  ctx.fillRect(10, -2, 8, 24);
  ctx.fillStyle = "#203a66";
  ctx.fillRect(-13, 26, 10, 12 + step * 3);
  ctx.fillRect(3, 26, 10, 12 + (1 - step) * 3);
  ctx.restore();
}

function drawGuide(x, y, cell) {
  const px = x + cell * 0.82;
  const py = y + cell * 0.18 + Math.sin(performance.now() / 280) * 4;
  const scale = cell / 72;
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(23, 55, 45, 0.18)";
  ctx.fillRect(-12, 18, 24, 5);
  ctx.fillStyle = "#fff3a6";
  ctx.fillRect(-14, -10, 28, 25);
  ctx.fillStyle = "#ff8b6b";
  ctx.fillRect(-10, -17, 20, 8);
  ctx.fillStyle = "#17372d";
  ctx.fillRect(-7, -2, 4, 4);
  ctx.fillRect(4, -2, 4, 4);
  ctx.fillStyle = "#74f0bf";
  ctx.fillRect(-20, 2, 6, 12);
  ctx.fillRect(14, 2, 6, 12);
  ctx.restore();
}

function drawChest(x, y, size, open) {
  ctx.fillStyle = "#8d5524";
  ctx.fillRect(x, y + size * 0.26, size, size * 0.5);
  ctx.fillStyle = "#c4772f";
  ctx.fillRect(x + size * 0.08, y + size * 0.08, size * 0.84, size * 0.28);
  ctx.fillStyle = "#ffd966";
  ctx.fillRect(x + size * 0.42, y + size * 0.22, size * 0.16, size * 0.28);
  ctx.fillRect(x + size * 0.08, y + size * 0.48, size * 0.84, size * 0.08);
  if (open) {
    ctx.fillStyle = "#fff3a6";
    ctx.fillRect(x + size * 0.18, y - size * 0.08, size * 0.64, size * 0.18);
  }
}

function drawSparkles(originX, originY, cell) {
  if (state.sparkle <= 0) return;
  const target = state.sequence[Math.max(0, state.targetIndex - 1)];
  if (!target) return;
  const centerX = originX + (target.x + 0.5) * cell;
  const centerY = originY + (target.y + 0.5) * cell;
  ctx.fillStyle = "#fff3a6";
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8 + state.sparkle * 0.05;
    const distance = (44 - state.sparkle) * 2.2;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    ctx.fillRect(x - 4, y - 4, 8, 8);
  }
}

function drawPixelCloud(x, y, scale) {
  ctx.fillRect(x, y, 18 * scale, 8 * scale);
  ctx.fillRect(x + 7 * scale, y - 7 * scale, 20 * scale, 15 * scale);
  ctx.fillRect(x + 24 * scale, y + 1 * scale, 18 * scale, 8 * scale);
}

function drawMusicNote(x, y, size) {
  ctx.fillRect(x, y, size * 0.22, size * 0.9);
  ctx.fillRect(x, y, size * 0.62, size * 0.18);
  ctx.fillRect(x + size * 0.4, y + size * 0.16, size * 0.18, size * 0.58);
  ctx.fillRect(x - size * 0.18, y + size * 0.78, size * 0.38, size * 0.26);
  ctx.fillRect(x + size * 0.28, y + size * 0.62, size * 0.38, size * 0.26);
}

elements.start.addEventListener("click", startGame);
elements.scan.addEventListener("click", scan);
elements.repeat.addEventListener("click", tutorial);
elements.difficulty.addEventListener("change", () => {
  state.difficulty = elements.difficulty.value;
  speak(`難易度を${elements.difficulty.selectedOptions[0].textContent}にしました。`);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !state.running) startGame();
  if (event.key === " ") {
    event.preventDefault();
    scan();
  }
  if (!keys.has(event.key)) return;
  event.preventDefault();
  const map = {
    ArrowUp: [0, -1],
    w: [0, -1],
    W: [0, -1],
    ArrowDown: [0, 1],
    s: [0, 1],
    S: [0, 1],
    ArrowLeft: [-1, 0],
    a: [-1, 0],
    A: [-1, 0],
    ArrowRight: [1, 0],
    d: [1, 0],
    D: [1, 0],
  };
  move(...map[event.key]);
});

updateHud();
draw();
