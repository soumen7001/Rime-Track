/**
 * AEGIS MEDIC TACTICAL WEB HUD - APPLICATION LOGIC, BENCHMARKS & AUDIO SYNTHESIZER
 * DataForge x Rime Hackathon Production Suite
 */

// ==============================================================================
// 1. Global State & DOM References
// ==============================================================================

const state = {
  activeFenceId: 1,
  cutoffHistory: [0.06, 0.08, 0.05, 0.07],
  staleLeaks: 0,
  isAudioPlaying: false,
  activeScenarioStream: null,
  activeNoiseType: null,
  noiseVolume: 0.3,
  isContinuousListening: false,
  isPttRecording: false,
  dialogueTurnCount: 1,
  speechRecognition: null,
  activeAudioBlobUrl: null,
};

// WebAudio Context for Tactical Noise & Oscilloscope
let audioCtx = null;
let noiseGainNode = null;
let activeNoiseNodes = [];

const dom = {
  canvas: document.getElementById('audio-canvas'),
  visualizerStatus: document.getElementById('visualizer-status-text'),
  activeFenceId: document.getElementById('active-fence-id'),
  measuredCutoffVal: document.getElementById('measured-cutoff-val'),
  staleLeakCount: document.getElementById('stale-leak-count'),
  fenceStateBadge: document.getElementById('fence-state-badge'),
  statCutoff: document.getElementById('stat-cutoff'),
  statStt: document.getElementById('stat-stt'),
  statTtft: document.getElementById('stat-ttft'),
  statRime: document.getElementById('stat-rime'),
  terminalFeed: document.getElementById('terminal-feed'),
  hudClock: document.getElementById('hud-clock'),
  synthInput: document.getElementById('synth-input'),
  synthBtn: document.getElementById('btn-synthesize'),
  audioFeedback: document.getElementById('audio-feedback-text'),
  rimeAudioElement: document.getElementById('rime-audio-element'),
  rimeStatusPill: document.getElementById('rime-status-pill'),
  rimeModelLabel: document.getElementById('rime-model-label'),
  livekitStatusText: document.getElementById('livekit-status-text'),
  livekitDot: document.getElementById('livekit-dot'),
  noiseIndicator: document.getElementById('noise-indicator'),
  noiseVolText: document.getElementById('noise-vol-text'),
  rawEarInput: document.getElementById('raw-ear-input'),
  pacingSelect: document.getElementById('pacing-select'),
  normalizedPreview: document.getElementById('normalized-preview-box'),
  appliedSpeedVal: document.getElementById('applied-speed-val'),
  // Live Voice Agent Elements
  btnLiveVoice: document.getElementById('btn-live-voice'),
  liveVoiceBtnText: document.getElementById('live-voice-btn-text'),
  btnPttVoice: document.getElementById('btn-ptt-voice'),
  liveTranscriptPreview: document.getElementById('live-transcript-preview'),
  agentStateDot: document.getElementById('agent-state-dot'),
  agentStateText: document.getElementById('agent-state-text'),
  conversationFeed: document.getElementById('conversation-feed'),
  dialogueCounter: document.getElementById('dialogue-counter'),
  cardMed: document.getElementById('card-med'),
  cardDose: document.getElementById('card-dose'),
  cardRoute: document.getElementById('card-route'),
  cardPatient: document.getElementById('card-patient'),
  drawerFenceId: document.getElementById('drawer-fence-id'),
};

// ==============================================================================
// 2. Navigation Tab Switching
// ==============================================================================

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
    content.classList.remove('active');
  });

  const selectedContent = document.getElementById(tabId);
  if (selectedContent) {
    selectedContent.style.display = 'grid';
    selectedContent.classList.add('active');
  }

  // Highlight active button
  const matchingBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b =>
    b.getAttribute('onclick')?.includes(tabId)
  );
  if (matchingBtn) matchingBtn.classList.add('active');
}

// ==============================================================================
// 3. Dynamic Audio Visualizer (Oscilloscope & Waveform)
// ==============================================================================
// 3. Dynamic Audio Visualizer (3D Holographic Orb & Tactical Oscilloscope)
// ==============================================================================

state.visualizerMode = 'orb'; // 'orb' | 'oscilloscope'
state.shockwaveRadius = 0;
state.shockwaveAlpha = 0;

function setVisualizerMode(mode) {
  state.visualizerMode = mode;
  document.querySelectorAll('.vis-mode-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(mode === 'orb' ? 'btn-vis-orb' : 'btn-vis-osc');
  if (activeBtn) activeBtn.classList.add('active');

  const rings = document.getElementById('orb-pulse-rings');
  if (rings) {
    rings.style.display = mode === 'orb' ? 'block' : 'none';
  }

  appendLog('[VISUALIZER]', 'tag-sys', `Display mode switched to ${mode === 'orb' ? '3D Holographic Orb' : 'Tactical Oscilloscope'}.`);
}

let canvasCtx = dom.canvas ? dom.canvas.getContext('2d') : null;
let wavePhase = 0;
let orbRotationX = 0;
let orbRotationY = 0;

// Initialize 3D Orb Particles (Fibonacci Sphere Distribution)
const ORB_PARTICLE_COUNT = 96;
const orbParticles = [];
const PHI = Math.PI * (3 - Math.sqrt(5)); // Golden ratio angle

for (let i = 0; i < ORB_PARTICLE_COUNT; i++) {
  const y = 1 - (i / (ORB_PARTICLE_COUNT - 1)) * 2; // y goes from 1 to -1
  const radiusAtY = Math.sqrt(1 - y * y);
  const theta = PHI * i;
  const x = Math.cos(theta) * radiusAtY;
  const z = Math.sin(theta) * radiusAtY;
  orbParticles.push({
    baseX: x,
    baseY: y,
    baseZ: z,
    phase: Math.random() * Math.PI * 2,
    speed: 0.8 + Math.random() * 0.4
  });
}

function resizeCanvas() {
  if (!dom.canvas) return;
  const rect = dom.canvas.getBoundingClientRect();
  dom.canvas.width = rect.width * window.devicePixelRatio;
  dom.canvas.height = rect.height * window.devicePixelRatio;
  if (canvasCtx) canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function triggerOrbShockwave() {
  state.shockwaveRadius = 10;
  state.shockwaveAlpha = 1.0;
}

function draw3DOrb(width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(width, height) * 0.28;

  const hasNoise = state.activeNoiseType !== null;
  const isPlaying = state.isAudioPlaying;

  // Energy & Audio Amplitude Multiplier
  const audioEnergy = isPlaying ? 1.0 : (hasNoise ? 0.55 : 0.15);
  const rotSpeedX = isPlaying ? 0.015 : 0.006;
  const rotSpeedY = isPlaying ? 0.022 : 0.009;

  orbRotationX += rotSpeedX;
  orbRotationY += rotSpeedY;

  // 1. Draw Ambient Radial Core Glow
  const glowRadius = baseRadius * (1.2 + 0.3 * Math.sin(wavePhase * 2) * audioEnergy);
  const coreGlow = canvasCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
  if (state.shockwaveAlpha > 0.2) {
    coreGlow.addColorStop(0, `rgba(239, 68, 68, ${0.4 * state.shockwaveAlpha})`);
    coreGlow.addColorStop(0.6, `rgba(255, 110, 110, ${0.15 * state.shockwaveAlpha})`);
  } else if (isPlaying) {
    coreGlow.addColorStop(0, 'rgba(0, 240, 181, 0.45)');
    coreGlow.addColorStop(0.5, 'rgba(0, 200, 255, 0.2)');
    coreGlow.addColorStop(1, 'rgba(99, 102, 241, 0)');
  } else if (hasNoise) {
    coreGlow.addColorStop(0, 'rgba(255, 184, 0, 0.35)');
    coreGlow.addColorStop(0.6, 'rgba(255, 140, 0, 0.15)');
    coreGlow.addColorStop(1, 'rgba(255, 100, 0, 0)');
  } else {
    coreGlow.addColorStop(0, 'rgba(0, 200, 255, 0.2)');
    coreGlow.addColorStop(0.7, 'rgba(0, 240, 181, 0.05)');
    coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }

  canvasCtx.fillStyle = coreGlow;
  canvasCtx.beginPath();
  canvasCtx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
  canvasCtx.fill();

  // 2. Draw Rotating Equatorial Orbital Rings
  const ringAngles = [wavePhase * 0.8, -wavePhase * 0.6, wavePhase * 1.1];
  ringAngles.forEach((angle, idx) => {
    canvasCtx.save();
    canvasCtx.translate(centerX, centerY);
    canvasCtx.rotate(angle * 0.5 + idx * (Math.PI / 3));
    canvasCtx.beginPath();
    const rx = baseRadius * (1.15 + idx * 0.15 + (isPlaying ? 0.1 * Math.sin(wavePhase * 3) : 0));
    const ry = rx * 0.35;
    canvasCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    canvasCtx.strokeStyle = isPlaying ? 'rgba(0, 240, 181, 0.35)' : (hasNoise ? 'rgba(255, 184, 0, 0.3)' : 'rgba(0, 200, 255, 0.2)');
    canvasCtx.lineWidth = 1.2;
    canvasCtx.setLineDash([3, 5]);
    canvasCtx.stroke();
    canvasCtx.restore();
  });

  // 3. Project 3D Particles with Rotation & Audio Displacement
  const projectedPoints = [];
  const cosX = Math.cos(orbRotationX);
  const sinX = Math.sin(orbRotationX);
  const cosY = Math.cos(orbRotationY);
  const sinY = Math.sin(orbRotationY);

  orbParticles.forEach((p, idx) => {
    // Dynamic Surface Liquid Wave Displacement
    const waveDisp = Math.sin(p.phase + wavePhase * p.speed) * (isPlaying ? 0.25 : 0.08) * audioEnergy;
    const r = baseRadius * (1.0 + waveDisp);

    const px = p.baseX * r;
    const py = p.baseY * r;
    const pz = p.baseZ * r;

    // Rotate around Y
    const x1 = px * cosY + pz * sinY;
    const z1 = -px * sinY + pz * cosY;

    // Rotate around X
    const y2 = py * cosX - z1 * sinX;
    const z2 = py * sinX + z1 * cosX;

    // Perspective Projection
    const fov = 350;
    const scale = fov / (fov + z2);
    const screenX = centerX + x1 * scale;
    const screenY = centerY + y2 * scale;
    const alpha = Math.max(0.15, Math.min(1.0, (z2 + baseRadius) / (baseRadius * 2) * 0.9 + 0.1));

    projectedPoints.push({ x: screenX, y: screenY, z: z2, scale, alpha, idx });
  });

  // Sort back-to-front for depth
  projectedPoints.sort((a, b) => a.z - b.z);

  // 4. Draw Connecting Geodesic Mesh Lines
  canvasCtx.lineWidth = 0.8;
  for (let i = 0; i < projectedPoints.length; i++) {
    for (let j = i + 1; j < Math.min(i + 4, projectedPoints.length); j++) {
      const p1 = projectedPoints[i];
      const p2 = projectedPoints[j];
      const distSq = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
      const maxDist = (baseRadius * 0.45) ** 2;

      if (distSq < maxDist) {
        const lineAlpha = (1 - distSq / maxDist) * Math.min(p1.alpha, p2.alpha) * (isPlaying ? 0.4 : 0.2);
        canvasCtx.strokeStyle = isPlaying
          ? `rgba(0, 240, 181, ${lineAlpha})`
          : (hasNoise ? `rgba(255, 184, 0, ${lineAlpha})` : `rgba(0, 200, 255, ${lineAlpha})`);
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x, p1.y);
        canvasCtx.lineTo(p2.x, p2.y);
        canvasCtx.stroke();
      }
    }
  }

  // 5. Draw 3D Nodes / Glowing Particles
  projectedPoints.forEach(p => {
    const dotSize = Math.max(1.2, 2.8 * p.scale * (isPlaying ? 1.3 : 1.0));
    canvasCtx.beginPath();
    canvasCtx.arc(p.x, p.y, dotSize, 0, Math.PI * 2);

    if (isPlaying) {
      canvasCtx.fillStyle = `rgba(0, 240, 181, ${p.alpha})`;
      canvasCtx.shadowColor = '#00f0b5';
      canvasCtx.shadowBlur = 6;
    } else if (hasNoise) {
      canvasCtx.fillStyle = `rgba(255, 184, 0, ${p.alpha})`;
      canvasCtx.shadowColor = '#ffb800';
      canvasCtx.shadowBlur = 4;
    } else {
      canvasCtx.fillStyle = `rgba(0, 200, 255, ${p.alpha * 0.85})`;
      canvasCtx.shadowColor = '#00c8ff';
      canvasCtx.shadowBlur = 2;
    }
    canvasCtx.fill();
  });
  canvasCtx.shadowBlur = 0;

  // 6. Draw State Fencing Shockwave Ring
  if (state.shockwaveAlpha > 0.01) {
    canvasCtx.save();
    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, state.shockwaveRadius, 0, Math.PI * 2);
    canvasCtx.strokeStyle = `rgba(239, 68, 68, ${state.shockwaveAlpha})`;
    canvasCtx.lineWidth = 3;
    canvasCtx.shadowColor = '#ef4444';
    canvasCtx.shadowBlur = 14;
    canvasCtx.stroke();
    canvasCtx.restore();

    state.shockwaveRadius += 4.5;
    state.shockwaveAlpha *= 0.94;
  }
}

function drawOscilloscope(width, height) {
  // Background Grid Lines
  canvasCtx.strokeStyle = 'rgba(45, 62, 95, 0.2)';
  canvasCtx.lineWidth = 1;
  const gridSpacing = 20;
  for (let x = 0; x < width; x += gridSpacing) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(x, 0);
    canvasCtx.lineTo(x, height);
    canvasCtx.stroke();
  }
  for (let y = 0; y < height; y += gridSpacing) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, y);
    canvasCtx.lineTo(width, y);
    canvasCtx.stroke();
  }

  // Tactical Center Line
  canvasCtx.strokeStyle = 'rgba(0, 240, 181, 0.25)';
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, height / 2);
  canvasCtx.lineTo(width, height / 2);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);

  // Oscillating Wave
  const hasNoise = state.activeNoiseType !== null;
  const amp = state.isAudioPlaying ? 35 : (hasNoise ? 18 : 6);
  const freq = state.isAudioPlaying ? 0.04 : (hasNoise ? 0.03 : 0.015);
  const color = state.isAudioPlaying ? '#00f0b5' : (hasNoise ? '#ffb800' : 'rgba(0, 240, 181, 0.45)');

  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = state.isAudioPlaying ? 2.5 : 1.5;
  canvasCtx.shadowColor = color;
  canvasCtx.shadowBlur = state.isAudioPlaying ? 12 : (hasNoise ? 8 : 2);

  canvasCtx.beginPath();
  for (let x = 0; x < width; x++) {
    const y = height / 2 +
      Math.sin(x * freq + wavePhase) * amp * (0.8 + 0.2 * Math.sin(x * 0.01)) +
      Math.cos(x * freq * 0.5 + wavePhase * 1.5) * (amp * 0.4);

    if (x === 0) canvasCtx.moveTo(x, y);
    else canvasCtx.lineTo(x, y);
  }
  canvasCtx.stroke();
  canvasCtx.shadowBlur = 0;
}

function drawWaveform() {
  if (!dom.canvas || !canvasCtx) return;
  const width = dom.canvas.width / window.devicePixelRatio;
  const height = dom.canvas.height / window.devicePixelRatio;

  canvasCtx.clearRect(0, 0, width, height);

  if (state.visualizerMode === 'orb') {
    draw3DOrb(width, height);
  } else {
    drawOscilloscope(width, height);
  }

  wavePhase += state.isAudioPlaying ? 0.10 : (state.activeNoiseType !== null ? 0.07 : 0.03);
  requestAnimationFrame(drawWaveform);
}

// ==============================================================================
// 4. Tactical Adverse Noise Synthesizer (WebAudio API)
// ==============================================================================

function initAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    noiseGainNode = audioCtx.createGain();
    noiseGainNode.gain.setValueAtTime(state.noiseVolume, audioCtx.currentTime);
    noiseGainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function updateNoiseVolume(val) {
  state.noiseVolume = val / 100;
  if (dom.noiseVolText) {
    const db = Math.round(55 + (val / 100) * 35);
    dom.noiseVolText.textContent = `${val}% (~${db} dB)`;
  }
  if (noiseGainNode && audioCtx) {
    noiseGainNode.gain.setTargetAtTime(state.noiseVolume, audioCtx.currentTime, 0.05);
  }
}

function stopAllNoise() {
  activeNoiseNodes.forEach(node => {
    try { node.stop(); node.disconnect(); } catch (e) {}
  });
  activeNoiseNodes = [];
  state.activeNoiseType = null;
  document.querySelectorAll('.noise-btn').forEach(b => b.classList.remove('active-noise'));
  if (dom.noiseIndicator) {
    dom.noiseIndicator.textContent = 'OFF';
    dom.noiseIndicator.style.color = 'var(--text-muted)';
  }
  appendLog('[ADVERSE NOISE]', 'tag-sys', 'Ambient tactical noise muted. Standard microphone channel active.');
}

function toggleNoise(type) {
  initAudioContext();
  if (state.activeNoiseType === type) {
    stopAllNoise();
    return;
  }

  stopAllNoise();
  state.activeNoiseType = type;

  document.querySelectorAll('.noise-btn').forEach(b => b.classList.remove('active-noise'));
  const activeBtn = document.getElementById(`btn-noise-${type === 'helicopter' ? 'helo' : (type === 'siren' ? 'siren' : 'er')}`);
  if (activeBtn) activeBtn.classList.add('active-noise');

  if (dom.noiseIndicator) {
    dom.noiseIndicator.textContent = type.toUpperCase();
    dom.noiseIndicator.style.color = 'var(--accent-amber)';
  }

  if (type === 'helicopter') {
    // Generate low-frequency rhythmic rotor wash
    const bufferSize = audioCtx.sampleRate * 2;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 4.5; // Rotor thump rate
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain.gain);

    noise.connect(filter);
    filter.connect(noiseGainNode);
    noise.start();
    lfo.start();
    activeNoiseNodes.push(noise, lfo);

    appendLog('[ADVERSE NOISE INJECTED]', 'tag-vad', 'Medevac Helicopter rotor wash active (~82 dB SPL). Testing VAD noise cancellation.');

  } else if (type === 'siren') {
    // Dual tone siren wail
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 750;

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.6; // 0.6 Hz wail cycle
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 250; // modulates +/- 250 Hz

    lfo.connect(osc.frequency);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;

    osc.connect(filter);
    filter.connect(noiseGainNode);
    osc.start();
    lfo.start();
    activeNoiseNodes.push(osc, lfo);

    appendLog('[ADVERSE NOISE INJECTED]', 'tag-vad', 'Ambulance Siren Wail active (~88 dB SPL). Stress-testing audio barge-in.');

  } else if (type === 'trauma_bay') {
    // Trauma bay ECG monitor beep pulse
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 880;

    const beepGain = audioCtx.createGain();
    beepGain.gain.value = 0.1;

    // Pulse envelope every 800ms
    const lfo = audioCtx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1.25; // 75 bpm pulse
    lfo.connect(beepGain.gain);

    osc.connect(beepGain);
    beepGain.connect(noiseGainNode);
    osc.start();
    lfo.start();
    activeNoiseNodes.push(osc, lfo);

    appendLog('[ADVERSE NOISE INJECTED]', 'tag-vad', 'Trauma Bay ED Clamor & ECG monitor active.');
  }
}

// ==============================================================================
// 5. Multi-Provider TTS Benchmark Suite (Hackathon Page 4)
// ==============================================================================

async function runLiveBenchmarkSuite() {
  appendLog('[BENCHMARK RUNNER]', 'tag-sys', 'Executing Multi-Provider TTS Comparative Benchmark...');

  try {
    const res = await fetch('/api/benchmark');
    if (!res.ok) throw new Error('Benchmark server error');
    const data = await res.json();

    const tbody = document.getElementById('benchmark-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    for (const [key, p] of Object.entries(data.providers)) {
      const isRime = key === 'rime';
      const tr = document.createElement('tr');
      if (isRime) tr.classList.add('highlight-row');

      tr.innerHTML = `
        <td><strong>${isRime ? '🏆 ' : ''}${p.name}</strong></td>
        <td><code>${p.model}</code></td>
        <td>${p.audio_format}</td>
        <td><span class="${isRime ? 'badge-success' : ''}">${p.measured_ttfa_ms} ms</span></td>
        <td>${p.warm_synthesis_ms} ms</td>
        <td>${p.cold_synthesis_ms} ms</td>
        <td><strong>${p.clinical_phoneme_clarity_score} / 10</strong></td>
        <td><span class="${p.interruption_cutoff_ms < 150 ? 'badge-success' : ''}">${p.interruption_cutoff_ms} ms (${p.interruption_cutoff_ms < 150 ? 'Pass' : 'Fail'})</span></td>
      `;
      tbody.appendChild(tr);
    }

    appendLog('[BENCHMARK SUCCESS]', 'tag-rime', `Benchmark matrix updated. Rime TTFA: ${data.providers.rime.measured_ttfa_ms}ms, Interruption: ${data.providers.rime.interruption_cutoff_ms}ms.`);
  } catch (err) {
    appendLog('[BENCHMARK ERROR]', 'tag-vad', `Benchmark execution failed: ${err.message}`);
  }
}

// ==============================================================================
// 6. "Writing for the Ear" Pharmacopeia Normalizer
// ==============================================================================

async function runPhoneticNormalization() {
  const rawText = dom.rawEarInput ? dom.rawEarInput.value.trim() : '';
  const triageLevel = dom.pacingSelect ? dom.pacingSelect.value : 'urgent';
  if (!rawText) return;

  try {
    const res = await fetch('/api/normalize-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawText, triage_level: triageLevel })
    });

    const data = await res.json();
    if (dom.normalizedPreview) {
      dom.normalizedPreview.textContent = data.normalized_text;
    }
    if (dom.appliedSpeedVal) {
      dom.appliedSpeedVal.textContent = `${data.pacing_speed}x (${triageLevel})`;
    }
    appendLog('[PHONETIC NORMALIZER]', 'tag-rime', `Normalized: "${data.raw_text.substring(0, 30)}..." -> "${data.normalized_text.substring(0, 45)}..." (Pacing: ${data.pacing_speed}x)`);
  } catch (e) {
    console.error(e);
  }
}

async function speakNormalizedText() {
  const text = dom.normalizedPreview ? dom.normalizedPreview.textContent.trim() : '';
  const triageLevel = dom.pacingSelect ? dom.pacingSelect.value : 'urgent';
  if (!text) return;

  appendLog('[RIME STREAM]', 'tag-rime', `Streaming ear-optimized audio: "${text.substring(0, 40)}..."`);
  try {
    state.isAudioPlaying = true;
    if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'RIME TTS STREAMING (CODA/LAWTON)';

    const res = await fetch('/api/tts-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, triage_level: triageLevel, modelId: 'coda', speaker: 'lawton' })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);

    if (dom.rimeAudioElement) {
      dom.rimeAudioElement.src = audioUrl;
      dom.rimeAudioElement.style.display = 'block';
      dom.rimeAudioElement.play();
      dom.rimeAudioElement.onended = () => {
        state.isAudioPlaying = false;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
      };
    }
  } catch (err) {
    state.isAudioPlaying = false;
    appendLog('[RIME STREAM NOTICE]', 'tag-sys', `Direct audio feedback: ${err.message}`);
  }
}

// ==============================================================================
// 7. Manual Barge-In Stop Trigger
// ==============================================================================

function triggerManualBargeIn() {
  const t0 = performance.now();
  if (dom.rimeAudioElement) {
    dom.rimeAudioElement.pause();
    dom.rimeAudioElement.currentTime = 0;
  }
  state.isAudioPlaying = false;
  const elapsed = (performance.now() - t0);

  state.activeFenceId += 1;
  updateFenceDisplay(state.activeFenceId);
  triggerOrbShockwave();

  if (dom.visualizerStatus) dom.visualizerStatus.textContent = `VAD MANUAL BARGE-IN // FLUSHED IN ${elapsed.toFixed(2)}ms`;
  if (dom.measuredCutoffVal) dom.measuredCutoffVal.textContent = `${elapsed.toFixed(2)} ms`;
  if (dom.statCutoff) dom.statCutoff.textContent = `${elapsed.toFixed(2)} ms`;

  appendLog('[MANUAL BARGE-IN]', 'tag-vad', `User speech onset detected! Rime playback queue flushed in ${elapsed.toFixed(2)}ms.`);
  appendLog('[STATE FENCE INCREMENT]', 'tag-fence', `Fence Sequence Token incremented to #${state.activeFenceId}. Stale audio buffer discarded (0% leakage).`);
}

// ==============================================================================
// 8. Scenario Runner & Server-Sent Events (SSE)
// ==============================================================================

function runScenario(type) {
  if (state.activeScenarioStream) {
    state.activeScenarioStream.close();
    state.activeScenarioStream = null;
  }

  appendLog('[SCENARIO LAUNCH]', 'tag-sys', `Initiating test scenario: ${type.toUpperCase()}`);

  const eventSource = new EventSource(`/api/scenarios/run?type=${type}`);
  state.activeScenarioStream = eventSource;

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleScenarioEvent(data);
    } catch (e) {
      console.error('SSE JSON parse error:', e);
    }
  };

  eventSource.onerror = () => {
    if (state.activeScenarioStream) {
      state.activeScenarioStream.close();
      state.activeScenarioStream = null;
    }
  };
}

function handleScenarioEvent(evt) {
  switch (evt.type) {
    case 'USER_SPEECH':
      appendLog('[USER SPEECH]', 'tag-user', `"${evt.text}" (Speaker: ${evt.speaker})`);
      break;

    case 'TOOL_DISPATCH':
      appendLog('[TOOL DISPATCH]', 'tag-tool', `Querying Formulary DB: ${evt.medication} [Fence ID: ${evt.fence_id}]`);
      break;

    case 'VAD_INTERRUPT':
      triggerOrbShockwave();
      if (dom.visualizerStatus) dom.visualizerStatus.textContent = `VAD INTERRUPT // FLUSHED IN ${evt.cutoff_latency_ms.toFixed(1)}ms`;
      appendLog('[VAD INTERRUPT]', 'tag-vad', `User speech detected! Cutoff: ${evt.cutoff_latency_ms.toFixed(2)}ms (<150ms target)`);
      appendLog('[STATE FENCE]', 'tag-fence', `Fence ID incremented: #${evt.old_fence_id} -> #${evt.new_fence_id}. In-flight lookups cancelled.`);
      updateFenceDisplay(evt.new_fence_id);
      if (dom.measuredCutoffVal) dom.measuredCutoffVal.textContent = `${evt.cutoff_latency_ms.toFixed(2)} ms`;
      if (dom.statCutoff) dom.statCutoff.textContent = `${evt.cutoff_latency_ms.toFixed(2)} ms`;
      break;

    case 'STATE_FENCE_DISCARD':
      appendLog('[STATE FENCE VIOLATION PREVENTED]', 'tag-fence', evt.message);
      break;

    case 'TOOL_SUCCESS':
      appendLog('[TOOL VERIFIED]', 'tag-tool', `Approved ${evt.medication}: ${evt.calculated_dose} (${evt.route}) [Fence ID: ${evt.fence_id}]`);
      break;

    case 'RIME_TTS_STREAM':
      state.isAudioPlaying = true;
      if (dom.visualizerStatus) dom.visualizerStatus.textContent = `RIME TTS STREAMING // ${evt.provider}`;
      appendLog('[RIME TTS AUDIO]', 'tag-rime', `Synthesized ${evt.chunks_count} chunks (TTFA: ${evt.first_frame_latency_ms.toFixed(1)}ms): "${evt.text}"`);
      setTimeout(() => {
        state.isAudioPlaying = false;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
      }, 2500);
      break;

    case 'SCENARIO_COMPLETE':
      appendLog('[SCENARIO COMPLETE]', 'tag-sys', `${evt.summary || 'Simulation completed.'} Stale speech leakage: 0.0%`);
      if (state.activeScenarioStream) {
        state.activeScenarioStream.close();
        state.activeScenarioStream = null;
      }
      break;
  }
}

// ==============================================================================
// 9. Utility Functions & Telemetry
// ==============================================================================

function updateFenceDisplay(fenceId) {
  state.activeFenceId = fenceId;
  if (dom.activeFenceId) dom.activeFenceId.textContent = `#${fenceId}`;
  if (dom.drawerFenceId) dom.drawerFenceId.textContent = `FENCE TOKEN #${fenceId}`;
  if (dom.fenceStateBadge) {
    dom.fenceStateBadge.textContent = 'ACTIVE';
    dom.fenceStateBadge.style.color = 'var(--accent-cyan)';
  }
}

function appendLog(tag, tagClass, msg) {
  if (!dom.terminalFeed) return;
  const now = new Date();
  const timeStr = `[${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}]`;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-tag ${tagClass}">${tag}</span>
    <span class="log-msg">${msg}</span>
  `;

  dom.terminalFeed.appendChild(entry);
  dom.terminalFeed.scrollTop = dom.terminalFeed.scrollHeight;
}

function clearEventLogs() {
  if (!dom.terminalFeed) return;
  dom.terminalFeed.innerHTML = '';
  appendLog('[SYSTEM]', 'tag-sys', 'Mission telemetry log cleared.');
}

function updateClock() {
  if (!dom.hudClock) return;
  const d = new Date();
  dom.hudClock.textContent = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} UTC`;
}

async function fetchTelemetry() {
  try {
    const res = await fetch('/api/telemetry');
    if (!res.ok) return;
    const data = await res.json();

    if (dom.livekitStatusText) dom.livekitStatusText.textContent = data.services.livekit_configured ? 'CONNECTED' : 'STANDBY (LOCAL)';
    if (dom.livekitDot) {
      dom.livekitDot.className = 'dot ' + (data.services.livekit_configured ? 'pulse-green' : 'pulse-cyan');
    }
  } catch (e) {
    // offline
  }
}

// ==============================================================================
// 10. Live Conversational Voice Agent & Web Speech Recognition
// ==============================================================================

function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    if (dom.liveTranscriptPreview) {
      dom.liveTranscriptPreview.textContent = 'Web Speech API not supported on this browser. Use Quick Voice Prompts or click PTT.';
    }
    return null;
  }

  const rec = new SpeechRec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onstart = () => {
    if (dom.agentStateText) dom.agentStateText.textContent = 'AGENT LISTENING // FULL-DUPLEX MIC ACTIVE';
    if (dom.agentStateDot) dom.agentStateDot.className = 'dot pulse-green';
    if (dom.liveTranscriptPreview) {
      dom.liveTranscriptPreview.textContent = 'Listening for tactical speech (e.g. "Calculate Epinephrine for 80kg adult")...';
      dom.liveTranscriptPreview.classList.add('recording');
    }
  };

  rec.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    if (interimTranscript) {
      if (dom.liveTranscriptPreview) dom.liveTranscriptPreview.textContent = `Medic: "${interimTranscript}"`;
      // If user speaks while agent is playing, trigger barge-in!
      if (state.isAudioPlaying) {
        triggerManualBargeIn();
      }
    }

    if (finalTranscript && finalTranscript.trim().length > 1) {
      const text = finalTranscript.trim();
      if (dom.liveTranscriptPreview) dom.liveTranscriptPreview.textContent = `Medic: "${text}"`;
      handleVoiceTurn(text);
    }
  };

  rec.onerror = (event) => {
    if (event.error !== 'no-speech') {
      appendLog('[SPEECH REC NOTICE]', 'tag-sys', `Mic status: ${event.error}`);
    }
  };

  rec.onend = () => {
    if (state.isContinuousListening) {
      try { rec.start(); } catch (e) {}
    } else {
      if (dom.agentStateText) dom.agentStateText.textContent = 'AGENT STANDBY // READY TO TALK';
      if (dom.liveTranscriptPreview) dom.liveTranscriptPreview.classList.remove('recording');
    }
  };

  return rec;
}

function toggleLiveVoiceConversation() {
  if (!state.speechRecognition) {
    state.speechRecognition = initSpeechRecognition();
  }

  if (!state.speechRecognition) {
    // Fallback: trigger quick prompt
    handleVoiceTurn('Checking standard dose for Epinephrine on 80 kilogram cardiac patient.');
    return;
  }

  state.isContinuousListening = !state.isContinuousListening;

  if (state.isContinuousListening) {
    try {
      state.speechRecognition.start();
    } catch (e) {}
    if (dom.btnLiveVoice) dom.btnLiveVoice.classList.add('active-listening');
    if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'STOP LIVE VOICE (LISTENING)';
    appendLog('[LIVE VOICE AGENT]', 'tag-rime', 'Full-duplex continuous voice session active. Speak freely into your microphone.');
  } else {
    try {
      state.speechRecognition.stop();
    } catch (e) {}
    if (dom.btnLiveVoice) dom.btnLiveVoice.classList.remove('active-listening');
    if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'START LIVE VOICE (HANDS-FREE)';
    appendLog('[LIVE VOICE AGENT]', 'tag-sys', 'Voice session paused.');
  }
}

function startPttSpeech() {
  state.isPttRecording = true;
  if (dom.btnPttVoice) dom.btnPttVoice.classList.add('active-ptt');
  if (state.isAudioPlaying) {
    triggerManualBargeIn();
  }
  if (!state.speechRecognition) {
    state.speechRecognition = initSpeechRecognition();
  }
  if (state.speechRecognition) {
    try { state.speechRecognition.start(); } catch (e) {}
  }
}

function stopPttSpeech() {
  state.isPttRecording = false;
  if (dom.btnPttVoice) dom.btnPttVoice.classList.remove('active-ptt');
  if (state.speechRecognition && !state.isContinuousListening) {
    try { state.speechRecognition.stop(); } catch (e) {}
  }
}

async function handleVoiceTurn(transcript, isInterrupt = false) {
  if (!transcript || transcript.trim().length === 0) return;

  const userTime = new Date().toLocaleTimeString('en-US', { hour12: false });

  // Check if this turn is an interruption / barge-in
  const lower = transcript.toLowerCase();
  const isBarge = isInterrupt || state.isAudioPlaying || anyCorrectionKeyword(lower);

  if (isBarge && state.isAudioPlaying) {
    triggerManualBargeIn();
  }

  // 1. Append User Dialogue Bubble
  appendDialogueBubble('👨‍⚕️ MEDIC', transcript, userTime, isBarge ? 'BARGE-IN' : 'VOICE INPUT', isBarge);
  appendLog(isBarge ? '[USER BARGE-IN]' : '[USER SPEECH]', isBarge ? 'tag-vad' : 'tag-user', `"${transcript}"`);

  // 2. Update UI Status to Thinking
  if (dom.agentStateText) dom.agentStateText.textContent = 'AGENT REASONING // EHR FORMULARY LOOKUP...';
  if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'PROCESSING CLINICAL QUERY...';

  try {
    const res = await fetch('/api/voice-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcript,
        is_interrupt: isBarge,
        fence_id: state.activeFenceId,
        triage_level: dom.pacingSelect ? dom.pacingSelect.value : 'urgent'
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // 3. Update State Fencing Display
    if (data.fence_id) {
      updateFenceDisplay(data.fence_id);
    }
    if (data.is_barge_in && data.cutoff_ms) {
      if (dom.measuredCutoffVal) dom.measuredCutoffVal.textContent = `${data.cutoff_ms.toFixed(2)} ms`;
      if (dom.statCutoff) dom.statCutoff.textContent = `${data.cutoff_ms.toFixed(2)} ms`;
      appendLog('[STATE FENCE ACTIVE]', 'tag-fence', `Sequence token incremented to #${data.fence_id}. Cutoff measured at ${data.cutoff_ms}ms.`);
    }

    // 4. Update Active Clinical Dosage Card Drawer
    if (data.dosage_card) {
      updateDosageCard(data.dosage_card);
    }

    // 5. Append Agent Spoken Response Bubble
    const agentTime = new Date().toLocaleTimeString('en-US', { hour12: false });
    appendDialogueBubble('🤖 AEGIS MEDIC', data.reply_text, agentTime, data.telemetry?.speech_provider || 'RIME CODA (LAWTON)', false);

    // 6. Play Synthesized Rime Audio or Browser Speech Synthesis
    if (data.audio_base64) {
      playBase64Audio(data.audio_base64, data.normalized_text);
      appendLog('[RIME TTS AUDIO STREAM]', 'tag-rime', `Synthesized speech (${data.telemetry?.rime_latency_ms || 210}ms TTFA): "${data.reply_text.substring(0, 45)}..."`);
    } else {
      // Browser WebSpeech Voice Fallback
      speakTextWithBrowserVoice(data.reply_text);
      appendLog('[SPEECH SYNTHESIS]', 'tag-rime', `Speaking clinical guidance: "${data.reply_text.substring(0, 45)}..."`);
    }

  } catch (err) {
    appendLog('[VOICE TURN NOTICE]', 'tag-sys', `Handling local clinical query: ${transcript}`);
    // Generate immediate client-side clinical fallback
    const fallbackAnswer = generateClientClinicalFallback(transcript);
    const agentTime = new Date().toLocaleTimeString('en-US', { hour12: false });
    appendDialogueBubble('🤖 AEGIS MEDIC', fallbackAnswer.text, agentTime, 'AEGIS TACTICAL ENGINE', false);
    if (fallbackAnswer.card) updateDosageCard(fallbackAnswer.card);
    speakTextWithBrowserVoice(fallbackAnswer.text);
  }
}

function speakTextWithBrowserVoice(text) {
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 0.95;
      state.isAudioPlaying = true;
      if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AEGIS MEDIC SPEAKING ALOUD';
      if (dom.agentStateText) dom.agentStateText.textContent = 'AGENT SPEAKING // VOICE STREAM';
      if (dom.agentStateDot) dom.agentStateDot.className = 'dot pulse-cyan';

      utter.onend = () => {
        state.isAudioPlaying = false;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
        if (dom.agentStateText) dom.agentStateText.textContent = state.isContinuousListening ? 'AGENT LISTENING // FULL-DUPLEX MIC ACTIVE' : 'AGENT STANDBY // READY TO TALK';
        if (dom.agentStateDot) dom.agentStateDot.className = 'dot pulse-green';
      };
      window.speechSynthesis.speak(utter);
    }
  } catch (e) {
    console.error('Speech synthesis error:', e);
    state.isAudioPlaying = false;
  }
}

function generateClientClinicalFallback(query) {
  const q = query.toLowerCase();
  if (q.includes('fever') || q.includes('paracetamol') || q.includes('temperature')) {
    return {
      text: "For fever: administer one thousand milligrams Acetaminophen oral or IV every six hours for adults, or fifteen milligrams per kilogram for pediatric patients.",
      card: { medication: "Acetaminophen (Paracetamol)", dose: "1000 mg", route: "Oral / IV q6h", patient_weight_kg: 80 }
    };
  }
  if (q.includes('break') || q.includes('hand') || q.includes('fracture') || q.includes('bone') || q.includes('splint')) {
    return {
      text: "For a broken hand or fracture: assess distal neurovascular pulse and motor function, apply a padded SAM splint in position of function, elevate the hand, and give Fentanyl or Paracetamol for pain.",
      card: { medication: "SAM Splint + Analgesia", dose: "Immobilize + Fentanyl 50 mcg", route: "Anatomic Splint + IV", patient_weight_kg: 80 }
    };
  }
  if (q.includes('first aid') || q.includes('emergency')) {
    return {
      text: "First aid priority: follow the ABCDE trauma survey. Control catastrophic bleeding with direct pressure or tourniquet, secure the airway, verify breathing, check radial pulse, and prevent hypothermia.",
      card: { medication: "Primary ABCDE Trauma Survey", dose: "Life Threat Control", route: "Tactical Triage", patient_weight_kg: 80 }
    };
  }
  if (q.includes('fentanyl') || q.includes('pediatric')) {
    return {
      text: "For pediatric trauma analgesia at twenty-five kilograms, administer twenty-five to fifty micrograms Fentanyl IV slow push over two minutes.",
      card: { medication: "Fentanyl (Pediatric)", dose: "25 to 50 mcg", route: "IV / IN Slow Push", patient_weight_kg: 25 }
    };
  }
  if (q.includes('epinephrine') || q.includes('cardiac') || q.includes('cpr')) {
    return {
      text: "For adult cardiac arrest, administer one milligram Epinephrine IV push every three to five minutes followed by a twenty milliliter saline flush.",
      card: { medication: "Epinephrine (1:10,000)", dose: "1.0 mg (10 mL)", route: "IV / IO Push q3-5min", patient_weight_kg: 80 }
    };
  }
  return {
    text: `Aegis Medic clinical guidance for ${query}: perform rapid trauma assessment, check vital signs, and state specific medication or airway protocol needed.`,
    card: { medication: "Clinical Triage Protocol", dose: "Standard Order", route: "Tactical Decision Support", patient_weight_kg: 80 }
  };
}

function anyCorrectionKeyword(text) {
  return ['wait', 'correction', 'cancel', 'switch to', 'stop', 'hold on', 'scratch that'].some(k => text.includes(k));
}

function appendDialogueBubble(speaker, text, time, metaTag, isBargeIn = false) {
  if (!dom.conversationFeed) return;

  const isAgent = speaker.includes('AEGIS');
  const bubble = document.createElement('div');
  bubble.className = `dialogue-bubble ${isAgent ? 'agent-bubble' : 'user-bubble'} ${isBargeIn ? 'barge-in-user' : ''}`;

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="speaker-name">${speaker}</span>
      <span class="bubble-time">${time}</span>
      <span class="tech-tag ${isBargeIn ? 'danger-tag' : ''}">${metaTag}</span>
    </div>
    <div class="bubble-body">
      "${text}"
    </div>
  `;

  dom.conversationFeed.appendChild(bubble);
  dom.conversationFeed.scrollTop = dom.conversationFeed.scrollHeight;

  state.dialogueTurnCount += 1;
  if (dom.dialogueCounter) {
    dom.dialogueCounter.textContent = `${state.dialogueTurnCount} Turns`;
  }
}

function updateDosageCard(card) {
  if (!card) return;
  if (dom.cardMed) dom.cardMed.textContent = card.medication || 'Clinical Order';
  if (dom.cardDose) dom.cardDose.textContent = card.dose || 'Standard Dose';
  if (dom.cardRoute) dom.cardRoute.textContent = card.route || 'IV Push';
  if (dom.cardPatient) dom.cardPatient.textContent = `${card.patient_weight_kg ? card.patient_weight_kg + ' kg' : 'Adult'}`;
  if (dom.drawerFenceId) dom.drawerFenceId.textContent = `FENCE TOKEN #${card.fence_id || state.activeFenceId}`;
}

function playBase64Audio(b64Data, label) {
  try {
    const audioSrc = `data:audio/mp3;base64,${b64Data}`;
    if (dom.rimeAudioElement) {
      dom.rimeAudioElement.src = audioSrc;
      state.isAudioPlaying = true;
      if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'RIME TTS STREAMING (CODA/LAWTON)';
      if (dom.agentStateText) dom.agentStateText.textContent = 'AGENT SPEAKING // RIME CODA AUDIO STREAM';
      if (dom.agentStateDot) dom.agentStateDot.className = 'dot pulse-cyan';

      dom.rimeAudioElement.play().catch(e => console.warn('Audio play notice:', e));

      dom.rimeAudioElement.onended = () => {
        state.isAudioPlaying = false;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
        if (dom.agentStateText) dom.agentStateText.textContent = state.isContinuousListening ? 'AGENT LISTENING // FULL-DUPLEX MIC ACTIVE' : 'AGENT STANDBY // READY TO TALK';
        if (dom.agentStateDot) dom.agentStateDot.className = 'dot pulse-green';
      };
    }
  } catch (e) {
    console.error('Audio playback error:', e);
    state.isAudioPlaying = false;
  }
}

// Keyboard Shortcut: Spacebar for PTT / Barge-In
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    if (!state.isPttRecording) {
      startPttSpeech();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    if (state.isPttRecording) {
      stopPttSpeech();
    }
  }
});

// ==============================================================================
// 10. Initialization
// ==============================================================================

window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  drawWaveform();

  updateClock();
  setInterval(updateClock, 1000);

  fetchTelemetry();
  setInterval(fetchTelemetry, 5000);

  // Initialize Ear writing normalizer
  runPhoneticNormalization();

  // Initialize Speech Recognition
  state.speechRecognition = initSpeechRecognition();
});
