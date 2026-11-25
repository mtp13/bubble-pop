"use strict";

// Bubble Pop: bubbles float up, each with an animal inside. Tap one to pop it
// and the animal says hello. Every tap does something, and there's no losing.
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("start-btn");
  const muteBtn = document.getElementById("mute-btn");
  const voiceBtn = document.getElementById("voice-btn");

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  const store = {
    get(key, fallback) {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // storage blocked
      }
    },
  };

  const ANIMALS = [
    ["🐶", "Puppy"],
    ["🐱", "Kitty"],
    ["🐰", "Bunny"],
    ["🐻", "Bear"],
    ["🐼", "Panda"],
    ["🐸", "Frog"],
    ["🐵", "Monkey"],
    ["🐷", "Piggy"],
    ["🐮", "Cow"],
    ["🦁", "Lion"],
    ["🐯", "Tiger"],
    ["🐨", "Koala"],
    ["🐥", "Chick"],
    ["🦆", "Duck"],
    ["🐢", "Turtle"],
    ["🐠", "Fish"],
    ["🐘", "Elephant"],
    ["🦒", "Giraffe"],
    ["🦄", "Unicorn"],
    ["🐙", "Octopus"],
    ["🦋", "Butterfly"],
    ["🐞", "Ladybug"],
    ["🐴", "Horse"],
    ["🐑", "Sheep"],
  ];
  const COLORS = [
    "#f87171",
    "#fb923c",
    "#facc15",
    "#4ade80",
    "#38bdf8",
    "#a78bfa",
    "#f472b6",
  ];
  // C major pentatonic: any two notes sound nice together.
  const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];

  // ---------- sound and speech ----------
  let audio = null;
  let muted = store.get("bubble-pop-muted", "0") === "1";
  let talking = store.get("bubble-pop-voice", "1") === "1";

  function tone(freq, duration = 0.35, type = "sine", volume = 0.15) {
    if (muted) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + duration);
    } catch {
      // no audio
    }
  }

  function popSound() {
    if (muted) return;
    tone(rand(700, 900), 0.08, "triangle", 0.2);
    setTimeout(() => tone(pick(NOTES), 0.4), 40);
  }

  let lastSpoken = 0;
  let utterance = null;
  let speechReady = false;
  function say(text) {
    if (muted || !talking || !("speechSynthesis" in window)) return;
    const now = performance.now();
    if (now - lastSpoken < 700) return; // don't pile up words on fast taps
    lastSpoken = now;
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
      }
      // iOS can leave the queue paused after an interruption (a call, the
      // screen locking), which silently swallows everything after it.
      speechSynthesis.resume();
      // Keep a reference: Safari can drop an utterance that gets
      // garbage-collected before it finishes.
      utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1.3;
      speechSynthesis.speak(utterance);
    } catch {
      // no speech
    }
  }

  function updateButtons() {
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    voiceBtn.textContent = talking ? "🗣️" : "🤐";
    voiceBtn.setAttribute(
      "aria-label",
      talking ? "Turn off talking" : "Turn on talking",
    );
  }

  function stopTalking() {
    try {
      speechSynthesis.cancel();
    } catch {
      // no speech
    }
  }
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    store.set("bubble-pop-muted", muted ? "1" : "0");
    updateButtons();
    if (muted) stopTalking();
    else tone(660, 0.15); // confirm straight away, mid-game too
  });
  voiceBtn.addEventListener("click", () => {
    talking = !talking;
    store.set("bubble-pop-voice", talking ? "1" : "0");
    if (talking && muted) {
      // Talking is a sound, so turning it on turns the sound back on too.
      muted = false;
      store.set("bubble-pop-muted", "0");
    }
    updateButtons();
    if (!talking) {
      stopTalking();
      return;
    }
    // Speak right away, from this tap. That confirms it works, and on an
    // iPhone it is what allows the game to talk again mid-game.
    lastSpoken = 0;
    say("Talking is on!");
  });

  // ---------- world ----------
  let width = 0;
  let height = 0;
  let bubbles = [];
  let critters = []; // animals freed from bubbles
  let particles = [];
  let sparkles = [];
  let popped = 0;
  let party = 0; // celebration timer
  let spawnTimer = 0;
  let playing = false;
  let time = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  const baseRadius = () => Math.max(42, Math.min(width, height) * 0.11);

  function spawnBubble(y = height + 80) {
    const r = baseRadius() * rand(0.85, 1.2);
    const [emoji, name] = pick(ANIMALS);
    bubbles.push({
      x: rand(r, width - r),
      y,
      r,
      vy: rand(35, 60),
      wobble: rand(0, TAU),
      color: pick(COLORS),
      emoji,
      name,
    });
  }

  function popBubble(b) {
    bubbles.splice(bubbles.indexOf(b), 1);
    popped++;
    popSound();
    say(b.name);
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU);
      const sp = rand(80, 260);
      particles.push({
        x: b.x + Math.cos(a) * b.r,
        y: b.y + Math.sin(a) * b.r,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.7,
        color: b.color,
        size: rand(4, 9),
      });
    }
    critters.push({
      x: b.x,
      y: b.y,
      vy: -60,
      size: b.r * 1.3,
      emoji: b.emoji,
      life: 1.6,
      spin: rand(-1, 1),
    });
    if (popped % 25 === 0) celebrate();
  }

  function celebrate() {
    party = 3;
    say("Hooray!");
    [0, 1, 2, 3, 4].forEach((i) =>
      setTimeout(() => tone(NOTES[i + 2], 0.5), i * 120),
    );
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: rand(0, width),
        y: rand(-200, 0),
        vx: rand(-40, 40),
        vy: rand(100, 300),
        life: 3,
        color: pick(COLORS),
        size: rand(6, 12),
        confetti: true,
        rot: rand(0, TAU),
      });
    }
  }

  function tapEmpty(x, y) {
    tone(pick(NOTES) / 2, 0.3, "sine", 0.08);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      sparkles.push({
        x,
        y,
        vx: Math.cos(a) * 120,
        vy: Math.sin(a) * 120,
        life: 0.6,
        color: pick(COLORS),
      });
    }
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (!playing) return;
    ev.preventDefault();
    const x = ev.clientX;
    const y = ev.clientY;
    // Be generous: small fingers miss, so the hit area is bigger than the bubble.
    let best = null;
    let bestD = Infinity;
    for (const b of bubbles) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < b.r * 1.3 && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    if (best) popBubble(best);
    else tapEmpty(x, y);
  });
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  startBtn.addEventListener("click", () => {
    overlay.hidden = true;
    playing = true;
    guardHistory();
    tone(NOTES[0], 0.2);
    say("Pop the bubbles!");
  });

  // ---------- loop ----------
  function update(dt) {
    time += dt;
    spawnTimer -= dt;
    const target = Math.max(
      4,
      Math.min(9, Math.floor((width * height) / 70000)),
    );
    if (spawnTimer <= 0 && bubbles.length < target) {
      spawnBubble();
      spawnTimer = rand(0.5, 1.2);
    }
    for (const b of bubbles) {
      b.y -= b.vy * dt;
      b.wobble += dt * 1.5;
      b.x += Math.sin(b.wobble) * 20 * dt;
    }
    // Bubbles that float away come back from the bottom.
    bubbles = bubbles.filter((b) => b.y > -b.r * 2);

    for (const c of critters) {
      c.y += c.vy * dt;
      c.life -= dt;
    }
    critters = critters.filter((c) => c.life > 0);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.confetti) {
        p.vx *= 0.94;
        p.vy = p.vy * 0.94 + 200 * dt;
      } else {
        p.rot += dt * 4;
      }
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const s of sparkles) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }
    sparkles = sparkles.filter((s) => s.life > 0);
    party = Math.max(0, party - dt);
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, "#8fd8ff");
    g.addColorStop(1, "#e0f7ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    // soft clouds
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 4; i++) {
      const cx = ((time * 12 + i * 300) % (width + 300)) - 150;
      const cy = 80 + i * 110;
      for (const [dx, dy, r] of [
        [0, 0, 30],
        [30, -10, 38],
        [65, 0, 30],
      ]) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, r, 0, TAU);
        ctx.fill();
      }
    }
    // grass
    ctx.fillStyle = "#86efac";
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + 40; x += 40) {
      ctx.lineTo(x, height - 30 - Math.sin(x * 0.02 + 1) * 10);
    }
    ctx.lineTo(width, height);
    ctx.fill();
  }

  function drawBubble(b) {
    const g = ctx.createRadialGradient(
      b.x - b.r * 0.3,
      b.y - b.r * 0.3,
      b.r * 0.1,
      b.x,
      b.y,
      b.r,
    );
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.35, b.color + "66");
    g.addColorStop(1, b.color + "cc");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = `${Math.round(b.r * 1.05)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.emoji, b.x, b.y + b.r * 0.06);
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(
      b.x - b.r * 0.45,
      b.y - b.r * 0.45,
      b.r * 0.16,
      b.r * 0.09,
      -0.8,
      0,
      TAU,
    );
    ctx.fill();
  }

  function draw() {
    drawBackground();
    for (const b of bubbles) drawBubble(b);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of critters) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.life);
      ctx.translate(c.x, c.y);
      const grow = 1 + (1.6 - c.life) * 0.4;
      ctx.rotate(Math.sin((1.6 - c.life) * 6) * 0.25 * c.spin);
      ctx.scale(grow, grow);
      ctx.font = `${Math.round(c.size)}px sans-serif`;
      ctx.fillText(c.emoji, 0, 0);
      ctx.restore();
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      if (p.confetti) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, TAU);
        ctx.fill();
      }
    }
    for (const s of sparkles) {
      ctx.globalAlpha = s.life / 0.6;
      ctx.fillStyle = s.color;
      ctx.font = "22px sans-serif";
      ctx.fillText("★", s.x, s.y);
    }
    ctx.globalAlpha = 1;

    if (playing && popped > 0) {
      ctx.font = "bold 26px 'Roboto Mono', monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#1e3a5f";
      ctx.fillText(`🫧 ${popped}`, width - 14, 12);
    }
    if (party > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, party);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const s = 1 + Math.sin(time * 8) * 0.06;
      ctx.translate(width / 2, height * 0.35);
      ctx.scale(s, s);
      ctx.font = `bold ${Math.round(Math.min(width, 700) / 9)}px 'Roboto Mono', monospace`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#fff";
      ctx.strokeText("Hooray!", 0, 0);
      ctx.fillStyle = "#ec4899";
      ctx.fillText("Hooray!", 0, 0);
      ctx.restore();
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  updateButtons();
  // Fill the screen with a few bubbles straight away.
  for (let i = 0; i < 5; i++) spawnBubble(rand(height * 0.3, height));
  startBtn.focus({ preventScroll: true });
  requestAnimationFrame(frame);

  // ---------- touch-screen kid-proofing ----------
  // Little hands tap fast and start swipes at the very edge of the screen. On
  // an iPhone that zooms the page, or swipes back through history mid-game.
  // style.css also sets `touch-action: manipulation` to stop double-tap zoom.
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (ev) => {
      // A second tap within 350 ms is a double tap: don't let it zoom. Links
      // and buttons are left alone so they still click.
      const onControl = ev.target.closest?.("a, button");
      if (ev.timeStamp - lastTouchEnd < 350 && !onControl) ev.preventDefault();
      lastTouchEnd = ev.timeStamp;
    },
    { passive: false },
  );
  // Safari's pinch zoom.
  document.addEventListener("gesturestart", (ev) => ev.preventDefault());
  document.addEventListener(
    "touchstart",
    (ev) => {
      // Safari's back/forward swipe starts with a touch at the very edge.
      const x = ev.touches[0]?.clientX ?? window.innerWidth / 2;
      const atEdge = x < 24 || x > window.innerWidth - 24;
      if (atEdge && !ev.target.closest?.("a, button")) ev.preventDefault();
    },
    { passive: false },
  );

  // Once a game starts, a back swipe that still gets through lands back on the
  // game instead of leaving it. The ← link still leaves.
  let guardingHistory = false;
  function guardHistory() {
    if (guardingHistory) return;
    guardingHistory = true;
    try {
      history.pushState({ inGame: true }, "");
      window.addEventListener("popstate", () =>
        history.pushState({ inGame: true }, ""),
      );
    } catch {
      // history unavailable
    }
  }

  // iPhones only let sound start from a finished tap (touchend or click), not
  // from pointerdown, so wake the audio on every finished tap and key press.
  function wakeAudio() {
    if (muted) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== "running") audio.resume();
    } catch {
      // no audio
    }
    // Speech has the same rule: the first words must come from a finished tap.
    if (!speechReady && "speechSynthesis" in window) {
      speechReady = true;
      try {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch {
        // no speech
      }
    }
  }
  for (const type of ["touchend", "click", "keydown"]) {
    document.addEventListener(type, wakeAudio, true);
  }
})();
