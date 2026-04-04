'use strict';

// ─── State ───────────
const S = {
    screen: 'start', // 'start' | 'explore' | 'summary'
    location: '',
    timeOfDay: 'day',
    hour: new Date().getHours(),
    elapsed: 0, // seconds
    timerHandle: null,
    timerStart: null,
    discoveries: [], // { text, rarity, timestamp }
    fetchQueue: false,
    grass: [],
    discoveryPts: [],
    audioCtx: null,
    masterGain: null,
    dpr: devicePixelRatio || 1,
    raf: null,
    score: 0,
    windSpeed: 0,   // m/s from Open-Meteo
    windFactor: 0,  // normalised [0, 2.5]
    weatherCode: 0,
    isRaining: false,
    rainIntensity: 0, // 0..1
    rainDrops: [],
    rainGain: null,
    lbSubmitted: false,
};

// ─── DOM refs ────────
const canvas = document.getElementById('grass-canvas');
const ctx = canvas.getContext('2d');
const screens = {
    start: document.getElementById('screen-start'),
    explore: document.getElementById('screen-explore'),
    summary: document.getElementById('screen-summary'),
};
const hudTimer = document.getElementById('hud-timer');
const hudCount = document.getElementById('hud-count');
const hudLocation = document.getElementById('hud-location');
const hudLocRow = document.getElementById('hud-location-row');
const toast = document.getElementById('toast');

// ─── Utility ─────────
const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function showToast(msg, dur = 2200) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), dur);
}

function transitionTo(id) {
    const cur = screens[S.screen];
    cur.classList.add('fade-out');
    setTimeout(() => {
        cur.classList.remove('active', 'fade-out');
        S.screen = id;
        screens[id].classList.add('active');
    }, 420);
}

// ─── Time of Day ─────
const TIME_LABELS = {
    dawn: 'Dawn  🌅',
    morning: 'Morning  ☀️',
    day: 'Daytime  🌤️',
    dusk: 'Dusk  🌇',
    evening: 'Evening  🌆',
    night: 'Night  🌙',
};
const SKY_GRADIENTS = {
    dawn: [
        ['#ff9a6c', '0%'],
        ['#ffd0a8', '35%'],
        ['#ffe8cc', '70%'],
        ['#d4f8d4', '100%']
    ],
    morning: [
        ['#87ceeb', '0%'],
        ['#b2ebf2', '65%'],
        ['#ccffcc', '100%']
    ],
    day: [
        ['#4da6ff', '0%'],
        ['#87ceeb', '55%'],
        ['#ccffcc', '100%']
    ],
    dusk: [
        ['#ff7043', '0%'],
        ['#ffab76', '40%'],
        ['#b0bec5', '75%'],
        ['#a0c8a0', '100%']
    ],
    evening: [
        ['#283593', '0%'],
        ['#5c6bc0', '45%'],
        ['#7986cb', '75%'],
        ['#4a7a4a', '100%']
    ],
    night: [
        ['#0d1b2a', '0%'],
        ['#1b2e44', '45%'],
        ['#1a3d2e', '100%']
    ],
};
const GRASS_HUE = {
    dawn: 90,
    morning: 105,
    day: 115,
    dusk: 88,
    evening: 93,
    night: 100
};
const GRASS_SAT = {
    dawn: 45,
    morning: 60,
    day: 72,
    dusk: 40,
    evening: 28,
    night: 18
};
const GRASS_LIT = {
    dawn: 28,
    morning: 32,
    day: 35,
    dusk: 22,
    evening: 16,
    night: 11
};

function updateTimeOfDay() {
    const h = new Date().getHours();
    S.hour = h;
    if (h >= 5 && h < 7) S.timeOfDay = 'dawn';
    else if (h >= 7 && h < 10) S.timeOfDay = 'morning';
    else if (h >= 10 && h < 17) S.timeOfDay = 'day';
    else if (h >= 17 && h < 19) S.timeOfDay = 'dusk';
    else if (h >= 19 && h < 21) S.timeOfDay = 'evening';
    else S.timeOfDay = 'night';
    document.getElementById('time-badge-text').textContent = TIME_LABELS[S.timeOfDay];
}

// ─── Canvas / Grass ──
function resizeCanvas() {
    S.dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * S.dpr;
    canvas.height = innerHeight * S.dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.scale(S.dpr, S.dpr);
    initGrass();
    initDiscoveryPts();
    if (S.isRaining) initRain();
}

function grassColor() {
    const tod = S.timeOfDay;
    return `hsl(${GRASS_HUE[tod]+rand(-8,8)},${GRASS_SAT[tod]+rand(-10,10)}%,${GRASS_LIT[tod]+rand(-8,12)}%)`;
}

function initGrass() {
    const W = innerWidth,
        H = innerHeight;
    const n = Math.floor(W * H / 420);
    S.grass = [];
    for (let i = 0; i < n; i++) {
        S.grass.push({
            x: rand(0, W),
            by: H - rand(0, 180),
            h: rand(38, 75),
            w: rand(2, 4),
            angle: 0,
            targetAngle: 0,
            sway: rand(0, Math.PI * 2),
            swaySpd: rand(0.018, 0.04),
            swayAmp: rand(0.01, 0.03),
            tension: rand(0.10, 0.18),
            color: grassColor(),
        });
    }
    // foreground row
    for (let i = 0; i < Math.floor(n / 5); i++) {
        S.grass.push({
            x: rand(0, W),
            by: H + rand(0, 40),
            h: rand(55, 90),
            w: rand(2.5, 4.5),
            angle: 0,
            targetAngle: 0,
            sway: rand(0, Math.PI * 2),
            swaySpd: rand(0.015, 0.03),
            swayAmp: rand(0.012, 0.025),
            tension: rand(0.10, 0.16),
            color: grassColor(),
        });
    }
}

function initDiscoveryPts() {
    const W = innerWidth,
        H = innerHeight;
    S.discoveryPts = [];
    for (let i = 0; i < 6; i++) {
        S.discoveryPts.push({
            x: rand(80, W - 80),
            y: H - rand(10, 160),
            rarity: Math.random(),
        });
    }
}

// ─── Render loop ─────
let stars = null;

function drawSky() {
    const W = innerWidth,
        H = innerHeight;
    const stops = SKY_GRADIENTS[S.timeOfDay];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    stops.forEach(([color, pct]) => g.addColorStop(parseFloat(pct) / 100, color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

function drawCelestial() {
    const W = innerWidth,
        H = innerHeight;
    const tod = S.timeOfDay;
    if (tod === 'night' || tod === 'evening') {
        // Stars
        if (!stars) {
            stars = Array.from({
                length: 120
            }, () => ({
                x: rand(0, W),
                y: rand(0, H * 0.72),
                r: rand(0.5, 1.6),
                alpha: rand(0.5, 1),
                spd: rand(0.0003, 0.0008),
            }));
        }
        const t = Date.now() * 0.001;
        stars.forEach(s => {
            const a = s.alpha * (0.75 + 0.25 * Math.sin(t * s.spd * 1000));
            ctx.fillStyle = `rgba(255,255,255,${a})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        });
        // Moon
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.shadowColor = 'rgba(200,255,200,0.4)';
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(W * 0.82, H * 0.17, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tod === 'night' ? '#0d1b2a' : '#283593';
        ctx.beginPath();
        ctx.arc(W * 0.82 + 12, H * 0.17, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    } else if (tod === 'day' || tod === 'morning' || tod === 'dawn') {
        ctx.save();
        const sunY = tod === 'dawn' ? H * 0.35 : tod === 'morning' ? H * 0.22 : H * 0.16;
        ctx.fillStyle = tod === 'dawn' ? '#ff8c42' : '#ffe066';
        ctx.shadowColor = tod === 'dawn' ? 'rgba(255,140,66,0.5)' : 'rgba(255,224,66,0.5)';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(W * 0.82, sunY, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawGrass() {
    const windLean = S.windFactor * 0.14;               // directional lean (radians)
    const windAmpMult = 1 + S.windFactor * 0.7;         // sway amplitude multiplier
    S.grass.forEach(b => {
        b.sway += b.swaySpd;
        const naturalSway = Math.sin(b.sway) * b.swayAmp * windAmpMult + windLean;
        const diff = b.targetAngle - b.angle;
        b.angle += diff * b.tension;

        ctx.save();
        ctx.translate(b.x, b.by);
        ctx.rotate(b.angle + naturalSway);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(b.w / 2, -b.h / 2, 0, -b.h);
        ctx.quadraticCurveTo(-b.w / 2, -b.h / 2, 0, 0);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.restore();
    });
}

function initRain() {
    const W = innerWidth, H = innerHeight;
    const count = Math.floor(180 + S.rainIntensity * 420);
    const spd = 11 + S.rainIntensity * 9;
    S.rainDrops = Array.from({ length: count }, () => ({
        x: rand(0, W + 100),
        y: rand(-H, H),
        speed: rand(spd * 0.8, spd * 1.2),
        len: rand(9, 18) * (0.6 + S.rainIntensity * 0.6),
        alpha: rand(0.18, 0.45) * (0.5 + S.rainIntensity * 0.6),
    }));
}

function drawRain() {
    if (!S.isRaining || !S.rainDrops.length) return;
    const H = innerHeight, W = innerWidth;
    ctx.save();
    ctx.strokeStyle = 'rgba(174, 214, 241, 1)';
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.28 + S.rainIntensity * 0.32;
    ctx.beginPath();
    S.rainDrops.forEach(d => {
        d.y += d.speed;
        d.x -= d.speed * 0.2; // slight diagonal drift
        if (d.y > H + 20) { d.y = rand(-80, -5); d.x = rand(0, W + 80); }
        if (d.x < -20) d.x += W + 100;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.2, d.y + d.len);
    });
    ctx.stroke();
    ctx.restore();
}

function render() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    drawSky();
    drawCelestial();
    drawGrass();
    drawRain();
    S.raf = requestAnimationFrame(render);
}

// ─── Interaction ─────
function pointerHandler(cx, cy) {
    const RADIUS = 130; // Manhattan radius — diamond-shaped interaction area

    // Grass reacts on all screens
    S.grass.forEach(b => {
        const dist = Math.abs(b.x - cx) + Math.abs(b.by - cy);
        if (dist < RADIUS) {
            const str = (RADIUS - dist) / RADIUS;
            b.targetAngle = Math.atan2(b.x - cx, 40) * str * 1.1;
        } else {
            b.targetAngle = 0;
        }
    });

    if (S.screen !== 'explore') return;

    // Check discovery points (Manhattan, scaled so hit-feel matches old circle)
    S.discoveryPts.forEach((pt, i) => {
        if (Math.abs(pt.x - cx) + Math.abs(pt.y - cy) < 68) {
            triggerDiscovery(pt.x, pt.y, pt.rarity);
            // Respawn
            S.discoveryPts[i] = {
                x: rand(80, innerWidth - 80),
                y: innerHeight - rand(10, 160),
                rarity: Math.random(),
            };
            spawnRipple(cx, cy);
        }
    });
}

function resetGrassBend() {
    S.grass.forEach(b => b.targetAngle = 0);
}

document.addEventListener('mousemove', e => pointerHandler(e.clientX, e.clientY));
canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    pointerHandler(e.touches[0].clientX, e.touches[0].clientY);
}, {
    passive: false
});
canvas.addEventListener('mouseleave', resetGrassBend);
canvas.addEventListener('touchend', resetGrassBend);
canvas.addEventListener('click', e => {
    if (S.screen === 'explore') pointerHandler(e.clientX, e.clientY);
});

function spawnRipple(x, y) {
    const el = document.createElement('div');
    el.className = 'ripple';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
}

// ─── Discovery API ───
async function triggerDiscovery(x, y, rarity) {
    if (S.fetchQueue) return;
    S.fetchQueue = true;

    try {
        const res = await fetch('/api/discovery', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                location: S.location,
                timeOfDay: S.timeOfDay,
                rarity,
                recent: S.discoveries.slice(-4).map(d => d.text),
            }),
        });
        const {
            text,
            rarityLabel
        } = await res.json();
        if (!text) return;

        S.discoveries.push({
            text,
            rarity: rarityLabel,
            timestamp: S.elapsed
        });
        const PTS = { common: 1, uncommon: 2, rare: 3 };
        S.score += PTS[rarityLabel] ?? 0;
        hudCount.textContent = S.discoveries.length;

        showChip(text, rarityLabel, x, y);
        playDiscovery(rarity);
    } catch (err) {
        console.error(err);
    } finally {
        setTimeout(() => S.fetchQueue = false, 500);
    }
}

function showChip(text, rarityLabel, x, y) {
    const el = document.createElement('div');
    el.className = `discovery-chip chip-${rarityLabel}`;
    el.style.left = clamp(x, 90, innerWidth - 90) + 'px';
    el.style.top = (y - 20) + 'px';
    el.textContent = `✦ You've found ${text}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
}

// ─── Audio ───────────
function initAudio() {
    if (S.audioCtx) return;
    S.audioCtx = new(window.AudioContext || window.webkitAudioContext)();
    S.masterGain = S.audioCtx.createGain();
    S.masterGain.gain.value = 0;
    S.masterGain.connect(S.audioCtx.destination);

    // Wind noise
    const buf = S.audioCtx.createBuffer(1, 2 * S.audioCtx.sampleRate, S.audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const wind = S.audioCtx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const wf = S.audioCtx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 400;
    const wg = S.audioCtx.createGain();
    wg.gain.value = 0.25;
    wind.connect(wf);
    wf.connect(wg);
    wg.connect(S.masterGain);
    wind.start();

    // Rain noise (bandpass filtered white noise, bypasses masterGain for independent volume)
    const rainBuf = S.audioCtx.createBuffer(1, 2 * S.audioCtx.sampleRate, S.audioCtx.sampleRate);
    const rainData = rainBuf.getChannelData(0);
    for (let i = 0; i < rainData.length; i++) rainData[i] = Math.random() * 2 - 1;
    const rainSrc = S.audioCtx.createBufferSource();
    rainSrc.buffer = rainBuf;
    rainSrc.loop = true;
    const rainHp = S.audioCtx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 800;
    const rainLp = S.audioCtx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 4000;
    S.rainGain = S.audioCtx.createGain();
    S.rainGain.gain.value = 0;
    rainSrc.connect(rainHp);
    rainHp.connect(rainLp);
    rainLp.connect(S.rainGain);
    S.rainGain.connect(S.audioCtx.destination);
    rainSrc.start();

    // Bird chirps
    setInterval(() => {
        const h = S.hour;
        const p = h >= 5 && h < 9 ? 0.65 : h >= 9 && h < 17 ? 0.35 : h >= 17 && h < 19 ? 0.25 : 0.04;
        if (Math.random() < p && S.screen === 'explore') chirp();
    }, 2200);

    // Wind gusts — frequency and volume scale with live windFactor
    const gustBuf = S.audioCtx.createBuffer(1, Math.ceil(S.audioCtx.sampleRate * 1.5), S.audioCtx.sampleRate);
    const gustData = gustBuf.getChannelData(0);
    for (let i = 0; i < gustData.length; i++) gustData[i] = Math.random() * 2 - 1;
    S.gustBuf = gustBuf;

    setInterval(() => {
        if (S.windFactor > 0.05 && S.screen === 'explore') windGust();
    }, 2400);
}

function setRain(on) {
    if (!S.rainGain || !S.audioCtx) return;
    const vol = on ? 0.18 + S.rainIntensity * 0.22 : 0;
    S.rainGain.gain.linearRampToValueAtTime(vol, S.audioCtx.currentTime + 2);
}

function setAmbient(on) {
    if (!S.masterGain || !S.audioCtx) return;
    const vol = on ? (S.timeOfDay === 'night' || S.timeOfDay === 'evening' ? 0.14 : 0.1) : 0;
    S.masterGain.gain.linearRampToValueAtTime(vol, S.audioCtx.currentTime + 1);
}

function chirp() {
    const ac = S.audioCtx;
    const o = ac.createOscillator(),
        g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = rand(2000, 3000);
    const t = ac.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g);
    g.connect(S.masterGain);
    o.start(t);
    o.stop(t + 0.14);
}

function windGust() {
    const ac = S.audioCtx;
    if (!ac || !S.gustBuf) return;
    const src = ac.createBufferSource();
    src.buffer = S.gustBuf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320 + S.windFactor * 180; // brighter tone when windier
    const g = ac.createGain();
    const vol = Math.min(S.windFactor * 0.14, 0.38);
    const dur = 0.5 + S.windFactor * 0.5;
    const t = ac.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(S.masterGain);
    src.start(t);
    src.stop(t + dur + 0.05);
}

function playDiscovery(rarity) {
    const ac = S.audioCtx;
    if (!ac) return;
    const t = ac.currentTime;
    if (rarity < 0.7) {
        const o = ac.createOscillator(),
            g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = 1600;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.06, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.connect(g);
        g.connect(S.masterGain);
        o.start(t);
        o.stop(t + 0.18);
    } else if (rarity < 0.9) {
        [0, 0.06].forEach(delay => {
            const o = ac.createOscillator(),
                g = ac.createGain();
            o.type = 'sine';
            o.frequency.value = 2000 + delay * 5000;
            g.gain.setValueAtTime(0, t + delay);
            g.gain.linearRampToValueAtTime(0.05, t + delay + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.22);
            o.connect(g);
            g.connect(S.masterGain);
            o.start(t + delay);
            o.stop(t + delay + 0.22);
        });
    } else {
        [800, 1200, 1600].forEach((freq, i) => {
            const o = ac.createOscillator(),
                g = ac.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            const d = i * 0.06;
            g.gain.setValueAtTime(0, t + d);
            g.gain.linearRampToValueAtTime(0.04, t + d + 0.05);
            g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.9);
            o.connect(g);
            g.connect(S.masterGain);
            o.start(t + d);
            o.stop(t + d + 0.9);
        });
    }
}

// ─── Weather ─────────
// WMO code → rain intensity (0 = dry, >0 = raining)
const RAIN_CODES = {
    51: 0.25, 53: 0.45, 55: 0.65,          // drizzle
    61: 0.40, 63: 0.70, 65: 1.00,           // rain
    80: 0.50, 81: 0.75, 82: 1.00,           // showers
    95: 0.90, 96: 1.00, 99: 1.00,           // thunderstorm
};

async function fetchWeather(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=windspeed_10m,weathercode&windspeed_unit=ms`;
        const res = await fetch(url);
        const data = await res.json();
        S.windSpeed = data.current?.windspeed_10m ?? 0;
        S.windFactor = Math.min(S.windSpeed / 6, 2.5);
        S.weatherCode = data.current?.weathercode ?? 0;
        S.rainIntensity = RAIN_CODES[S.weatherCode] ?? 0;
        S.isRaining = S.rainIntensity > 0;
        if (S.isRaining) initRain();
        setRain(S.isRaining);
        updateWeatherHUD();
    } catch (e) {
        console.warn('Weather unavailable', e);
    }
}

function updateWeatherHUD() {
    const row = document.getElementById('hud-weather-row');
    const val = document.getElementById('hud-wind');
    if (!row || !val) return;
    row.style.display = 'flex';
    const ws = S.windSpeed;
    const icon = ws < 1 ? '🍃' : ws < 4 ? '🌬️' : ws < 9 ? '💨' : '🌪️';
    const label = ws < 1 ? 'Calm' : ws < 4 ? 'Breezy' : ws < 9 ? 'Windy' : 'Very Windy';
    val.textContent = `${icon} ${ws.toFixed(1)} m/s · ${label}`;
}

// ─── Leaderboard ─────
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchLeaderboard() {
    try {
        const res = await fetch('/api/leaderboard');
        if (!res.ok) return [];
        return await res.json();
    } catch { return []; }
}

async function submitToLeaderboard(username) {
    const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            score: S.score,
            discoveries: S.discoveries.length,
            time_seconds: S.elapsed,
            rare_finds: S.discoveries.filter(d => d.rarity === 'rare').length,
            location: S.location,
        }),
    });
    return res.ok;
}

async function renderLeaderboard() {
    const list = document.getElementById('lb-list');
    if (!list) return;
    list.innerHTML = '<div class="lb-loading">Loading…</div>';
    const rows = await fetchLeaderboard();
    if (!rows.length) {
        list.innerHTML = '<div class="lb-loading">No scores yet — be the first!</div>';
        return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const table = document.createElement('table');
    table.className = 'lb-table';
    table.innerHTML = `<thead><tr><th>#</th><th>Name</th><th>Score</th><th>Finds</th><th>Time</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="lb-rank">${medals[i] || i + 1}</td>
            <td>${escHtml(r.username)}</td>
            <td><strong>${r.score ?? '—'}</strong></td>
            <td>${r.discoveries}</td>
            <td>${fmt(r.time_seconds)}</td>`;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    list.innerHTML = '';
    list.appendChild(table);
}

// ─── Timer ───────────
function startTimer() {
    S.timerStart = Date.now() - S.elapsed * 1000;
    S.timerHandle = setInterval(() => {
        S.elapsed = Math.floor((Date.now() - S.timerStart) / 1000);
        hudTimer.textContent = fmt(S.elapsed);
    }, 1000);
}

function stopTimer() {
    clearInterval(S.timerHandle);
}

// ─── Locations ───────
const LOCATIONS = [
    // Parks & Nature
    'Singapore Botanic Gardens',
    'East Coast Park',
    'West Coast Park',
    'Bishan-Ang Mo Kio Park',
    'Bedok Reservoir Park',
    'Jurong Lake Gardens',
    'MacRitchie Reservoir Park',
    'Pasir Ris Park',
    'Punggol Waterway Park',
    'Sengkang Riverside Park',
    'Fort Canning Park',
    'Labrador Nature Reserve',
    'Buona Vista Park',
    'Clementi Woods',
    'Telok Blangah Hill Park',
    // Iconic Green Spaces
    'Gardens by the Bay',
    'Hort Park',
    'Kent Ridge Park',
    'Southern Ridges',
    'Admiralty Park',
    // Neighbourhoods & Estates
    'Tampines Eco Green',
    'Coney Island Park',
    'Chestnut Nature Park',
    'Rifle Range Nature Park',
    'Rail Corridor',
    // School Fields & Community
    'Padang',
    'Kallang Practice Track',
    'Toa Payoh Town Park',
    'Ang Mo Kio Town Garden',
    'Woodlands Waterfront Park',
];

document.getElementById('shuffle-btn').addEventListener('click', () => {
    const cur = document.getElementById('location-input').value;
    const filtered = LOCATIONS.filter(l => l !== cur);
    document.getElementById('location-input').value = filtered[Math.floor(Math.random() * filtered.length)];
});

// ─── Screen transitions
document.getElementById('start-btn').addEventListener('click', () => {
    initAudio();
    if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
    S.location = document.getElementById('location-input').value.trim();
    S.elapsed = 0;
    S.discoveries = [];
    S.score = 0;
    S.lbSubmitted = false;
    hudCount.textContent = '0';
    hudTimer.textContent = '0:00';
    if (S.location) {
        hudLocRow.style.display = 'flex';
        hudLocation.textContent = S.location;
    } else {
        hudLocRow.style.display = 'none';
    }
    // Reset weather HUD until new fetch completes
    const weatherRow = document.getElementById('hud-weather-row');
    if (weatherRow) weatherRow.style.display = 'none';

    // Fetch live weather via geolocation (Singapore fallback)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
            ()  => fetchWeather(1.3521, 103.8198),
            { timeout: 6000 }
        );
    } else {
        fetchWeather(1.3521, 103.8198);
    }

    transitionTo('explore');
    startTimer();
    setAmbient(true);
});

document.getElementById('go-inside-btn').addEventListener('click', () => {
    stopTimer();
    setAmbient(false);
    setRain(false);
    buildSummary();
    transitionTo('summary');
});

document.getElementById('play-again-btn').addEventListener('click', () => {
    setRain(false);
    S.isRaining = false;
    S.rainDrops = [];
    transitionTo('start');
});

// ─── Summary ─────────
function buildSummary() {
    document.getElementById('stat-time').textContent = fmt(S.elapsed);
    document.getElementById('stat-count').textContent = S.discoveries.length;
    document.getElementById('stat-score').textContent = S.score;
    document.getElementById('summary-location').textContent =
        S.location ? `Adventure at ${S.location}` : 'A wild grass adventure!';

    const list = document.getElementById('discoveries-list');
    list.innerHTML = '';

    if (!S.discoveries.length) {
        list.innerHTML = `<div class="empty-state"><div class="emoji">🏆</div>Achievement unlocked:<br><strong>Professional Grass Avoider</strong></div>`;
        return;
    }

    ['rare', 'uncommon', 'common'].forEach(r => {
        const items = S.discoveries.filter(d => d.rarity === r);
        if (!items.length) return;
        const sec = document.createElement('div');
        sec.className = 'rarity-section';
        sec.innerHTML = `<span class="rarity-label ${r}">${r.toUpperCase()} FINDS</span>`;
        items.forEach(d => {
            const row = document.createElement('div');
            row.className = 'discovery-item';
            row.innerHTML = `
        <div style="display:flex;align-items:center">
          <span class="dot dot-${r}"></span>
          <span class="name">You've found ${d.text}</span>
        </div>
        <span class="time">${fmt(d.timestamp)}</span>`;
            sec.appendChild(row);
        });
        list.appendChild(sec);
    });

    // Leaderboard
    const lbSection = document.getElementById('leaderboard-section');
    if (lbSection) lbSection.style.display = '';
    const submitRow = document.getElementById('lb-submit-row');
    if (submitRow) submitRow.style.display = S.lbSubmitted ? 'none' : 'flex';
    const submitBtn = document.getElementById('lb-submit-btn');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🏆 Submit'; }
    renderLeaderboard();
}

document.getElementById('lb-submit-btn').addEventListener('click', async () => {
    const username = document.getElementById('lb-username').value.trim();
    if (!username) { showToast('Enter a name first!'); return; }
    const btn = document.getElementById('lb-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    const ok = await submitToLeaderboard(username);
    if (ok) {
        S.lbSubmitted = true;
        showToast('Score submitted! 🏆');
        document.getElementById('lb-submit-row').style.display = 'none';
        renderLeaderboard();
    } else {
        showToast('Could not submit — try again.');
        btn.disabled = false;
        btn.textContent = '🏆 Submit';
    }
});

document.getElementById('share-btn').addEventListener('click', () => {
    const rare = S.discoveries.filter(d => d.rarity === 'rare').map(d => d.text).join(', ') || 'nothing rare';
    const loc = S.location ? `📍 ${S.location}\n` : '';
    const text = `🌿 Touch Grass Simulator\n${loc}⏱ ${fmt(S.elapsed)} outside\n✨ ${S.discoveries.length} discoveries · ${S.score} pts\n⭐ Rare: ${rare}\n\nhttps://grass.uwuapps.org`;
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
});

// ─── PWA Install ─────
let deferredPrompt = null;
const installBanner = document.getElementById('install-banner');

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('installDismissed')) {
        installBanner.classList.add('show');
    }
});

document.getElementById('install-btn').addEventListener('click', () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
            deferredPrompt = null;
            installBanner.classList.remove('show');
        });
    }
});

document.getElementById('dismiss-install').addEventListener('click', () => {
    localStorage.setItem('installDismissed', '1');
    installBanner.classList.remove('show');
});

// ─── Service Worker ──
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ─── Init ────────────
updateTimeOfDay();
setInterval(updateTimeOfDay, 60000);
resizeCanvas();
window.addEventListener('resize', () => { resizeCanvas(); stars = null; });
render();