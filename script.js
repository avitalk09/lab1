'use strict';

/* =========================================================
   BLACKOUT: SYSTEM FAILURE
   ========================================================= */

const $ = (sel) => document.querySelector(sel);
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const LOCKDOWN_SECONDS = 60;

/* ---------- Pending timeouts (cleared on restart) ---------- */
const timeouts = new Set();
function later(fn, ms) {
  const id = setTimeout(() => { timeouts.delete(id); fn(); }, ms);
  timeouts.add(id);
}
function clearLater() {
  timeouts.forEach(clearTimeout);
  timeouts.clear();
}

/* ---------- Storage (optional) ---------- */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

/* =========================================================
   Sound (Web Audio)
   ========================================================= */
const Sound = {
  ctx: null,
  master: null,
  muted: load('blackout-muted', false),

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null;
    }
  },

  setMuted(m) {
    this.muted = m;
    save('blackout-muted', m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  },

  tone(freq, dur = 0.1, type = 'square', vol = 0.15, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },

  noise(dur = 0.4, vol = 0.25, freq = 1200) {
    if (!this.ctx || this.muted) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  },
};

const sfx = {
  key: () => Sound.tone(1600 + Math.random() * 600, 0.02, 'square', 0.025),
  click: () => Sound.tone(660, 0.06, 'square', 0.08),
  good: () => [523, 659, 784, 1046].forEach((f, i) => Sound.tone(f, 0.12, 'square', 0.08, null, i * 0.06)),
  bad: () => { Sound.tone(180, 0.35, 'sawtooth', 0.18, 60); Sound.noise(0.2, 0.12, 900); },
  shoot: () => Sound.tone(950, 0.05, 'square', 0.03, 350),
  hit: () => Sound.tone(260, 0.05, 'triangle', 0.1, 110),
  enemy: () => Sound.tone(420, 0.12, 'sawtooth', 0.05, 180),
  hurt: () => { Sound.tone(140, 0.4, 'sawtooth', 0.25, 40); Sound.noise(0.3, 0.25, 900); },
  boom: () => { Sound.noise(1.4, 0.55, 700); Sound.tone(90, 1.2, 'sine', 0.4, 25); },
  tick: () => Sound.tone(1100, 0.05, 'sine', 0.1),
  whoosh: () => { Sound.noise(0.6, 0.12, 3000); Sound.tone(180, 0.6, 'sawtooth', 0.05, 1400); },
  win: () => [392, 523, 659, 784, 1046, 1318].forEach((f, i) => Sound.tone(f, 0.28, 'square', 0.08, null, i * 0.09)),
  lose: () => [440, 370, 311, 220].forEach((f, i) => Sound.tone(f, 0.4, 'sawtooth', 0.12, null, i * 0.2)),
};

const muteBtn = $('#mute-btn');
function renderMute() { muteBtn.textContent = Sound.muted ? 'SOUND: OFF' : 'SOUND: ON'; }
function toggleMute() { Sound.init(); Sound.setMuted(!Sound.muted); renderMute(); }
muteBtn.addEventListener('click', (e) => { toggleMute(); e.currentTarget.blur(); });
renderMute();

/* =========================================================
   Background particles
   ========================================================= */
const bg = $('#bg');
const bgx = bg.getContext('2d');
const COLORS = ['57,255,136', '34,230,255', '255,43,214'];
let particles = [];

function resizeBg() {
  bg.width = window.innerWidth;
  bg.height = window.innerHeight;
  const count = Math.min(90, Math.floor((bg.width * bg.height) / 18000));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * bg.width,
    y: Math.random() * bg.height,
    vx: (Math.random() - 0.5) * 12,
    vy: -6 - Math.random() * 18,
    r: Math.random() * 1.6 + 0.4,
    c: COLORS[Math.random() < 0.6 ? 0 : Math.random() < 0.7 ? 1 : 2],
  }));
}
window.addEventListener('resize', resizeBg);
resizeBg();

function drawBg(dt) {
  const w = bg.width, h = bg.height;
  bgx.clearRect(0, 0, w, h);

  // faint grid
  bgx.strokeStyle = 'rgba(57,255,136,0.035)';
  bgx.lineWidth = 1;
  bgx.beginPath();
  for (let x = 0; x < w; x += 48) { bgx.moveTo(x + 0.5, 0); bgx.lineTo(x + 0.5, h); }
  for (let y = 0; y < h; y += 48) { bgx.moveTo(0, y + 0.5); bgx.lineTo(w, y + 0.5); }
  bgx.stroke();

  const speed = state.running ? 2.2 : 1;
  for (const p of particles) {
    p.x += p.vx * dt * speed;
    p.y += p.vy * dt * speed;
    if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
    if (p.x < -10) p.x = w + 10;
    if (p.x > w + 10) p.x = -10;
  }
  // connections
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 110) {
        bgx.strokeStyle = `rgba(34,230,255,${(1 - d / 110) * 0.12})`;
        bgx.beginPath();
        bgx.moveTo(a.x, a.y);
        bgx.lineTo(b.x, b.y);
        bgx.stroke();
      }
    }
  }
  for (const p of particles) {
    bgx.fillStyle = `rgba(${p.c},0.7)`;
    bgx.beginPath();
    bgx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    bgx.fill();
  }
}

/* =========================================================
   Game state, screens, HUD
   ========================================================= */
const state = {
  screen: 'title',
  running: false,
  paused: true,
  timeLeft: LOCKDOWN_SECONDS,
  elapsed: 0,
  score: 0,
  stage: 0,
  lastTick: null,
};

const STAGE_NAMES = { 1: 'CIPHER LOCK', 2: 'SIGNAL BYPASS', 3: 'FIREWALL' };

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  state.screen = id;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

function setStage(n) {
  state.stage = n;
  $('#hud-stage').textContent = `${n}/3 · ${STAGE_NAMES[n]}`;
}

function addScore(n) {
  state.score = Math.max(0, state.score + n);
}

function penalize(seconds) {
  state.timeLeft -= seconds;
  flash('rgba(255,51,85,1)');
}

function flash(color) {
  const f = $('#flash');
  f.style.background = color;
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
}

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

const hudTime = $('#hud-time');
const timerFill = $('#timer-fill');
function updateHud() {
  const t = Math.max(0, state.timeLeft);
  hudTime.textContent = t.toFixed(1);
  timerFill.style.width = `${clamp((t / LOCKDOWN_SECONDS) * 100, 0, 100)}%`;
  const critical = state.running && t <= 10;
  hudTime.classList.toggle('critical', critical);
  $('#hud').classList.toggle('critical-bar', critical);
  document.body.classList.toggle('danger', critical);
  $('#hud-score').textContent = state.score.toLocaleString();

  if (critical && !state.paused) {
    const whole = Math.ceil(t);
    if (whole !== state.lastTick) { state.lastTick = whole; sfx.tick(); }
  }
}

function transition(title, sub, next, ms = 1600) {
  state.paused = true;
  const tr = $('#transition');
  const tt = $('#t-title');
  tt.textContent = title;
  tt.dataset.text = title;
  $('#t-sub').textContent = sub;
  tr.classList.remove('on');
  void tr.offsetWidth;
  tr.classList.add('on');
  sfx.whoosh();
  later(() => {
    tr.classList.remove('on');
    next();
    state.paused = false;
  }, ms);
}

/* ---------- Typed terminal text ---------- */
function typeLines(el, lines, speed = 22) {
  el.innerHTML = '';
  let li = 0;
  const nextLine = () => {
    if (li >= lines.length) {
      const c = document.createElement('span');
      c.className = 'cursor';
      el.lastChild && el.lastChild.appendChild(c);
      return;
    }
    const { text, cls } = lines[li++];
    const div = document.createElement('div');
    if (cls) div.className = cls;
    el.appendChild(div);
    let ci = 0;
    const step = () => {
      div.textContent = text.slice(0, ++ci);
      if (ci % 3 === 0) sfx.key();
      if (ci < text.length) later(step, speed);
      else later(nextLine, 220);
    };
    step();
  };
  nextLine();
}

/* =========================================================
   Flow
   ========================================================= */
function goTitle() {
  resetGame();
  show('title');
  $('#hud').classList.add('hidden');
  typeLines($('#title-terminal'), [
    { text: '> establishing uplink to nexus-corp.mainframe ...' },
    { text: '> proxy chain: 7 hops · signal masked · ok' },
    { text: '> WARNING: lockdown protocol arms on first contact', cls: 'warn' },
    { text: '> awaiting operator command' },
  ]);
}

function resetGame() {
  clearLater();
  Object.assign(state, {
    running: false, paused: true, timeLeft: LOCKDOWN_SECONDS, elapsed: 0, score: 0, stage: 0, lastTick: null,
  });
  keys.left = keys.right = keys.fire = false;
  s3.ended = true;
  $('#transition').classList.remove('on');
  document.body.classList.remove('failed', 'danger');
  updateHud();
}

function startGame() {
  Sound.init();
  resetGame();
  state.running = true;
  setStage(1);
  $('#hud').classList.remove('hidden');
  show('stage1');
  transition('INITIATING BREACH', 'LOCKDOWN TIMER ARMED · 60 SECONDS', startStage1, 1800);
}

function computeRank(score) {
  if (score >= 13000) return ['S', 'GHOST'];
  if (score >= 10500) return ['A', 'ELITE'];
  if (score >= 8000) return ['B', 'OPERATOR'];
  return ['C', 'SCRIPT KIDDIE'];
}

function finish(won, reason) {
  if (!state.running) return;
  state.running = false;
  state.paused = true;
  s3.ended = true;
  clearLater();
  $('#transition').classList.remove('on');

  let layers = state.stage - 1;
  if (won) {
    layers = 3;
    addScore(Math.round(state.timeLeft * 100) + s3.shields * 750);
  }

  const best = Math.max(load('blackout-best', 0), state.score);
  save('blackout-best', best);

  const title = won ? 'SYSTEM BREACHED' : reason === 'lockdown' ? 'LOCKDOWN ENGAGED' : 'TRACE COMPLETE';
  const endTitle = $('#end-title');
  endTitle.textContent = title;
  endTitle.dataset.text = title;
  $('#end-kicker').textContent = won ? '// ACCESS GRANTED · ROOT PRIVILEGES ACQUIRED' : '// CONNECTION SEVERED';
  $('#end-sub').textContent = won
    ? 'The Nexus mainframe is yours. Lights out across the city.'
    : reason === 'lockdown'
      ? 'The 60-second window closed. Security sealed every port.'
      : 'The firewall traced your signal. Agents are en route.';

  const [rank, label] = won ? computeRank(state.score) : ['F', 'TRACED'];
  const rankEl = $('#end-rank');
  rankEl.textContent = rank;
  rankEl.style.animation = 'none';
  void rankEl.offsetWidth;
  rankEl.style.animation = '';
  $('#end-rank-label').textContent = label;
  $('#end-time').textContent = `${state.elapsed.toFixed(1)}s`;
  $('#end-layers').textContent = `${layers}/3`;
  $('#end-best').textContent = best.toLocaleString();

  document.body.classList.toggle('failed', !won);
  document.body.classList.remove('danger');
  $('#hud').classList.add('hidden');
  show('end');
  flash(won ? 'rgba(57,255,136,1)' : 'rgba(255,51,85,1)');
  won ? sfx.win() : sfx.lose();

  // score count-up
  const target = state.score;
  const scoreEl = $('#end-score');
  const start = performance.now();
  const count = (now) => {
    const p = Math.min(1, (now - start) / 1200);
    scoreEl.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1 && state.screen === 'end') requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
}

/* =========================================================
   STAGE 1 — Cipher Lock (number sequences)
   Every generator builds the sequence from a known rule and
   computes the answer from that same rule, so it's always solvable.
   ========================================================= */
const GENERATORS = [
  [
    () => {
      const a = rand(2, 20), d = rand(3, 9);
      const s = Array.from({ length: 6 }, (_, i) => a + d * i);
      return { seq: s.slice(0, 5), answer: s[5], cls: 'LINEAR DRIFT' };
    },
    () => {
      const k = rand(1, 5);
      const s = Array.from({ length: 6 }, (_, i) => (k + i) ** 2);
      return { seq: s.slice(0, 5), answer: s[5], cls: 'SQUARE MATRIX' };
    },
  ],
  [
    () => {
      const a = rand(1, 5), r = rand(2, 3);
      const s = Array.from({ length: 6 }, (_, i) => a * r ** i);
      return { seq: s.slice(0, 5), answer: s[5], cls: 'EXPONENTIAL KEY' };
    },
    () => {
      const a = rand(1, 15), d = rand(1, 4), inc = rand(1, 3);
      const s = [a];
      let step = d;
      while (s.length < 6) { s.push(s[s.length - 1] + step); step += inc; }
      return { seq: s.slice(0, 5), answer: s[5], cls: 'ACCELERATING STEP' };
    },
  ],
  [
    () => {
      const a = rand(1, 6), b = rand(a, a + 6);
      const s = [a, b];
      while (s.length < 7) s.push(s[s.length - 1] + s[s.length - 2]);
      return { seq: s.slice(0, 6), answer: s[6], cls: 'RECURSIVE HASH' };
    },
    () => {
      const a = rand(2, 9), add = rand(1, 6);
      const s = [a];
      while (s.length < 7) s.push(s.length % 2 === 1 ? s[s.length - 1] * 2 : s[s.length - 1] + add);
      return { seq: s.slice(0, 6), answer: s[6], cls: 'INTERLEAVED OPS (×2, +n)' };
    },
  ],
];

const s1 = { round: 0, puzzle: null, startedAt: 0, locked: false };
const s1Input = $('#s1-input');
const s1Feedback = $('#s1-feedback');

function startStage1() {
  setStage(1);
  show('stage1');
  s1.round = 0;
  document.querySelectorAll('#s1-pips i').forEach((p) => p.classList.remove('on'));
  newPuzzle();
}

function newPuzzle() {
  const tier = GENERATORS[s1.round];
  s1.puzzle = tier[rand(0, tier.length - 1)]();
  s1.startedAt = state.elapsed;
  s1.locked = false;

  $('#s1-class').textContent = `ENCRYPTION CLASS: ${s1.puzzle.cls}`;
  const seqEl = $('#s1-seq');
  seqEl.innerHTML = '';
  [...s1.puzzle.seq, '?'].forEach((n, i) => {
    const d = document.createElement('div');
    d.className = 'seq-item' + (n === '?' ? ' unknown' : '');
    d.textContent = n;
    d.style.animationDelay = `${i * 0.07}s${n === '?' ? ', 0.5s' : ''}`;
    seqEl.appendChild(d);
  });
  s1Feedback.className = 'feedback';
  s1Feedback.textContent = `Fragment ${s1.round + 1} of 3 · enter the next number.`;
  s1Input.value = '';
  s1Input.disabled = false;
  s1Input.focus();
}

s1Input.addEventListener('input', () => {
  s1Input.value = s1Input.value.replace(/[^0-9]/g, '');
  sfx.key();
});

$('#s1-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.screen !== 'stage1' || s1.locked || state.paused) return;
  const val = parseInt(s1Input.value, 10);
  if (Number.isNaN(val)) { shake(s1Input); s1Input.focus(); return; }

  s1.locked = true;
  s1Input.disabled = true;

  if (val === s1.puzzle.answer) {
    const secs = state.elapsed - s1.startedAt;
    const bonus = Math.max(0, Math.round((10 - secs) * 50));
    addScore(1000 + bonus);
    sfx.good();
    flash('rgba(57,255,136,1)');
    document.querySelectorAll('#s1-pips i')[s1.round].classList.add('on');
    const unknown = document.querySelector('.seq-item.unknown');
    unknown.textContent = s1.puzzle.answer;
    unknown.classList.remove('unknown');
    s1Feedback.className = 'feedback good';
    s1Feedback.textContent = `FRAGMENT ACCEPTED · +${1000 + bonus}${bonus ? ' (speed bonus)' : ''}`;
    s1.round++;
    if (s1.round >= 3) {
      later(() => transition('LAYER 1 BREACHED', 'ROUTING TO SIGNAL BYPASS', startStage2), 700);
    } else {
      later(newPuzzle, 750);
    }
  } else {
    penalize(3);
    sfx.bad();
    shake($('#stage1 .panel'));
    s1Feedback.className = 'feedback bad';
    s1Feedback.textContent = `INVALID · −3s · the answer was ${s1.puzzle.answer}. Regenerating cipher...`;
    later(newPuzzle, 1400);
  }
});

/* =========================================================
   STAGE 2 — Signal Bypass (timing)
   ========================================================= */
const S2_WIDTHS = [0.2, 0.15, 0.115, 0.09];
const S2_SPEEDS = [0.6, 0.75, 0.9, 1.05];
const s2 = { hits: 0, pos: 0, dir: 1, winStart: 0, winWidth: 0.2, cooldown: 0, done: false };
const s2Window = $('#s2-window');
const s2Cursor = $('#s2-cursor');
const s2Track = $('#s2-track');
const s2Feedback = $('#s2-feedback');

function startStage2() {
  setStage(2);
  show('stage2');
  Object.assign(s2, { hits: 0, pos: 0, dir: 1, cooldown: 0, done: false });
  document.querySelectorAll('#s2-pips i').forEach((p) => p.classList.remove('on'));
  s2Feedback.className = 'feedback';
  s2Feedback.textContent = 'Press SPACE (or click INJECT) when the probe is inside the port.';
  newWindow();
}

function newWindow() {
  s2.winWidth = S2_WIDTHS[Math.min(s2.hits, S2_WIDTHS.length - 1)];
  let start;
  // keep the new port away from the probe so it can't be a free hit
  do { start = 0.04 + Math.random() * (0.92 - s2.winWidth); }
  while (Math.abs(start + s2.winWidth / 2 - s2.pos) < 0.2);
  s2.winStart = start;
  s2Window.style.left = `${start * 100}%`;
  s2Window.style.width = `${s2.winWidth * 100}%`;
}

function updateStage2(dt) {
  if (s2.done) return;
  s2.cooldown = Math.max(0, s2.cooldown - dt);
  const speed = S2_SPEEDS[Math.min(s2.hits, S2_SPEEDS.length - 1)];
  s2.pos += s2.dir * speed * dt;
  if (s2.pos >= 1) { s2.pos = 1; s2.dir = -1; }
  if (s2.pos <= 0) { s2.pos = 0; s2.dir = 1; }
  s2Cursor.style.left = `${s2.pos * 100}%`;
}

function trackFlash(cls) {
  s2Track.classList.remove('hit', 'miss');
  void s2Track.offsetWidth;
  s2Track.classList.add(cls);
  later(() => s2Track.classList.remove(cls), 300);
}

function inject() {
  if (state.screen !== 'stage2' || state.paused || s2.done || s2.cooldown > 0) return;
  s2.cooldown = 0.25;
  const end = s2.winStart + s2.winWidth;
  if (s2.pos >= s2.winStart && s2.pos <= end) {
    const center = s2.winStart + s2.winWidth / 2;
    const accuracy = 1 - Math.abs(s2.pos - center) / (s2.winWidth / 2);
    const bonus = Math.round(accuracy * 300);
    addScore(500 + bonus);
    sfx.good();
    trackFlash('hit');
    document.querySelectorAll('#s2-pips i')[s2.hits].classList.add('on');
    s2.hits++;
    s2Feedback.className = 'feedback good';
    s2Feedback.textContent = `${accuracy > 0.75 ? 'PERFECT INJECTION' : 'PORT BREACHED'} · +${500 + bonus}`;
    if (s2.hits >= 4) {
      s2.done = true;
      later(() => transition('LAYER 2 BREACHED', 'WARNING · FIREWALL AEGIS-9 ONLINE', startStage3), 600);
    } else {
      newWindow();
    }
  } else {
    penalize(2);
    sfx.bad();
    trackFlash('miss');
    shake($('#stage2 .panel'));
    s2Feedback.className = 'feedback bad';
    s2Feedback.textContent = 'PACKET REJECTED · −2s';
    newWindow();
  }
}
$('#s2-btn').addEventListener('click', (e) => { e.currentTarget.blur(); inject(); });

/* =========================================================
   STAGE 3 — Firewall boss (canvas)
   ========================================================= */
const arena = $('#arena');
const ac = arena.getContext('2d');
const AW = arena.width, AH = arena.height;
const keys = { left: false, right: false, fire: false };
const BOSS_HP = 30;

const s3 = {
  ended: true, px: AW / 2, py: AH - 46, target: null, mouseFire: false,
  shields: 3, inv: 0, fireCd: 0, shakeT: 0, t: 0,
  bullets: [], eb: [], parts: [], boss: null,
};

function startStage3() {
  setStage(3);
  show('stage3');
  Object.assign(s3, {
    ended: false, px: AW / 2, py: AH - 46, target: null, mouseFire: false,
    shields: 3, inv: 0, fireCd: 0, shakeT: 0, t: 0,
    bullets: [], eb: [], parts: [],
    boss: { x: AW / 2, y: 115, r: 46, hp: BOSS_HP, fireT: 1.3, pattern: 0, hitFlash: 0 },
  });
  renderShields();
  updateBossBar();
}

function renderShields() {
  $('#s3-shields').innerHTML = [0, 1, 2].map((i) => `<i class="${i < s3.shields ? '' : 'lost'}"></i>`).join('');
}
function updateBossBar() {
  $('#boss-fill').style.width = `${(Math.max(0, s3.boss.hp) / BOSS_HP) * 100}%`;
}

function burst(x, y, n, color, speed = 220, life = 0.6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    s3.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: 1.5 + Math.random() * 2.5 });
  }
}

function bossFire(angle, count, spread, speed) {
  const b = s3.boss;
  for (let i = 0; i < count; i++) {
    const a = angle + (i - (count - 1) / 2) * spread;
    s3.eb.push({ x: b.x, y: b.y + b.r * 0.5, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 7 });
  }
}

function bossAttack() {
  const b = s3.boss;
  const aim = Math.atan2(s3.py - b.y, s3.px - b.x);
  const enraged = b.hp <= BOSS_HP / 2;
  if (!enraged) {
    bossFire(aim, 3, 0.22, 270);
    b.fireT = 1.0;
  } else {
    b.pattern++;
    if (b.pattern % 2) {
      const n = 14, off = s3.t;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        s3.eb.push({ x: b.x, y: b.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, r: 7 });
      }
    } else {
      bossFire(aim, 5, 0.18, 300);
    }
    b.fireT = 0.85;
  }
  sfx.enemy();
}

function playerHit() {
  s3.shields--;
  s3.inv = 1.3;
  s3.shakeT = 0.35;
  renderShields();
  burst(s3.px, s3.py, 30, '255,51,85', 260);
  sfx.hurt();
  flash('rgba(255,51,85,1)');
  if (s3.shields <= 0) {
    s3.ended = true;
    state.paused = true;
    burst(s3.px, s3.py, 80, '255,51,85', 380, 1);
    later(() => finish(false, 'traced'), 900);
  }
}

function bossDefeated() {
  s3.ended = true;
  state.paused = true;
  addScore(3000);
  const b = s3.boss;
  burst(b.x, b.y, 140, '255,43,214', 480, 1.2);
  burst(b.x, b.y, 80, '34,230,255', 320, 1.0);
  burst(b.x, b.y, 50, '255,255,255', 200, 0.8);
  s3.eb = [];
  s3.shakeT = 0.8;
  sfx.boom();
  flash('rgba(255,255,255,1)');
  later(() => finish(true), 1600);
}

function updateStage3(dt) {
  if (!s3.boss) return;
  s3.t += dt;
  const b = s3.boss;

  if (!s3.ended) {
    const mv = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (mv) { s3.px += mv * 560 * dt; s3.target = null; }
    else if (s3.target !== null) {
      const d = s3.target - s3.px;
      s3.px += Math.sign(d) * Math.min(Math.abs(d), 720 * dt);
    }
    s3.px = clamp(s3.px, 22, AW - 22);

    s3.fireCd -= dt;
    if ((keys.fire || s3.mouseFire) && s3.fireCd <= 0) {
      s3.bullets.push({ x: s3.px, y: s3.py - 18 });
      s3.fireCd = 0.1;
      sfx.shoot();
    }

    b.x = AW / 2 + Math.sin(s3.t * 0.65) * AW * 0.3;
    b.y = 115 + Math.sin(s3.t * 1.9) * 22;
    b.fireT -= dt;
    if (b.fireT <= 0) bossAttack();
  }
  b.hitFlash = Math.max(0, b.hitFlash - dt);

  for (const p of s3.bullets) {
    p.y -= 1150 * dt;
    if (p.y < -20) p.dead = true;
    else if (!s3.ended && Math.hypot(p.x - b.x, p.y - b.y) < b.r + 12) {
      p.dead = true;
      b.hp--;
      b.hitFlash = 0.07;
      addScore(25);
      burst(p.x, p.y, 6, '57,255,136', 160, 0.35);
      sfx.hit();
      updateBossBar();
      if (b.hp <= 0) bossDefeated();
    }
  }
  s3.bullets = s3.bullets.filter((p) => !p.dead);

  for (const e of s3.eb) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.x < -20 || e.x > AW + 20 || e.y < -20 || e.y > AH + 20) e.dead = true;
    else if (!s3.ended && s3.inv <= 0 && Math.hypot(e.x - s3.px, e.y - s3.py) < e.r + 9) {
      e.dead = true;
      playerHit();
    }
  }
  s3.eb = s3.eb.filter((e) => !e.dead);

  for (const p of s3.parts) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= dt;
  }
  s3.parts = s3.parts.filter((p) => p.life > 0);

  s3.inv = Math.max(0, s3.inv - dt);
  s3.shakeT = Math.max(0, s3.shakeT - dt);

  drawArena();
}

function poly(x, y, r, sides, rot) {
  ac.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ac.lineTo(px, py) : ac.moveTo(px, py);
  }
}

function drawArena() {
  ac.save();
  ac.fillStyle = '#03060a';
  ac.fillRect(0, 0, AW, AH);
  if (s3.shakeT > 0) {
    const m = s3.shakeT * 18;
    ac.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  // scrolling grid
  ac.strokeStyle = 'rgba(34,230,255,0.07)';
  ac.lineWidth = 1;
  ac.beginPath();
  for (let x = 0; x <= AW; x += 40) { ac.moveTo(x + 0.5, 0); ac.lineTo(x + 0.5, AH); }
  const off = (s3.t * 60) % 40;
  for (let y = -40 + off; y <= AH; y += 40) { ac.moveTo(0, y + 0.5); ac.lineTo(AW, y + 0.5); }
  ac.stroke();

  // boss
  const b = s3.boss;
  if (b.hp > 0) {
    const enraged = b.hp <= BOSS_HP / 2;
    ac.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 ? -1 : 1;
      ac.strokeStyle = i === 1 ? 'rgba(255,43,214,0.85)' : `rgba(34,230,255,${0.8 - i * 0.2})`;
      ac.shadowColor = ac.strokeStyle;
      ac.shadowBlur = 12;
      poly(b.x, b.y, b.r + i * 14, 6, s3.t * dir * (0.8 + i * 0.5) * (enraged ? 2 : 1));
      ac.stroke();
    }
    const core = ac.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * 0.7);
    core.addColorStop(0, b.hitFlash > 0 ? '#ffffff' : '#ffd6f6');
    core.addColorStop(0.4, enraged ? '#ff3355' : '#ff2bd6');
    core.addColorStop(1, 'rgba(255,43,214,0)');
    ac.shadowBlur = 30;
    ac.shadowColor = enraged ? '#ff3355' : '#ff2bd6';
    ac.fillStyle = core;
    ac.beginPath();
    ac.arc(b.x, b.y, b.r * 0.7 * (1 + Math.sin(s3.t * 8) * 0.05), 0, Math.PI * 2);
    ac.fill();
    ac.shadowBlur = 0;
    ac.font = '12px "Share Tech Mono", monospace';
    ac.textAlign = 'center';
    ac.fillStyle = 'rgba(255,214,246,0.8)';
    ac.fillText(enraged ? 'AEGIS-9 // OVERLOAD' : 'AEGIS-9', b.x, b.y - b.r - 34);
  }

  // player bullets
  ac.strokeStyle = '#39ff88';
  ac.shadowColor = '#39ff88';
  ac.shadowBlur = 10;
  ac.lineWidth = 3;
  ac.beginPath();
  for (const p of s3.bullets) { ac.moveTo(p.x, p.y); ac.lineTo(p.x, p.y + 14); }
  ac.stroke();

  // enemy bullets
  ac.shadowColor = '#ff2bd6';
  for (const e of s3.eb) {
    ac.fillStyle = '#ff2bd6';
    ac.beginPath();
    ac.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ac.fill();
    ac.fillStyle = '#ffe0f8';
    ac.beginPath();
    ac.arc(e.x, e.y, e.r * 0.45, 0, Math.PI * 2);
    ac.fill();
  }

  // player
  const blink = s3.inv > 0 && Math.floor(s3.inv * 14) % 2 === 0;
  if (s3.shields > 0 && !blink) {
    const { px, py } = s3;
    ac.shadowColor = '#39ff88';
    ac.shadowBlur = 16;
    ac.fillStyle = 'rgba(34,230,255,0.8)';
    ac.beginPath();
    ac.moveTo(px - 5, py + 10);
    ac.lineTo(px, py + 20 + Math.random() * 8);
    ac.lineTo(px + 5, py + 10);
    ac.fill();
    ac.fillStyle = 'rgba(57,255,136,0.25)';
    ac.strokeStyle = '#39ff88';
    ac.lineWidth = 2;
    ac.beginPath();
    ac.moveTo(px, py - 18);
    ac.lineTo(px + 15, py + 14);
    ac.lineTo(px, py + 7);
    ac.lineTo(px - 15, py + 14);
    ac.closePath();
    ac.fill();
    ac.stroke();
  }

  // particles
  ac.shadowBlur = 0;
  for (const p of s3.parts) {
    ac.fillStyle = `rgba(${p.color},${p.life / p.max})`;
    ac.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ac.restore();
}

function arenaX(clientX) {
  const r = arena.getBoundingClientRect();
  return ((clientX - r.left) / r.width) * AW;
}
arena.addEventListener('pointermove', (e) => { s3.target = arenaX(e.clientX); });
arena.addEventListener('pointerdown', (e) => {
  s3.target = arenaX(e.clientX);
  s3.mouseFire = true;
  arena.setPointerCapture(e.pointerId);
});
window.addEventListener('pointerup', () => { s3.mouseFire = false; });
window.addEventListener('blur', () => { keys.left = keys.right = keys.fire = false; s3.mouseFire = false; });

/* =========================================================
   Input
   ========================================================= */
window.addEventListener('keydown', (e) => {
  const k = e.key;
  const lower = k.length === 1 ? k.toLowerCase() : k;

  if (lower === 'm') { e.preventDefault(); toggleMute(); return; }
  // let a focused button handle its own Enter so we don't trigger twice
  if (k === 'Enter' && e.target.tagName === 'BUTTON') return;

  switch (state.screen) {
    case 'title':
      if (k === 'Enter') { e.preventDefault(); startGame(); }
      break;
    case 'stage2':
      if (k === ' ' || k === 'Enter') { e.preventDefault(); if (!e.repeat) inject(); }
      break;
    case 'stage3':
      if (k === 'ArrowLeft' || lower === 'a') { keys.left = true; e.preventDefault(); }
      if (k === 'ArrowRight' || lower === 'd') { keys.right = true; e.preventDefault(); }
      if (k === ' ' || k === 'ArrowUp' || lower === 'w') { keys.fire = true; e.preventDefault(); }
      break;
    case 'end':
      if (lower === 'r' || k === 'Enter') { e.preventDefault(); startGame(); }
      break;
  }
});

window.addEventListener('keyup', (e) => {
  const lower = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.key === 'ArrowLeft' || lower === 'a') keys.left = false;
  if (e.key === 'ArrowRight' || lower === 'd') keys.right = false;
  if (e.key === ' ' || e.key === 'ArrowUp' || lower === 'w') keys.fire = false;
});

$('#start-btn').addEventListener('click', startGame);
$('#restart-btn').addEventListener('click', startGame);
$('#menu-btn').addEventListener('click', () => { Sound.init(); sfx.click(); goTitle(); });

/* =========================================================
   Main loop
   ========================================================= */
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state.running && !state.paused) {
    state.timeLeft -= dt;
    state.elapsed += dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      finish(false, 'lockdown');
    }
  }

  if (state.screen === 'stage2' && !state.paused) updateStage2(dt);
  if (state.screen === 'stage3') updateStage3(dt);
  if (state.running || state.screen !== 'end') updateHud();
  drawBg(dt);

  requestAnimationFrame(frame);
}

goTitle();
requestAnimationFrame(frame);
