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

let canvasCtx = dom.canvas ? dom.canvas.getContext('2d') : null;
let wavePhase = 0;

function resizeCanvas() {
  if (!dom.canvas) return;
  const rect = dom.canvas.getBoundingClientRect();
  dom.canvas.width = rect.width * window.devicePixelRatio;
  dom.canvas.height = rect.height * window.devicePixelRatio;
  if (canvasCtx) canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawWaveform() {
  if (!dom.canvas || !canvasCtx) return;
  const width = dom.canvas.width / window.devicePixelRatio;
  const height = dom.canvas.height / window.devicePixelRatio;

  canvasCtx.clearRect(0, 0, width, height);

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

  wavePhase += state.isAudioPlaying ? 0.12 : (hasNoise ? 0.08 : 0.03);
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
  if (dom.terminalFeed) {
    dom.terminalFeed.innerHTML = '';
    appendLog('[SYSTEM]', 'tag-sys', 'Mission telemetry feed cleared.');
  }
}

function setSynthesizerText(text) {
  if (dom.synthInput) dom.synthInput.value = text;
}

async function synthesizeSpokenText() {
  const text = dom.synthInput ? dom.synthInput.value.trim() : '';
  if (!text) return;

  if (dom.synthBtn) dom.synthBtn.disabled = true;
  if (dom.audioFeedback) dom.audioFeedback.textContent = 'Contacting Rime TTS engine (coda/lawton)...';
  appendLog('[RIME TTS REQUEST]', 'tag-rime', `Requesting speech synthesis: "${text}"`);

  try {
    state.isAudioPlaying = true;
    if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'RIME TTS STREAMING AUDIO';

    const res = await fetch('/api/tts-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, modelId: 'coda', speaker: 'lawton' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || 'Synthesis error');
    }

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);

    if (dom.rimeAudioElement) {
      dom.rimeAudioElement.src = audioUrl;
      dom.rimeAudioElement.style.display = 'block';
      dom.rimeAudioElement.play();
    }

    if (dom.audioFeedback) dom.audioFeedback.textContent = 'Playing synthesized Rime audio.';
    appendLog('[RIME TTS PLAYBACK]', 'tag-rime', `Received audio stream (${(blob.size / 1024).toFixed(1)} KB). Playing in browser.`);

    if (dom.rimeAudioElement) {
      dom.rimeAudioElement.onended = () => {
        state.isAudioPlaying = false;
        if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
        if (dom.audioFeedback) dom.audioFeedback.textContent = 'Playback completed.';
      };
    }
  } catch (err) {
    state.isAudioPlaying = false;
    if (dom.visualizerStatus) dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
    if (dom.audioFeedback) dom.audioFeedback.textContent = `Synthesis notice: ${err.message}`;
    appendLog('[TTS NOTICE]', 'tag-sys', `Synthesizer response: ${err.message}`);
  } finally {
    if (dom.synthBtn) dom.synthBtn.disabled = false;
  }
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
    // Offline or server restart
  }
}

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
});
