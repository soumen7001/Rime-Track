/**
 * AEGIS MEDIC - AI FIELD MEDICAL VOICE ASSISTANT DASHBOARD
 * Core Frontend Logic, Voice Engine, Visualizer & Benchmark Suite
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
  isUserSpeaking: false,
  voiceInputLevel: 0.0,
  voiceOutputLevel: 0.0,
  activeSpeaker: 'idle', // 'user' | 'agent' | 'idle'
  dialogueTurnCount: 1,
  speechRecognition: null,
  activeAudioBlobUrl: null,
  selectedSpeaker: 'wawona',
  selectedModel: 'coda',
  currentDisplayMode: 'orb', // Single source of truth: 'orb' | 'oscilloscope'
  previousDisplayMode: null,
  visualizerMode: 'orb',
  shockwaveRadius: 0,
  shockwaveAlpha: 0,
  activeVoiceTurnId: 0,
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
  statCutoff: document.getElementById('stat-cutoff'),
  statStt: document.getElementById('stat-stt'),
  statTtft: document.getElementById('stat-ttft'),
  statRime: document.getElementById('stat-rime'),
  terminalFeed: document.getElementById('terminal-feed'),
  missionTimeline: document.getElementById('mission-activity-timeline'),
  hudClock: document.getElementById('hud-clock'),
  rimeAudioElement: document.getElementById('rime-audio-element'),
  rimeVoiceSelect: document.getElementById('rime-voice-select'),
  livekitStatusText: document.getElementById('livekit-status-text'),
  livekitDot: document.getElementById('livekit-dot'),
  navMicDot: document.getElementById('nav-mic-dot'),
  navMicText: document.getElementById('nav-mic-text'),
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
  conversationFeed: document.getElementById('conversation-feed'),
  dialogueCounter: document.getElementById('dialogue-counter'),
  cardMed: document.getElementById('card-med'),
  cardDose: document.getElementById('card-dose'),
  cardRoute: document.getElementById('card-route'),
  cardTiming: document.getElementById('card-timing'),
  cardPatient: document.getElementById('card-patient'),
  drawerFenceId: document.getElementById('drawer-fence-id'),
  displayModeIndicatorBadge: document.getElementById('display-mode-indicator-badge'),
  vuMeterFill: document.getElementById('vu-meter-fill'),
  telemetryDrawer: document.getElementById('telemetry-drawer-panel'),
  telemetryChevron: document.getElementById('telemetry-chevron'),
};

// Centralized Single Source of Truth for Display Modes
const DISPLAY_MODES = {
  orb: '3D Holographic Orb',
  oscilloscope: 'Tactical Oscilloscope'
};

// ==============================================================================
// 2. Navigation & Layout Controls
// ==============================================================================

function switchMainTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
    content.classList.remove('active');
  });

  const selectedContent = document.getElementById(tabId);
  if (selectedContent) {
    selectedContent.style.display = (tabId === 'tab-tactical') ? 'grid' : 'grid';
    selectedContent.classList.add('active');
  }

  // Update Sidebar active state
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  const btnMap = {
    'tab-tactical': 'nav-item-dashboard',
    'tab-benchmark': 'nav-item-benchmark',
    'tab-ear-writing': 'nav-item-ear'
  };
  const activeBtnId = btnMap[tabId];
  if (activeBtnId) {
    const el = document.getElementById(activeBtnId);
    if (el) el.classList.add('active');
  }
}

// Backward compatibility alias for any existing click handlers
function switchTab(tabId) {
  switchMainTab(tabId);
}

function focusVoiceAssistant() {
  switchMainTab('tab-tactical');
  const hero = document.getElementById('section-hero-voice');
  if (hero) {
    hero.scrollIntoView({ behavior: 'smooth' });
    hero.style.boxShadow = '0 0 50px rgba(0, 240, 181, 0.4)';
    setTimeout(() => { hero.style.boxShadow = ''; }, 1200);
  }
}

function scrollToSection(sectionId) {
  switchMainTab('tab-tactical');
  const el = document.getElementById(sectionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
    el.style.borderColor = 'var(--accent-cyan)';
    setTimeout(() => { el.style.borderColor = ''; }, 1200);
  }
}

function toggleTelemetryDrawer() {
  if (dom.telemetryDrawer) {
    dom.telemetryDrawer.classList.toggle('collapsed');
  }
}

// ==============================================================================
// 3. Dynamic Audio Visualizer (3D Holographic Orb & Tactical Oscilloscope)
// ==============================================================================

function applyAndVerifyDisplayMode(requestedMode) {
  const previous = state.currentDisplayMode;

  if (!DISPLAY_MODES[requestedMode]) {
    return {
      success: false,
      error: 'invalid_mode',
      requestedMode: requestedMode,
      activeMode: state.currentDisplayMode,
      activeName: DISPLAY_MODES[state.currentDisplayMode] || 'Unknown'
    };
  }

  try {
    if (requestedMode !== previous) {
      state.previousDisplayMode = previous;
    }
    state.currentDisplayMode = requestedMode;
    state.visualizerMode = requestedMode;

    // Synchronize UI Buttons
    document.querySelectorAll('.vis-mode-chip').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(requestedMode === 'orb' ? 'btn-vis-orb' : 'btn-vis-osc');
    if (activeBtn) activeBtn.classList.add('active');

    // Synchronize 3D Orb Pulsing Rings
    const rings = document.getElementById('orb-pulse-rings');
    if (rings) {
      rings.style.display = requestedMode === 'orb' ? 'block' : 'none';
    }

    // Synchronize Top Header Badge
    if (dom.displayModeIndicatorBadge) {
      dom.displayModeIndicatorBadge.textContent = requestedMode === 'orb' ? '🔮 3D Holographic Orb' : '📊 Tactical Oscilloscope';
    }
  } catch (err) {
    console.error('Failed to apply display mode:', err);
  }

  const actualMode = state.currentDisplayMode;
  const isVerified = (actualMode === requestedMode);

  return {
    success: isVerified,
    previousMode: previous,
    activeMode: actualMode,
    activeName: DISPLAY_MODES[actualMode]
  };
}

function setVisualizerMode(mode) {
  const res = applyAndVerifyDisplayMode(mode);
  if (res.success) {
    appendLog('[VISUALIZER]', 'tag-sys', `Display mode switched to ${res.activeName}.`);
    appendMissionActivity('Display Mode', `Switched to ${res.activeName}.`, 'dot-cyan');
  } else {
    appendLog('[VISUALIZER ERROR]', 'tag-vad', `Could not switch to mode: ${mode}`);
  }
}

let canvasCtx = dom.canvas ? dom.canvas.getContext('2d') : null;
let wavePhase = 0;
let orbRotationX = 0;
let orbRotationY = 0;

// Initialize 3D Orb Particles (Fibonacci Sphere Distribution)
const ORB_PARTICLE_COUNT = 108;
const orbParticles = [];
const PHI = Math.PI * (3 - Math.sqrt(5));

for (let i = 0; i < ORB_PARTICLE_COUNT; i++) {
  const y = 1 - (i / (ORB_PARTICLE_COUNT - 1)) * 2;
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
  const baseRadius = Math.min(width, height) * 0.32;

  const hasNoise = state.activeNoiseType !== null;
  const isAgentSpeaking = state.isAudioPlaying;
  const isUserSpeaking = state.isUserSpeaking || state.isPttRecording;

  const audioEnergy = isAgentSpeaking
    ? Math.max(0.70, state.voiceOutputLevel)
    : (isUserSpeaking
        ? Math.max(0.75, state.voiceInputLevel)
        : (hasNoise ? 0.45 : 0.15));

  const rotSpeedX = (isAgentSpeaking || isUserSpeaking) ? 0.020 : 0.006;
  const rotSpeedY = (isAgentSpeaking || isUserSpeaking) ? 0.028 : 0.009;

  orbRotationX += rotSpeedX;
  orbRotationY += rotSpeedY;

  // 1. Draw Ambient Radial Core Glow
  const glowRadius = baseRadius * (1.15 + 0.40 * Math.sin(wavePhase * 2.5) * audioEnergy);
  const coreGlow = canvasCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);

  if (state.shockwaveAlpha > 0.2) {
    coreGlow.addColorStop(0, `rgba(239, 68, 68, ${0.55 * state.shockwaveAlpha})`);
    coreGlow.addColorStop(0.6, `rgba(248, 113, 113, ${0.25 * state.shockwaveAlpha})`);
  } else if (isUserSpeaking) {
    coreGlow.addColorStop(0, `rgba(96, 165, 250, ${0.65 * audioEnergy})`);
    coreGlow.addColorStop(0.5, `rgba(59, 130, 246, ${0.40 * audioEnergy})`);
    coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else if (isAgentSpeaking) {
    coreGlow.addColorStop(0, `rgba(59, 130, 246, ${0.70 * audioEnergy})`);
    coreGlow.addColorStop(0.5, `rgba(96, 165, 250, ${0.40 * audioEnergy})`);
    coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else if (hasNoise) {
    coreGlow.addColorStop(0, 'rgba(245, 158, 11, 0.40)');
    coreGlow.addColorStop(0.6, 'rgba(245, 158, 11, 0.18)');
    coreGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
  } else {
    coreGlow.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
    coreGlow.addColorStop(0.7, 'rgba(96, 165, 250, 0.08)');
    coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }

  canvasCtx.fillStyle = coreGlow;
  canvasCtx.beginPath();
  canvasCtx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
  canvasCtx.fill();

  // 2. Draw Rotating Orbital Rings
  const ringAngles = [wavePhase * 0.8, -wavePhase * 0.6, wavePhase * 1.1];
  ringAngles.forEach((angle, idx) => {
    canvasCtx.save();
    canvasCtx.translate(centerX, centerY);
    canvasCtx.rotate(angle * 0.5 + idx * (Math.PI / 3));
    canvasCtx.beginPath();
    const rx = baseRadius * (1.15 + idx * 0.15 + ((isAgentSpeaking || isUserSpeaking) ? 0.18 * Math.sin(wavePhase * 3) : 0));
    const ry = rx * 0.35;
    canvasCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    canvasCtx.strokeStyle = isUserSpeaking
      ? `rgba(96, 165, 250, ${0.50 * audioEnergy})`
      : (isAgentSpeaking
          ? `rgba(59, 130, 246, ${0.50 * audioEnergy})`
          : (hasNoise ? 'rgba(245, 158, 11, 0.3)' : 'rgba(96, 165, 250, 0.25)'));
    canvasCtx.lineWidth = (isAgentSpeaking || isUserSpeaking) ? 1.8 : 1.2;
    canvasCtx.setLineDash([3, 5]);
    canvasCtx.stroke();
    canvasCtx.restore();
  });

  // 3. Project 3D Particles
  const projectedPoints = [];
  const cosX = Math.cos(orbRotationX);
  const sinX = Math.sin(orbRotationX);
  const cosY = Math.cos(orbRotationY);
  const sinY = Math.sin(orbRotationY);

  orbParticles.forEach((p, idx) => {
    const waveDisp = Math.sin(p.phase + wavePhase * p.speed) * ((isAgentSpeaking || isUserSpeaking) ? 0.32 : 0.08) * audioEnergy;
    const r = baseRadius * (1.0 + waveDisp);

    const px = p.baseX * r;
    const py = p.baseY * r;
    const pz = p.baseZ * r;

    const x1 = px * cosY + pz * sinY;
    const z1 = -px * sinY + pz * cosY;

    const y2 = py * cosX - z1 * sinX;
    const z2 = py * sinX + z1 * cosX;

    const fov = 350;
    const scale = fov / (fov + z2);
    const screenX = centerX + x1 * scale;
    const screenY = centerY + y2 * scale;
    const alpha = Math.max(0.15, Math.min(1.0, (z2 + baseRadius) / (baseRadius * 2) * 0.9 + 0.1));

    projectedPoints.push({ x: screenX, y: screenY, z: z2, scale, alpha, idx });
  });

  projectedPoints.sort((a, b) => a.z - b.z);

  // 4. Draw Connecting Geodesic Mesh Lines
  canvasCtx.lineWidth = (isAgentSpeaking || isUserSpeaking) ? 1.2 : 0.8;
  for (let i = 0; i < projectedPoints.length; i++) {
    for (let j = i + 1; j < Math.min(i + 4, projectedPoints.length); j++) {
      const p1 = projectedPoints[i];
      const p2 = projectedPoints[j];
      const distSq = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
      const maxDist = (baseRadius * 0.45) ** 2;

      if (distSq < maxDist) {
        const lineAlpha = (1 - distSq / maxDist) * Math.min(p1.alpha, p2.alpha) * ((isAgentSpeaking || isUserSpeaking) ? 0.6 : 0.2);
        canvasCtx.strokeStyle = isUserSpeaking
          ? `rgba(96, 165, 250, ${lineAlpha})`
          : (isAgentSpeaking
              ? `rgba(59, 130, 246, ${lineAlpha})`
              : (hasNoise ? `rgba(245, 158, 11, ${lineAlpha})` : `rgba(96, 165, 250, ${lineAlpha})`));
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x, p1.y);
        canvasCtx.lineTo(p2.x, p2.y);
        canvasCtx.stroke();
      }
    }
  }

  // 5. Draw 3D Nodes / Glowing Particles
  projectedPoints.forEach(p => {
    const dotSize = Math.max(1.2, 3.0 * p.scale * ((isAgentSpeaking || isUserSpeaking) ? 1.5 : 1.0));
    canvasCtx.beginPath();
    canvasCtx.arc(p.x, p.y, dotSize, 0, Math.PI * 2);

    if (isUserSpeaking) {
      canvasCtx.fillStyle = `rgba(96, 165, 250, ${p.alpha})`;
      canvasCtx.shadowColor = '#60A5FA';
      canvasCtx.shadowBlur = 10;
    } else if (isAgentSpeaking) {
      canvasCtx.fillStyle = `rgba(59, 130, 246, ${p.alpha})`;
      canvasCtx.shadowColor = '#3B82F6';
      canvasCtx.shadowBlur = 10;
    } else if (hasNoise) {
      canvasCtx.fillStyle = `rgba(245, 158, 11, ${p.alpha})`;
      canvasCtx.shadowColor = '#F59E0B';
      canvasCtx.shadowBlur = 4;
    } else {
      canvasCtx.fillStyle = `rgba(96, 165, 250, ${p.alpha * 0.9})`;
      canvasCtx.shadowColor = '#60A5FA';
      canvasCtx.shadowBlur = 4;
    }
    canvasCtx.fill();
  });
  canvasCtx.shadowBlur = 0;

  // 6. Draw State Fencing Shockwave
  if (state.shockwaveAlpha > 0.01) {
    canvasCtx.save();
    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, state.shockwaveRadius, 0, Math.PI * 2);
    canvasCtx.strokeStyle = `rgba(239, 68, 68, ${state.shockwaveAlpha})`;
    canvasCtx.lineWidth = 3;
    canvasCtx.shadowColor = '#EF4444';
    canvasCtx.shadowBlur = 16;
    canvasCtx.stroke();
    canvasCtx.restore();

    state.shockwaveRadius += 4.5;
    state.shockwaveAlpha *= 0.94;
  }
}

function drawOscilloscope(width, height) {
  // Grid Lines
  canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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

  // Center Line
  canvasCtx.strokeStyle = 'rgba(96, 165, 250, 0.25)';
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, height / 2);
  canvasCtx.lineTo(width, height / 2);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);

  const isAgentSpeaking = state.isAudioPlaying;
  const isUserSpeaking = state.isUserSpeaking || state.isPttRecording;
  const hasNoise = state.activeNoiseType !== null;

  const amp = isUserSpeaking
    ? (45 + 30 * state.voiceInputLevel)
    : (isAgentSpeaking
        ? (38 + 25 * state.voiceOutputLevel)
        : (hasNoise ? 20 : 8));

  const freq = isUserSpeaking ? 0.065 : (isAgentSpeaking ? 0.042 : (hasNoise ? 0.03 : 0.015));

  const color = isUserSpeaking
    ? '#60A5FA'
    : (isAgentSpeaking
        ? '#3B82F6'
        : (hasNoise ? '#F59E0B' : 'rgba(96, 165, 250, 0.45)'));

  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = (isAgentSpeaking || isUserSpeaking) ? 3.0 : 1.5;
  canvasCtx.shadowColor = color;
  canvasCtx.shadowBlur = (isAgentSpeaking || isUserSpeaking) ? 14 : (hasNoise ? 8 : 2);

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

  const isSpeaking = state.isAudioPlaying || state.isUserSpeaking || state.isPttRecording;
  const audioEnergy = isSpeaking
    ? Math.max(0.65, state.isAudioPlaying ? state.voiceOutputLevel : state.voiceInputLevel)
    : (state.activeNoiseType !== null ? 0.35 : 0.08);

  if (dom.vuMeterFill) {
    dom.vuMeterFill.style.width = Math.min(100, Math.round(audioEnergy * 100)) + '%';
  }

  wavePhase += isSpeaking ? 0.12 : (state.activeNoiseType !== null ? 0.07 : 0.03);
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
  document.querySelectorAll('.noise-chip').forEach(b => b.classList.remove('active-noise'));
  if (dom.noiseIndicator) {
    dom.noiseIndicator.textContent = 'NORMAL MIC';
    dom.noiseIndicator.style.color = 'var(--text-muted)';
  }
  appendLog('[ADVERSE NOISE]', 'tag-sys', 'Ambient tactical noise muted. Normal mic channel active.');
}

function toggleNoise(type) {
  initAudioContext();
  if (state.activeNoiseType === type) {
    stopAllNoise();
    return;
  }

  stopAllNoise();
  state.activeNoiseType = type;

  document.querySelectorAll('.noise-chip').forEach(b => b.classList.remove('active-noise'));
  const activeBtn = document.getElementById(`btn-noise-${type === 'helicopter' ? 'helo' : (type === 'siren' ? 'siren' : 'er')}`);
  if (activeBtn) activeBtn.classList.add('active-noise');

  if (dom.noiseIndicator) {
    dom.noiseIndicator.textContent = type.toUpperCase();
    dom.noiseIndicator.style.color = 'var(--accent-amber)';
  }

  if (type === 'helicopter') {
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
    lfo.frequency.value = 4.5;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain.gain);

    noise.connect(filter);
    filter.connect(noiseGainNode);
    noise.start();
    lfo.start();
    activeNoiseNodes.push(noise, lfo);

    appendLog('[ADVERSE NOISE INJECTED]', 'tag-vad', 'Medevac Helicopter rotor wash active (~82 dB SPL).');

  } else if (type === 'siren') {
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 750;

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.6;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 250;

    lfo.connect(osc.frequency);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;

    osc.connect(filter);
    filter.connect(noiseGainNode);
    osc.start();
    lfo.start();
    activeNoiseNodes.push(osc, lfo);

    appendLog('[ADVERSE NOISE INJECTED]', 'tag-vad', 'Ambulance Siren Wail active (~88 dB SPL).');

  } else if (type === 'trauma_bay') {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 880;

    const beepGain = audioCtx.createGain();
    beepGain.gain.value = 0.1;

    const lfo = audioCtx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1.25;
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
      if (isRime) tr.classList.add('highlight-winner-row');

      tr.innerHTML = `
        <td><strong>${isRime ? '🏆 ' : ''}${p.name}</strong></td>
        <td><code>${p.model}</code></td>
        <td>${p.audio_format}</td>
        <td><span class="${isRime ? 'badge-tag-cyan' : ''}">${p.measured_ttfa_ms} ms</span></td>
        <td>${p.warm_synthesis_ms} ms</td>
        <td>${p.cold_synthesis_ms} ms</td>
        <td><strong>${p.clinical_phoneme_clarity_score} / 10</strong></td>
        <td><span class="${p.interruption_cutoff_ms < 150 ? 'badge-tag-green' : ''}">${p.interruption_cutoff_ms} ms (${p.interruption_cutoff_ms < 150 ? 'Pass' : 'Fail'})</span></td>
      `;
      tbody.appendChild(tr);
    }

    appendLog('[BENCHMARK SUCCESS]', 'tag-rime', `Benchmark updated. Rime TTFA: ${data.providers.rime.measured_ttfa_ms}ms.`);
    appendMissionActivity('Benchmark Complete', `Rime TTFA measured at ${data.providers.rime.measured_ttfa_ms}ms.`, 'dot-cyan');
  } catch (err) {
    appendLog('[BENCHMARK ERROR]', 'tag-vad', `Benchmark failed: ${err.message}`);
  }
}

// ==============================================================================
// 6. "Writing for the Ear" Pharmacopeia Normalizer
// ==============================================================================

async function runPhoneticNormalization() {
  const rawText = dom.rawEarInput ? dom.rawEarInput.value.trim() : '';
  const earSelect = document.getElementById('pacing-select-ear');
  const triageLevel = earSelect ? earSelect.value : (dom.pacingSelect ? dom.pacingSelect.value : 'urgent');
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
    appendLog('[PHONETIC NORMALIZER]', 'tag-rime', `Normalized: "${data.raw_text.substring(0, 30)}..." -> "${data.normalized_text.substring(0, 40)}..."`);
  } catch (e) {
    console.error(e);
  }
}

async function speakNormalizedText() {
  const text = dom.normalizedPreview ? dom.normalizedPreview.textContent.trim() : '';
  const earSelect = document.getElementById('pacing-select-ear');
  const triageLevel = earSelect ? earSelect.value : (dom.pacingSelect ? dom.pacingSelect.value : 'urgent');
  if (!text) return;

  appendLog('[RIME STREAM]', 'tag-rime', `Streaming ear-optimized audio: "${text.substring(0, 40)}..."`);
  try {
    state.isAudioPlaying = true;
    const activeVoice = state.selectedSpeaker || 'wawona';
    const activeModel = state.selectedModel || 'coda';
    if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AEGIS is responding...';

    const res = await fetch('/api/tts-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        triage_level: triageLevel,
        modelId: activeModel,
        speaker: activeVoice
      })
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
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Ready for voice command';
      };
    }
  } catch (err) {
    state.isAudioPlaying = false;
    appendLog('[RIME STREAM NOTICE]', 'tag-sys', `Direct feedback: ${err.message}`);
    speakTextWithBrowserVoice(text);
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
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  state.isAudioPlaying = false;
  const elapsed = (performance.now() - t0);

  state.activeFenceId += 1;
  updateFenceDisplay(state.activeFenceId);
  triggerOrbShockwave();

  if (dom.visualizerStatus) dom.visualizerStatus.textContent = `Listening... (Barge-in: ${elapsed.toFixed(2)}ms)`;
  if (dom.measuredCutoffVal) dom.measuredCutoffVal.textContent = `${elapsed.toFixed(2)} ms Cutoff`;
  if (dom.statCutoff) dom.statCutoff.textContent = `${elapsed.toFixed(2)} ms`;

  appendLog('[MANUAL BARGE-IN]', 'tag-vad', `Speech onset! Playback queue flushed in ${elapsed.toFixed(2)}ms.`);
  appendLog('[STATE FENCE]', 'tag-fence', `Token incremented to #${state.activeFenceId}. Stale buffer discarded.`);
  appendMissionActivity('Barge-in Detected', `Flushed audio queue in ${elapsed.toFixed(2)}ms.`, 'dot-amber');
}

// ==============================================================================
// 8. Speech Recognition & Voice Interaction Pipeline
// ==============================================================================

const INTERRUPT_TRIGGER_PHRASES = [
  'wait', 'stop', 'hold on', 'cancel', 'correction',
  'no no', 'no wait', 'pause', 'shut up', 'quiet', 'nevermind'
];

function isExplicitInterruptPhrase(text) {
  const t = text.toLowerCase().trim();
  return INTERRUPT_TRIGGER_PHRASES.some(phrase => t.startsWith(phrase) || t.includes(` ${phrase}`));
}

let speechDebounceTimer = null;
let lastProcessedTranscript = "";
let isTurnInProgress = false;

function initSpeechRecognition() {
  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionClass) {
    console.warn('SpeechRecognition not supported in this browser.');
    return null;
  }

  const rec = new SpeechRecognitionClass();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    if (dom.navMicDot) dom.navMicDot.className = 'status-dot dot-green';
    if (dom.navMicText) dom.navMicText.textContent = 'LISTENING';
  };

  rec.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const item = event.results[i];
      if (item.isFinal) {
        finalTranscript += item[0].transcript;
      } else {
        interimTranscript += item[0].transcript;
      }
    }

    if (interimTranscript && interimTranscript.trim().length > 0) {
      state.isUserSpeaking = true;
      state.activeSpeaker = 'user';
      state.voiceInputLevel = 0.85;
      if (dom.liveTranscriptPreview) {
        dom.liveTranscriptPreview.textContent = `Medic: "${interimTranscript}"`;
      }
      if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Listening...';

      if (state.isAudioPlaying) {
        if (isExplicitInterruptPhrase(interimTranscript)) {
          triggerManualBargeIn();
          handleVoiceTurn(interimTranscript, true);
        }
        return;
      }

      if (!state.isAudioPlaying && interimTranscript.length > 3) {
        clearTimeout(speechDebounceTimer);
        speechDebounceTimer = setTimeout(() => {
          if (!isTurnInProgress && interimTranscript !== lastProcessedTranscript) {
            handleVoiceTurn(interimTranscript);
          }
        }, 750);
      }
    }

    if (finalTranscript && finalTranscript.trim().length > 1) {
      clearTimeout(speechDebounceTimer);
      const text = finalTranscript.trim();
      state.isUserSpeaking = true;
      state.activeSpeaker = 'user';
      state.voiceInputLevel = 0.9;
      if (dom.liveTranscriptPreview) dom.liveTranscriptPreview.textContent = `Medic: "${text}"`;

      if (state.isAudioPlaying) {
        if (isExplicitInterruptPhrase(text)) {
          triggerManualBargeIn();
          handleVoiceTurn(text, true);
        }
        return;
      }

      if (text !== lastProcessedTranscript) {
        handleVoiceTurn(text);
      }
    }
  };

  rec.onerror = (event) => {
    state.isUserSpeaking = false;
    state.voiceInputLevel = 0.0;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      state.isContinuousListening = false;
      state.isPttRecording = false;
      if (dom.btnLiveVoice) dom.btnLiveVoice.classList.remove('active-listening');
      if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'TALK TO AEGIS';
      if (dom.navMicText) dom.navMicText.textContent = 'BLOCKED';
      if (dom.navMicDot) dom.navMicDot.className = 'status-dot dot-amber';
      appendLog('[MIC NOTICE]', 'tag-vad', 'Microphone access denied. Please click the lock icon in your browser to allow microphone access.');
    }
  };

  rec.onend = () => {
    state.isUserSpeaking = false;
    state.voiceInputLevel = 0.0;
    if (state.isContinuousListening) {
      setTimeout(() => {
        if (state.isContinuousListening) {
          try { rec.start(); } catch (e) {}
        }
      }, 300);
    } else {
      if (dom.navMicDot) dom.navMicDot.className = 'status-dot dot-cyan';
      if (dom.navMicText) dom.navMicText.textContent = 'STANDBY';
    }
  };

  return rec;
}

function toggleLiveVoiceConversation() {
  if (!state.speechRecognition) {
    state.speechRecognition = initSpeechRecognition();
  }

  if (!state.speechRecognition) {
    handleVoiceTurn('Calculate epinephrine dosage for 68kg adult');
    return;
  }

  state.isContinuousListening = !state.isContinuousListening;

  if (state.isContinuousListening) {
    try {
      state.speechRecognition.start();
    } catch (e) {}
    if (dom.btnLiveVoice) dom.btnLiveVoice.classList.add('active-listening');
    if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'LISTENING...';
    if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Listening...';
    appendLog('[LIVE VOICE AGENT]', 'tag-rime', 'Hands-free voice active. Speak freely into your microphone.');
    appendMissionActivity('Voice Session', 'Hands-free continuous listening started.', 'dot-green');
  } else {
    try {
      state.speechRecognition.stop();
    } catch (e) {}
    state.isUserSpeaking = false;
    state.voiceInputLevel = 0.0;
    if (dom.btnLiveVoice) dom.btnLiveVoice.classList.remove('active-listening');
    if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'TALK TO AEGIS';
    if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Ready for voice command';
    appendLog('[LIVE VOICE AGENT]', 'tag-sys', 'Voice session paused.');
  }
}

function startPttSpeech() {
  state.isPttRecording = true;
  state.isUserSpeaking = true;
  state.activeSpeaker = 'user';
  state.voiceInputLevel = 0.85;
  if (dom.btnPttVoice) dom.btnPttVoice.classList.add('active-ptt');
  if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Listening... (PTT Active)';
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
  state.isUserSpeaking = false;
  state.voiceInputLevel = 0.0;
  if (dom.btnPttVoice) dom.btnPttVoice.classList.remove('active-ptt');
  if (state.speechRecognition && !state.isContinuousListening) {
    try { state.speechRecognition.stop(); } catch (e) {}
  }
}

function sendTypedVoiceQuery() {
  const input = document.getElementById('voice-typed-input');
  if (!input) return;
  const text = input.value.trim();
  if (text) {
    state.isUserSpeaking = true;
    state.voiceInputLevel = 0.9;
    setTimeout(() => { state.isUserSpeaking = false; }, 800);
    handleVoiceTurn(text);
    input.value = '';
  }
}

function detectClientDisplayCommand(transcript, currentMode, previousMode) {
  const t = transcript.toLowerCase().trim();
  const tClean = t.replace(/[^\w\s]/g, '');

  const orbKeywords = ['holographic', 'hologram', '3d orb', '3d holographic', 'holo mode', 'orb mode'];
  const isOrb = orbKeywords.some(k => tClean.includes(k)) || (tClean.includes('orb') && ['switch', 'mode', 'display', 'show', 'use', 'make', 'turn on', 'activate', 'change'].some(w => tClean.includes(w)));

  const oscKeywords = ['oscilloscope', 'tactical oscilloscope', 'oscilloscope mode', 'tactical mode', 'tactical display'];
  const isOsc = oscKeywords.some(k => tClean.includes(k)) || (tClean.includes('tactical') && ['switch', 'mode', 'display', 'show', 'use', 'make', 'turn on', 'activate', 'change', 'oscilloscope'].some(w => tClean.includes(w)));

  if (tClean.includes('to holographic') || tClean.includes('to orb')) {
    return { intent: 'set_mode', mode: 'orb', modeName: DISPLAY_MODES.orb };
  }
  if (tClean.includes('to oscilloscope') || tClean.includes('to tactical')) {
    return { intent: 'set_mode', mode: 'oscilloscope', modeName: DISPLAY_MODES.oscilloscope };
  }

  if (isOrb && !isOsc) return { intent: 'set_mode', mode: 'orb', modeName: DISPLAY_MODES.orb };
  if (isOsc && !isOrb) return { intent: 'set_mode', mode: 'oscilloscope', modeName: DISPLAY_MODES.oscilloscope };

  if (['go back', 'switch back', 'revert', 'previous mode', 'go back to previous', 'revert display', 'back'].includes(tClean) || tClean.includes('go back')) {
    if (previousMode && DISPLAY_MODES[previousMode] && previousMode !== currentMode) {
      return { intent: 'set_mode', mode: previousMode, modeName: DISPLAY_MODES[previousMode] };
    }
    return {
      intent: 'ask_clarification',
      reply: 'Which display mode would you like to go to? I can switch to 3D Holographic Orb or Tactical Oscilloscope.'
    };
  }

  const ambiguous = [
    'change the display', 'switch the display', 'change display', 'switch display',
    'change mode', 'switch mode', 'change the mode', 'switch the mode',
    'change visualizer', 'switch visualizer', 'change view', 'switch view',
    'change screen', 'switch screen'
  ];
  if (ambiguous.some(p => tClean === p || tClean.startsWith(p))) {
    return {
      intent: 'ask_clarification',
      reply: 'Sure! Which display mode would you like? I can switch to 3D Holographic Orb or Tactical Oscilloscope.'
    };
  }

  const invalidMatch = tClean.match(/(?:switch\s+to|change\s+to|go\s+to|activate|turn\s+on|use)\s+(?:the\s+)?([a-z0-9\s]+?)\s+(?:mode|display|visualizer)/);
  if (invalidMatch) {
    const candidate = invalidMatch[1].trim();
    if (!['holographic', '3d holographic', 'orb', '3d orb', 'tactical', 'tactical oscilloscope', 'oscilloscope'].includes(candidate)) {
      const titleCandidate = candidate.replace(/\b\w/g, c => c.toUpperCase());
      return {
        intent: 'invalid_mode',
        invalidModeName: titleCandidate,
        reply: `I don't recognize ${titleCandidate} mode. I can switch between 3D Holographic Orb and Tactical Oscilloscope.`
      };
    }
  }

  return null;
}

async function handleVoiceTurn(transcript, isInterrupt = false) {
  if (!transcript || transcript.trim().length === 0) return;

  if (dom.rimeAudioElement) {
    try { dom.rimeAudioElement.pause(); } catch (e) {}
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  state.isAudioPlaying = false;

  const thisTurnId = ++state.activeVoiceTurnId;
  const userTime = new Date().toLocaleTimeString('en-US', { hour12: false });
  const lower = transcript.toLowerCase();
  const isBarge = isInterrupt || isExplicitInterruptPhrase(lower);

  if (isBarge) {
    triggerManualBargeIn();
  }

  // 1. Append User Dialogue Bubble
  appendDialogueBubble('👨‍⚕️ FIELD MEDIC', transcript, userTime, isBarge ? 'BARGE-IN' : 'VOICE INPUT', isBarge);
  appendLog(isBarge ? '[USER BARGE-IN]' : '[USER SPEECH]', isBarge ? 'tag-vad' : 'tag-user', `"${transcript}"`);
  appendMissionActivity('Voice Input Detected', `"${transcript.substring(0, 38)}..."`, 'dot-cyan');

  // 2. Update UI Status to Thinking
  if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Analyzing clinical request...';
  if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'ANALYZING...';

  const tStartTurn = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch('/api/voice-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        transcript: transcript,
        is_interrupt: isBarge,
        fence_id: state.activeFenceId,
        triage_level: dom.pacingSelect ? dom.pacingSelect.value : 'urgent',
        speaker: state.selectedSpeaker || 'wawona',
        modelId: state.selectedModel || 'coda',
        current_display_mode: state.currentDisplayMode,
        previous_display_mode: state.previousDisplayMode
      })
    });

    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const roundTripMs = Math.round(performance.now() - tStartTurn);

    if (thisTurnId !== state.activeVoiceTurnId) {
      console.warn(`[RACE CONDITION] Stale turn #${thisTurnId} discarded.`);
      return;
    }

    // 3. Action Execution & State Verification Pipeline
    if (data.action && data.action.type === 'set_display_mode') {
      const verifyRes = applyAndVerifyDisplayMode(data.action.mode);
      if (verifyRes.success) {
        data.reply_text = data.reply_text || `Done! I switched the display to ${verifyRes.activeName}.`;
      } else {
        data.reply_text = `I couldn't switch to ${DISPLAY_MODES[data.action.mode] || 'that mode'}. Please try again.`;
        data.audio_base64 = null;
      }
    }

    // 4. Update State Fencing & Dosage Card
    if (data.fence_id) {
      updateFenceDisplay(data.fence_id);
    }
    if (data.is_barge_in && data.cutoff_ms) {
      if (dom.measuredCutoffVal) dom.measuredCutoffVal.textContent = `${data.cutoff_ms.toFixed(2)} ms Cutoff`;
      if (dom.statCutoff) dom.statCutoff.textContent = `${data.cutoff_ms.toFixed(2)} ms`;
      appendLog('[STATE FENCE ACTIVE]', 'tag-fence', `Sequence token incremented to #${data.fence_id}. Cutoff: ${data.cutoff_ms}ms.`);
    }
    if (data.dosage_card) {
      updateDosageCard(data.dosage_card);
      appendMissionActivity('Dosage Calculated', `${data.dosage_card.medication || 'Order'}: ${data.dosage_card.dose || 'Standard'}`, 'dot-green');
    }

    const agentTime = new Date().toLocaleTimeString('en-US', { hour12: false });
    const providerTag = data.audio_base64 ? `RIME CODA (${roundTripMs}ms TTFA)` : 'AEGIS TACTICAL ENGINE';
    appendDialogueBubble('🤖 AEGIS MEDIC', data.reply_text, agentTime, providerTag, false);
    appendMissionActivity('Rime Response Generated', `Synthesized speech (${roundTripMs}ms TTFA).`, 'dot-cyan');

    if (data.audio_base64) {
      playBase64Audio(data.audio_base64, data.normalized_text || data.reply_text);
      appendLog('[RIME TTS AUDIO STREAM]', 'tag-rime', `Synthesized speech (${roundTripMs}ms TTFA): "${data.reply_text.substring(0, 45)}..."`);
    } else {
      speakTextWithBrowserVoice(data.reply_text);
      appendLog('[SPEECH SYNTHESIS]', 'tag-rime', `Speaking guidance (${roundTripMs}ms): "${data.reply_text.substring(0, 45)}..."`);
    }

  } catch (err) {
    if (thisTurnId !== state.activeVoiceTurnId) return;

    appendLog('[VOICE TURN NOTICE]', 'tag-sys', `Handling local turn: ${transcript}`);
    const clientDisplayCmd = detectClientDisplayCommand(transcript, state.currentDisplayMode, state.previousDisplayMode);

    let finalReply = "";
    let finalCard = null;

    if (clientDisplayCmd) {
      if (clientDisplayCmd.intent === 'set_mode') {
        const verifyRes = applyAndVerifyDisplayMode(clientDisplayCmd.mode);
        finalReply = verifyRes.success ? `Done! I switched the display to ${verifyRes.activeName}.` : `I couldn't switch to ${DISPLAY_MODES[clientDisplayCmd.mode]}. Please try again.`;
        finalCard = { medication: "Display Mode Control", dose: `Active: ${verifyRes.activeName}`, route: "Client Mode Switch", patient_weight_kg: 68 };
      } else {
        finalReply = clientDisplayCmd.reply;
        finalCard = { medication: "Display Configuration", dose: "Clarification", route: "Client Fallback", patient_weight_kg: 68 };
      }
    } else {
      const fallbackAnswer = generateClientClinicalFallback(transcript);
      finalReply = fallbackAnswer.text;
      finalCard = fallbackAnswer.card;
    }

    const agentTime = new Date().toLocaleTimeString('en-US', { hour12: false });
    appendDialogueBubble('🤖 AEGIS MEDIC', finalReply, agentTime, 'AEGIS TACTICAL ENGINE', false);
    if (finalCard) updateDosageCard(finalCard);
    speakTextWithBrowserVoice(finalReply);
  } finally {
    setTimeout(() => {
      isTurnInProgress = false;
      if (!state.isAudioPlaying && dom.liveVoiceBtnText) {
        dom.liveVoiceBtnText.textContent = state.isContinuousListening ? 'LISTENING...' : 'TALK TO AEGIS';
      }
    }, 400);
  }
}

function playBase64Audio(base64Data, label = '') {
  try {
    if (state.activeAudioBlobUrl) {
      try { URL.revokeObjectURL(state.activeAudioBlobUrl); } catch (e) {}
      state.activeAudioBlobUrl = null;
    }

    const binaryStr = window.atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes.buffer], { type: 'audio/mp3' });
    const blobUrl = URL.createObjectURL(blob);
    state.activeAudioBlobUrl = blobUrl;

    if (dom.rimeAudioElement) {
      dom.rimeAudioElement.src = blobUrl;
      dom.rimeAudioElement.style.display = 'block';

      state.isAudioPlaying = true;
      state.activeSpeaker = 'agent';
      state.voiceOutputLevel = 0.85;

      if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AEGIS is responding...';
      if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'SPEAKING...';

      dom.rimeAudioElement.play().catch(e => {
        console.warn('Auto-play notice:', e);
        speakTextWithBrowserVoice(label || 'Guidance synthesized.');
      });

      dom.rimeAudioElement.onplay = () => {
        state.isAudioPlaying = true;
        state.activeSpeaker = 'agent';
        state.voiceOutputLevel = 0.85;
      };

      dom.rimeAudioElement.ontimeupdate = () => {
        if (state.isAudioPlaying) {
          state.voiceOutputLevel = 0.65 + 0.35 * Math.sin(performance.now() * 0.02);
        }
      };

      dom.rimeAudioElement.onended = () => {
        state.isAudioPlaying = false;
        state.activeSpeaker = 'idle';
        state.voiceOutputLevel = 0.0;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = state.isContinuousListening ? 'Listening...' : 'Ready for voice command';
        if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = state.isContinuousListening ? 'LISTENING...' : 'TALK TO AEGIS';
      };

      dom.rimeAudioElement.onerror = () => {
        state.isAudioPlaying = false;
        state.voiceOutputLevel = 0.0;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Ready for voice command';
      };
    }
  } catch (err) {
    console.error('Base64 audio playback error:', err);
    state.isAudioPlaying = false;
    speakTextWithBrowserVoice(label || 'Clinical response.');
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
      state.activeSpeaker = 'agent';
      state.voiceOutputLevel = 0.85;

      if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AEGIS is responding...';
      if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = 'SPEAKING...';

      utter.onboundary = () => {
        if (state.isAudioPlaying) {
          state.voiceOutputLevel = 0.7 + 0.3 * Math.random();
        }
      };

      utter.onend = () => {
        state.isAudioPlaying = false;
        state.activeSpeaker = 'idle';
        state.voiceOutputLevel = 0.0;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = state.isContinuousListening ? 'Listening...' : 'Ready for voice command';
        if (dom.liveVoiceBtnText) dom.liveVoiceBtnText.textContent = state.isContinuousListening ? 'LISTENING...' : 'TALK TO AEGIS';
      };
      utter.onerror = () => {
        state.isAudioPlaying = false;
        state.activeSpeaker = 'idle';
        state.voiceOutputLevel = 0.0;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Ready for voice command';
      };
      window.speechSynthesis.speak(utter);
    } else {
      appendLog('[TTS NOTICE]', 'tag-sys', 'Browser speech synthesis unavailable.');
      state.isAudioPlaying = false;
    }
  } catch (e) {
    console.error('Speech synthesis error:', e);
    state.isAudioPlaying = false;
    if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'Ready for voice command';
  }
}

function generateClientClinicalFallback(query) {
  const q = query.toLowerCase();
  if (q.includes('hello') || q.includes('hi') || q.includes('status')) {
    return {
      text: "Aegis Medic online and operational. Ready for trauma triage, medication dosage calculations, or clinical advice. What is your patient status?",
      card: { medication: "System Online", dose: "Ready for input", route: "Voice Stream Active", patient_weight_kg: 68 }
    };
  }
  if (q.includes('fever') || q.includes('paracetamol') || q.includes('temperature') || q.includes('tylenol')) {
    const isStatement = q.includes('is the medicine') || q.includes('is used for');
    return {
      text: (isStatement ? "Correct. " : "") + "For adult fever, administer one thousand milligrams Acetaminophen oral or IV every six hours. For pediatric patients, dose at fifteen milligrams per kilogram.",
      card: { medication: "Acetaminophen (Paracetamol)", dose: "1000 mg (or 15 mg/kg peds)", route: "Oral / IV q6h", patient_weight_kg: 68 }
    };
  }
  if (q.includes('first aid') || q.includes('emergency') || q.includes('abcde')) {
    return {
      text: "Primary first aid triage follows the ABCDE survey: control massive bleeding immediately with direct pressure or tourniquet, secure the airway, verify breathing, and prevent hypothermia.",
      card: { medication: "Primary ABCDE Trauma Survey", dose: "Life Threat Control", route: "Tactical Triage", patient_weight_kg: 68 }
    };
  }
  if (q.includes('fentanyl') || q.includes('pediatric')) {
    return {
      text: "For pediatric trauma analgesia at twenty-five kilograms, administer twenty-five to fifty micrograms Fentanyl IV slow push over two minutes.",
      card: { medication: "Fentanyl (Pediatric)", dose: "25 to 50 mcg", route: "IV / IN Slow Push", patient_weight_kg: 25 }
    };
  }
  if (q.includes('epinephrine') || q.includes('cardiac') || q.includes('cpr') || q.includes('dose')) {
    return {
      text: "For adult cardiac arrest at sixty-eight kilograms, administer one milligram Epinephrine IV push in ten milliliters normal saline every three to five minutes.",
      card: { medication: "Epinephrine (1:10,000)", dose: "1.0 mg (10 mL)", route: "IV / IO Push", patient_weight_kg: 68 }
    };
  }
  if (q.includes('tranexamic') || q.includes('txa') || q.includes('hemorrhage') || q.includes('bleed')) {
    return {
      text: "For severe trauma hemorrhage within three hours of injury, administer one gram Tranexamic Acid IV piggyback in one hundred milliliters normal saline over ten minutes.",
      card: { medication: "Tranexamic Acid (TXA)", dose: "1.0 g in 100 mL NS", route: "IV Piggyback over 10 min", patient_weight_kg: 68 }
    };
  }
  return {
    text: "For this clinical case: assess airway, breathing, circulation, and vital signs, then specify if you need dosing or trauma protocol guidance.",
    card: { medication: "Clinical Triage Protocol", dose: "Standard Order", route: "Tactical Decision Support", patient_weight_kg: 68 }
  };
}

function appendDialogueBubble(speaker, text, time, metaTag, isBargeIn = false) {
  if (!dom.conversationFeed) return;

  const isAgent = speaker.includes('AEGIS');
  const bubble = document.createElement('div');
  bubble.className = `dialogue-bubble ${isAgent ? 'agent-bubble' : 'user-bubble'} ${isBargeIn ? 'barge-in-user' : ''}`;

  const safeText = text.replace(/"/g, '&quot;');

  bubble.innerHTML = `
    <div class="bubble-header">
      <div class="speaker-meta">
        <span class="speaker-icon">${isAgent ? '🤖' : '👨‍⚕️'}</span>
        <span class="speaker-name">${speaker}</span>
        <span class="speaker-tag ${isBargeIn ? 'danger-tag' : ''}">${metaTag}</span>
      </div>
      <span class="bubble-time">${time}</span>
    </div>
    <div class="bubble-body">
      "${text}"
    </div>
    ${isAgent ? `
    <div class="bubble-actions">
      <button class="bubble-action-btn" onclick="copyBubbleText(this, \`${safeText.replace(/`/g, '\\`')}\`)">📋 Copy Text</button>
      <button class="bubble-action-btn" onclick="replayBubbleSpeech(\`${safeText.replace(/`/g, '\\`')}\`)">🔊 Replay Voice</button>
    </div>` : ''}
  `;

  dom.conversationFeed.appendChild(bubble);
  dom.conversationFeed.scrollTop = dom.conversationFeed.scrollHeight;

  state.dialogueTurnCount += 1;
  if (dom.dialogueCounter) {
    dom.dialogueCounter.textContent = `${state.dialogueTurnCount} Turns`;
  }
}

function copyBubbleText(btn, text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1600);
    }).catch(e => console.warn('Copy notice:', e));
  }
}

function replayBubbleSpeech(text) {
  if (dom.rimeAudioElement && dom.rimeAudioElement.src && !dom.rimeAudioElement.paused) {
    dom.rimeAudioElement.currentTime = 0;
    dom.rimeAudioElement.play().catch(() => speakTextWithBrowserVoice(text));
  } else {
    speakTextWithBrowserVoice(text);
  }
}

function updateDosageCard(card) {
  if (!card) return;
  if (dom.cardMed) dom.cardMed.textContent = (card.medication || 'Clinical Order').toUpperCase();
  if (dom.cardDose) dom.cardDose.textContent = card.dose || 'Standard Dose';
  if (dom.cardRoute) dom.cardRoute.textContent = card.route || 'IV / IO Push';
  if (dom.cardPatient) dom.cardPatient.textContent = `${card.patient_weight_kg ? card.patient_weight_kg + ' kg adult' : '68 kg adult'}`;
  if (dom.drawerFenceId) dom.drawerFenceId.textContent = `FENCE TOKEN #${card.fence_id || state.activeFenceId}`;
}

function updateFenceDisplay(fenceId) {
  state.activeFenceId = fenceId;
  if (dom.activeFenceId) dom.activeFenceId.textContent = `#${fenceId}`;
  if (dom.drawerFenceId) dom.drawerFenceId.textContent = `FENCE TOKEN #${fenceId}`;
}

function appendLog(tag, tagClass, msg) {
  if (!dom.terminalFeed) return;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-tag ${tagClass}">${tag}</span> <span class="log-msg">${msg}</span>`;
  dom.terminalFeed.appendChild(entry);
  dom.terminalFeed.scrollTop = dom.terminalFeed.scrollHeight;
}

function appendMissionActivity(title, desc, dotClass = 'dot-cyan') {
  if (!dom.missionTimeline) return;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const item = document.createElement('div');
  item.className = 'timeline-event-item';
  item.innerHTML = `
    <span class="timeline-time">${time}</span>
    <div class="timeline-dot-connector"><span class="t-dot ${dotClass}"></span><span class="t-line"></span></div>
    <div class="timeline-content">
      <strong class="timeline-title">${title}</strong>
      <p class="timeline-desc">${desc}</p>
    </div>
  `;
  dom.missionTimeline.insertBefore(item, dom.missionTimeline.firstChild);
}

function clearEventLogs() {
  if (dom.terminalFeed) dom.terminalFeed.innerHTML = '';
  if (dom.missionTimeline) dom.missionTimeline.innerHTML = '';
  appendLog('[LOGS CLEARED]', 'tag-sys', 'Telemetry and mission activity logs cleared.');
}

function updateClock() {
  if (dom.hudClock) {
    const now = new Date();
    dom.hudClock.textContent = now.toISOString().substring(11, 19) + ' UTC';
  }
}

function updatePacingMode(val) {
  appendLog('[PACING PROTOCOL]', 'tag-rime', `Updated speech pacing mode to: ${val}`);
}

async function fetchTelemetry() {
  try {
    const res = await fetch('/api/telemetry');
    if (res.ok) {
      const data = await res.json();
      if (dom.statCutoff && data.benchmarks) {
        dom.statCutoff.textContent = `${data.benchmarks.interruption_cutoff_ms} ms`;
      }
    }
  } catch (e) {}
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

  runPhoneticNormalization();
  state.speechRecognition = initSpeechRecognition();

  if (dom.rimeVoiceSelect) {
    dom.rimeVoiceSelect.addEventListener('change', (e) => {
      state.selectedSpeaker = e.target.value;
      state.selectedModel = (e.target.value === 'cove') ? 'mistv3' : 'coda';
      appendLog('[VOICE SELECT]', 'tag-rime', `Switched active speech voice to: ${state.selectedSpeaker} (${state.selectedModel})`);
      appendMissionActivity('Voice Changed', `Switched active speaker to ${state.selectedSpeaker}.`, 'dot-cyan');
    });
  }
});
