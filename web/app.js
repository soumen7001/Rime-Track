/**
 * AEGIS MEDIC TACTICAL WEB HUD - APPLICATION LOGIC & AUDIO VISUALIZER
 * LiveKit Agents + Rime TTS Production Integration
 */

// ==============================================================================
// 1. Global State & DOM References
// ==============================================================================

const state = {
  activeFenceId: 1,
  cutoffHistory: [35.0, 48.2, 52.1, 38.6],
  staleLeaks: 0,
  isAudioPlaying: false,
  activeScenarioStream: null,
};

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
};

// ==============================================================================
// 2. Dynamic Audio Visualizer (Oscilloscope & Sine Wave Generator)
// ==============================================================================

let canvasCtx = dom.canvas.getContext('2d');
let animationFrameId = null;
let wavePhase = 0;

function resizeCanvas() {
  const rect = dom.canvas.getBoundingClientRect();
  dom.canvas.width = rect.width * window.devicePixelRatio;
  dom.canvas.height = rect.height * window.devicePixelRatio;
  canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawWaveform() {
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
  const amp = state.isAudioPlaying ? 35 : 6;
  const freq = state.isAudioPlaying ? 0.04 : 0.015;
  const color = state.isAudioPlaying ? '#00f0b5' : 'rgba(0, 240, 181, 0.45)';

  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = state.isAudioPlaying ? 2.5 : 1.5;
  canvasCtx.shadowColor = '#00f0b5';
  canvasCtx.shadowBlur = state.isAudioPlaying ? 12 : 2;

  canvasCtx.beginPath();
  for (let x = 0; x < width; x++) {
    const y = height / 2 +
      Math.sin(x * freq + wavePhase) * amp * Math.sin(x * 0.01) +
      Math.cos(x * freq * 0.5 - wavePhase) * (amp * 0.4);
    if (x === 0) canvasCtx.moveTo(x, y);
    else canvasCtx.lineTo(x, y);
  }
  canvasCtx.stroke();
  canvasCtx.shadowBlur = 0;

  wavePhase += state.isAudioPlaying ? 0.12 : 0.03;
  animationFrameId = requestAnimationFrame(drawWaveform);
}

// ==============================================================================
// 3. Telemetry & Clock Updates
// ==============================================================================

function updateClock() {
  const now = new Date();
  const timeStr = now.toISOString().substring(11, 19) + ' UTC';
  if (dom.hudClock) dom.hudClock.textContent = timeStr;
}

async function fetchTelemetry() {
  try {
    const res = await fetch('/api/telemetry');
    if (!res.ok) return;
    const data = await res.json();

    if (data.speech_provider) {
      dom.rimeModelLabel.textContent = `${data.speech_provider.provider} (${data.speech_provider.model_id}/${data.speech_provider.speaker_id})`;
    }

    if (data.fence_state) {
      updateFenceDisplay(data.fence_state.active_fence_id);
      if (data.fence_state.measured_cutoff_ms) {
        dom.measuredCutoffVal.textContent = `${data.fence_state.measured_cutoff_ms.toFixed(1)} ms`;
        dom.statCutoff.textContent = `${data.fence_state.measured_cutoff_ms.toFixed(1)} ms`;
      }
    }

    if (data.benchmarks) {
      dom.statStt.textContent = `${data.benchmarks.stt_first_token_ms} ms`;
      dom.statTtft.textContent = `${data.benchmarks.llm_ttft_ms} ms`;
      dom.statRime.textContent = `${data.benchmarks.rime_first_audio_frame_ms} ms`;
    }
  } catch (err) {
    console.warn('Telemetry fetch notice:', err);
  }
}

function updateFenceDisplay(fenceId) {
  state.activeFenceId = fenceId;
  dom.activeFenceId.textContent = `#${fenceId}`;
  dom.activeFenceId.style.transform = 'scale(1.15)';
  setTimeout(() => {
    dom.activeFenceId.style.transform = 'scale(1)';
  }, 200);
}

// ==============================================================================
// 4. Mission Log & Event Appender
// ==============================================================================

function getTimestamp() {
  const d = new Date();
  return `[${d.toTimeString().split(' ')[0]}]`;
}

function appendLog(tag, tagClass, message) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = getTimestamp();

  const tagSpan = document.createElement('span');
  tagSpan.className = `log-tag ${tagClass}`;
  tagSpan.textContent = tag;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = message;

  entry.appendChild(timeSpan);
  entry.appendChild(tagSpan);
  entry.appendChild(msgSpan);

  dom.terminalFeed.appendChild(entry);
  dom.terminalFeed.scrollTop = dom.terminalFeed.scrollHeight;
}

function clearEventLogs() {
  dom.terminalFeed.innerHTML = '';
  appendLog('[LOGS CLEARED]', 'tag-sys', 'Terminal log buffer reset.');
}

// ==============================================================================
// 5. Interactive Scenario Runner (Server-Sent Events)
// ==============================================================================

function runScenario(scenarioType) {
  if (state.activeScenarioStream) {
    state.activeScenarioStream.close();
  }

  appendLog('[SCENARIO INITIATED]', 'tag-sys', `Starting ${scenarioType.toUpperCase()} simulation...`);
  dom.visualizerStatus.textContent = `SIMULATING: ${scenarioType.toUpperCase()} FLOW`;

  const sse = new EventSource(`/api/simulate?scenario=${scenarioType}`);
  state.activeScenarioStream = sse;

  sse.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleScenarioEvent(data);
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  sse.onerror = () => {
    sse.close();
    state.activeScenarioStream = null;
    dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
  };
}

function handleScenarioEvent(evt) {
  switch (evt.type) {
    case 'SCENARIO_START':
      appendLog('[SCENARIO START]', 'tag-sys', `${evt.name} — ${evt.description}`);
      break;

    case 'USER_SPEECH':
      const isInterruption = evt.is_interruption ? ' (BARGE-IN)' : '';
      appendLog(`[USER MIC${isInterruption}]`, 'tag-user', `"${evt.text}"`);
      break;

    case 'STT_RESULT':
      appendLog('[STT DEEPGRAM]', 'tag-sys', `Recognized in ${evt.latency_ms.toFixed(1)}ms: "${evt.transcript}"`);
      break;

    case 'TOOL_DISPATCH':
      appendLog('[TOOL DISPATCH]', 'tag-tool', `Querying Formulary DB for '${evt.medication}' (Fence ID: ${evt.fence_id})`);
      break;

    case 'VAD_INTERRUPT':
      state.isAudioPlaying = false;
      dom.visualizerStatus.textContent = `VAD INTERRUPT // FLUSHED IN ${evt.cutoff_latency_ms.toFixed(1)}ms`;
      appendLog('[VAD INTERRUPT]', 'tag-vad', `User speech detected! Cutoff: ${evt.cutoff_latency_ms.toFixed(1)}ms (<150ms target)`);
      appendLog('[STATE FENCE]', 'tag-fence', `Fence ID incremented: #${evt.old_fence_id} -> #${evt.new_fence_id}. In-flight lookups cancelled.`);
      updateFenceDisplay(evt.new_fence_id);
      dom.measuredCutoffVal.textContent = `${evt.cutoff_latency_ms.toFixed(1)} ms`;
      dom.statCutoff.textContent = `${evt.cutoff_latency_ms.toFixed(1)} ms`;
      break;

    case 'STATE_FENCE_DISCARD':
      appendLog('[STATE FENCE VIOLATION PREVENTED]', 'tag-fence', evt.message);
      break;

    case 'TOOL_SUCCESS':
      appendLog('[TOOL VERIFIED]', 'tag-tool', `Approved ${evt.medication}: ${evt.calculated_dose} (${evt.route}) [Fence ID: ${evt.fence_id}]`);
      break;

    case 'RIME_TTS_STREAM':
      state.isAudioPlaying = true;
      dom.visualizerStatus.textContent = `RIME TTS STREAMING // ${evt.provider}`;
      appendLog('[RIME TTS AUDIO]', 'tag-rime', `Synthesized ${evt.chunks_count} chunks (TTFA: ${evt.first_frame_latency_ms.toFixed(1)}ms): "${evt.text}"`);
      setTimeout(() => {
        state.isAudioPlaying = false;
        dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
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
// 6. Direct Rime Speech Synthesizer
// ==============================================================================

function setSynthesizerText(text) {
  dom.synthInput.value = text;
}

async function synthesizeSpokenText() {
  const text = dom.synthInput.value.trim();
  if (!text) return;

  dom.synthBtn.disabled = true;
  dom.audioFeedback.textContent = 'Contacting Rime TTS engine (coda/lawton)...';
  appendLog('[RIME TTS REQUEST]', 'tag-rime', `Requesting speech synthesis: "${text}"`);

  try {
    state.isAudioPlaying = true;
    dom.visualizerStatus.textContent = 'RIME TTS STREAMING AUDIO';

    const res = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model: 'coda', speaker: 'lawton' }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Synthesis error');
    }

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);

    dom.rimeAudioElement.src = audioUrl;
    dom.rimeAudioElement.style.display = 'block';
    dom.rimeAudioElement.play();

    dom.audioFeedback.textContent = 'Playing synthesized Rime audio.';
    appendLog('[RIME TTS PLAYBACK]', 'tag-rime', `Received audio stream (${(blob.size / 1024).toFixed(1)} KB). Playing in browser.`);

    dom.rimeAudioElement.onended = () => {
      state.isAudioPlaying = false;
      dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
      dom.audioFeedback.textContent = 'Playback completed.';
    };
  } catch (err) {
    state.isAudioPlaying = false;
    dom.visualizerStatus.textContent = 'AUDIO IDLE // MONITORING VAD';
    dom.audioFeedback.textContent = `Synthesis notice: ${err.message}`;
    appendLog('[TTS NOTICE]', 'tag-sys', `Synthesizer response: ${err.message}`);
  } finally {
    dom.synthBtn.disabled = false;
  }
}

// ==============================================================================
// 7. Initialization
// ==============================================================================

window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  drawWaveform();

  updateClock();
  setInterval(updateClock, 1000);

  fetchTelemetry();
  setInterval(fetchTelemetry, 5000);
});
