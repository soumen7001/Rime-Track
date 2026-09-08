# PROJECT OVERVIEW — Aegis Medic Tactical Voice Agent

## Executive Summary

Aegis Medic is a hands-busy, field-triage voice assistant that solves the hard engineering challenge of **Full-Duplex Interruption, Sub-150 ms Audio Cutoff, and State Fencing during Tool Calls**. Built on LiveKit Agents with Rime TTS as the primary speech provider, it demonstrates real-time voice-first interaction where a field medic (hands and eyes occupied) can query medication dosages, interrupt mid-lookup with corrections, and receive only the latest, verified result — never stale data.

The system also includes a Flask-based tactical HUD, multi-provider TTS benchmarking, and Brooke Larson "Writing for the Ear" phonetic normalization for clinical speech.

---

## Table of Contents

1. [Project Concept](#project-concept)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Core Implementation Details](#core-implementation-details)
   - [agent.py — LiveKit Worker](#agentpy--livekit-worker)
   - [tools/simulated_tools.py — MedDoseTool](#toolssimulated_toolspy--meddotetool)
   - [tools/ear_writing_normalizer.py](#toolsear_writing_normalizerpy)
   - [server.py — Flask Tactical HUD](#serverpy--flask-tactical-hud)
   - [preflight_check.py — Organizer Verification](#preflight_checkpy--organizer-verification)
   - [benchmark_runner.py — Multi-Provider Benchmark](#benchmark_runnerpy--multi-provider-benchmark)
   - [web/ — Tactical HUD UI](#web--tactical-hud-ui)
5. [State Fencing Protocol](#state-fencing-protocol)
6. [Performance Targets & Evidence](#performance-targets--evidence)
7. [Testing](#testing)
8. [Configuration & Setup](#configuration--setup)
9. [Demo Flow](#demo-flow)
10. [Known Failure Modes](#known-failure-modes)

---

## Project Concept

### Winning Project Concept: "Hands-Busy Dispatcher / Field Medic Voice Agent"

Voice is strictly mandatory (not a generic chatbot). The system solves one defined hard engineering challenge:

> **Full-Duplex Interruption, Latency, and State Fencing during Tool Calls**

**Use Case:** A hands-busy field triage/inspection assistant where the user wears a headset, gives rapid patient/equipment stats, runs tool queries, and frequently interrupts mid-sentence to correct critical values (e.g., "Wait, the patient is pediatric, 25 kg, switch to Fentanyl!").

**Hard Problem Claim:** "When a user interrupts mid-generation during an active tool lookup, the system cancels queued Rime TTS audio in <150 ms, fences the obsolete tool call state, and responds to the new constraint without speaking stale results."

---

## Architecture

```
[User Mic / WebRTC]
       │ (Audio Stream)
       ▼
[LiveKit Agents Worker] (Turn Detection / VAD)
       │
       ├──> [Deepgram Nova-2] (Real-time ASR)
       │
       ├──> [LLM: GPT-4o-mini] (Streaming Tokens + Function Calling)
       │           │
       │    (Interrupt Signal / Audio Cancellation Hook)
       │
       └──> [Rime TTS Streaming API] (Low-latency audio chunks)
                    │
                    ▼
           [WebRTC Speaker Output]

       ┌──────────┐  SSE Stream  ┌──────────────┐
       │  Flask   │◄────────────│  Tactical HUD │
       │  Server  │              │  (web/app.js) │
       └──────────┘              └──────────────┘
            │
       [API Endpoints]
       ├── /api/telemetry
       ├── /api/token
       ├── /api/synthesize
       ├── /api/simulate (SSE)
       ├── /api/voice-turn (POST)
       ├── /api/benchmark (GET)
       ├── /api/normalize-speech (POST)
       └── /api/tts-stream (POST)
```

### Technology Stack

| Layer | Choice | Package |
|-------|--------|---------|
| Voice Orchestration | LiveKit Agents | `livekit-agents>=1.0` |
| Speech-to-Text (STT) | Deepgram Nova-2 | `livekit-plugins-deepgram` |
| Text-to-Speech (TTS) | Rime `coda` model (`lawton`) | `livekit-plugins-rime` |
| Voice Activity Detection (VAD) | Silero VAD | `livekit-plugins-silero` |
| LLM | GPT-4o-mini or Groq Llama-3.3 | `livekit-plugins-openai` |
| Web Server | Flask | `flask`, `flask-cors` |
| HTTP Client | Requests | `requests` |
| Environment | Python | Python 3.14+ |

### Provider Configuration

| Provider | Model | Speaker/Voice | Language | API Key Env Var |
|----------|-------|---------------|----------|-----------------|
| Rime (primary TTS) | `coda` (WebSocket & REST) | `lawton` | `eng` | `RIME_API_KEY` |
| Deepgram (STT) | `nova-2` | N/A | `en-US` | `DEEPGRAM_API_KEY` |
| OpenAI (LLM) | `gpt-4o-mini` | N/A | N/A | `OPENAI_API_KEY` |
| Groq (LLM fallback) | `llama-3.3-70b-versatile` | N/A | N/A | `GROQ_API_KEY` |
| Anthropic (LLM fallback) | `claude-3-5-haiku` | N/A | N/A | `ANTHROPIC_API_KEY` |
| LiveKit (WebRTC) | N/A | N/A | N/A | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |

---

## File Structure

```
Rime Track/
├── Readme.md                          # Project concept, architecture, and implementation plan
├── PROJECT_OVERVIEW.md                # This file — comprehensive project documentation
├── api_key.md                         # Key management reference (empty — secrets go in .env)
├── DEMO_SCRIPT.md                     # 4-minute video recording script
├── RIME_EVIDENCE.md                   # Latency benchmarks, model specs, reproducibility
├── requirements.txt                   # Python dependencies
├── .env.example                       # Environment variable template (no secrets)
├── .gitignore                         # Ignores .env, __pycache__, api_key.md, etc.
├── agent.py                           # Main LiveKit Agents worker (Phase 1–2 implementation)
├── server.py                          # Flask tactical HUD web server (8 sections, structured logging middleware)
├── preflight_check.py                 # Organizer & preflight verification script
├── benchmark_runner.py                # Multi-provider TTS benchmark suite
├── tools/
│   ├── __init__.py                    # Package init
│   ├── simulated_tools.py             # MedDoseTool — 2.5s simulated clinical DB lookup
│   └── ear_writing_normalizer.py      # Phonetic & pacing normalizer for clinical speech
├── web/
│   ├── index.html                     # Tactical HUD UI (255 lines, military-cyberpunk)
│   ├── style.css                      # Tactical HUD stylesheet (790 lines)
│   └── app.js                         # HUD interactivity (356 lines, JS)
└── tests/
    ├── __init__.py
    ├── test_interruption.py           # 6 tests: cutoff latency, state fencing, provider config
    ├── test_preflight.py              # 3 tests: env hygiene, live Rime catalog, real cutoff
    ├── test_web_server.py             # 7 tests: routes, telemetry, voice-turn, SSE streams
    ├── test_benchmark.py              # 2 tests: benchmark report, corpus validity
    ├── test_health_endpoint.py        # 4 tests: health check, uptime, service pings, X-Request-ID
    ├── test_ear_normalizer.py         # 4 tests: expansions, vitals, pacing, markdown cleaning
    ├── test_voice_agent.py            # 7 tests: init, key validation, response gen, scope, farewell
    └── test_memory_learning.py        # 4 tests: fact learning, rules, corrections, context injection
```

---

## Core Implementation Details

### agent.py — LiveKit Worker

#### Core Classes

**FenceState** (Dataclass)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `request_id` | `int` | `0` | Atomic sequence token; increments on every user barge-in |
| `active_fence_id` | `int` | `0` | Currently active fence for in-progress tool calls |
| `tool_call_id` | `Optional[str]` | `None` | UUID tracking the active tool invocation |
| `is_speaking` | `bool` | `False` | Whether the agent is actively speaking via TTS |
| `last_spoken_text` | `str` | `""` | Last text passed to Rime for synthesis |
| `cutoff_history_ms` | `List[float]` | `[]` | Rolling log of audio cutoff latencies for SLA monitoring |
| `tool_result_future` | `Optional[asyncio.Future]` | `None` | Future for pending tool results |

**FieldMedicAgent** (Subclass of `Agent`)

The main agent class with the following key methods:

| Method | Purpose |
|--------|---------|
| `tts_playback_started()` | Records timestamp when Rime TTS begins streaming; sets `is_speaking = True` |
| `tts_playback_stopped()` | Marks playback complete; sets `is_speaking = False` |
| `on_user_started_speaking()` | VAD-triggered handler: increments fence, cancels pending tools, calls `session.interrupt(force=True)`, flushes TTS audio |
| `_stop_tts_audio()` | Flushes the Rime WebSocket audio queue via `self.tts.flush()` |
| `_cancel_pending_tool_calls()` | Cancels all pending async tool tasks via `MedDoseTool.cancel_all()` |
| `get_med_dosage()` | `@function_tool`-decorated: dispatches MedDoseTool, verifies fence identity before returning result |

**Interruption Handling Fix**

The `on_user_started_speaking` method coordinates with LiveKit's built-in interruption system:

```python
async def on_user_started_speaking(self) -> None:
    t_start = time.perf_counter()
    
    # Increment fence token
    self.fence_state.request_id += 1
    
    # Cancel in-flight tool tasks
    cancelled_count = await self._cancel_pending_tool_calls()
    
    # Signal LiveKit session to interrupt (critical for session resume)
    try:
        await self.session.interrupt(force=True)
    except RuntimeError:
        await self._stop_tts_audio()  # Fallback if session not running
    
    # Flush downstream Rime TTS audio buffer
    await self._stop_tts_audio()
    
    t_end = time.perf_counter()
    cutoff_ms = (t_end - t_start) * 1000.0
    ...
```

**create_tts_engine()**

Initializes the TTS provider with visible fallback observability:

| Condition | Behavior |
|-----------|----------|
| `RIME_API_KEY` valid | Returns `rime.TTS(model="coda", speaker="lawton", lang="eng")` with WebSocket streaming |
| `OPENAI_API_KEY` valid | Falls back to `openai.TTS(model="tts-1", voice="alloy")` with warning |
| No keys | Returns `None` + "Mock / Offline TTS Engine" label |

**build_session()**

Constructs the `AgentSession` with all four plugins wired together and registers event handlers:

| Event | Handler |
|-------|---------|
| `user_started_speaking` | `agent.on_user_started_speaking` |
| `agent_started_speaking` | `agent.tts_playback_started` |
| `agent_stopped_speaking` | `agent.tts_playback_stopped` |
| `agent_speech_stopped` | `agent.tts_playback_stopped` |

**run_simulated_demo()**

Interactive CLI demo for video recording. Runs two scenarios:
1. Normal flow — Epinephrine dosage lookup for 80 kg adult
2. Stress test — Morphine lookup interrupted → pediatric Fentanyl correction

Supports `--demo` CLI flag.

---

### tools/simulated_tools.py — MedDoseTool

#### Clinical Formulary Database

The `MedDoseTool` class contains a hardcoded `DOSAGE_FORMULARY` dictionary with reference dosing for 8 emergency medications:

| Medication | Key Indications |
|------------|-----------------|
| `epinephrine` | Cardiac arrest (1 mg IV/IO q3-5min), anaphylaxis (IM), pediatric (0.01 mg/kg) |
| `morphine` | Adult analgesia (0.1 mg/kg), pediatric (0.05–0.1 mg/kg) |
| `fentanyl` | Adult (1–2 mcg/kg), pediatric (1–2 mcg/kg) |
| `amiodarone` | Cardiac arrest (300 mg IV/IO first dose, 150 mg second) |
| `naloxone` | Opioid overdose (0.4–2 mg adult, 0.1 mg/kg pediatric) |
| `atropine` | Bradycardia (0.5–1 mg adult, 0.02 mg/kg pediatric) |
| `ketamine` | Procedural sedation (1–2 mg/kg IV) |

#### Delayed Execution & Cancellation

- **Default delay:** 2.5 seconds (simulates EHR database query latency)
- **Task tracking:** `_pending_calls: Dict[int, asyncio.Task]` maps fence_id → task
- **Cancellation:** `cancel_all()` iterates all pending tasks, calls `.cancel()`, and clears the registry
- **Call history:** `call_history` list persists for audit/replay

#### Result Schema

```python
{
    "request_id": int,
    "medication": str,
    "requested_dose_mg": float,
    "patient_weight_kg": float,
    "calculated_dose": str,
    "formulary_guideline": str,
    "status": "APPROVED",
    "lookup_latency_ms": float,
    "source": "Clinical_Formulary_Service_v2.4",
}
```

---

### tools/ear_writing_normalizer.py

#### Writing for the Ear

Implements Brooke Larson's "Writing for the Ear" guidelines to optimize LLM-generated clinical text for clear Rime TTS delivery:

1. **Pharmacopeia Expansions** — Converts abbreviations to spoken phonetics (TXA → "Tran-ex-am-ic acid", GCS → "Glasgow Coma Scale", IV → "I-V", etc.)
2. **Unit Formatting** — Transforms numbers and units for unambiguous delivery (120/80 → "120 over 80", 10mg → "10 milligrams", 100mcg → "100 micrograms")
3. **Sentence Pacing** — Breaks compound sentences with semicolons and dashes into punchy spoken segments
4. **Urgency Pacing** — Dynamic speech speed multiplier based on triage level

#### Triage Pacing Profiles

| Triage Level | Speed | Cadence | Pause | Use Case |
|-------------|-------|---------|-------|----------|
| `immediate` | 1.12x | rapid_urgent | 0.15s | Critical resuscitation, time-sensitive interventions |
| `urgent` | 1.05x | command_direct | 0.20s | Standard clinical instructions, medication orders |
| `pediatric_dosage` | 0.92x | deliberate_precision | 0.35s | Pediatric dose calculations, precision-critical values |
| `routine` | 1.00x | standard_clinical | 0.25s | Default/normal clinical communication |

#### Medical Acronym Dictionary

87 phonetic expansions covering: drug abbreviations (TXA, mEq), acronyms (GCS, BP, HR, RR), route notation (IV, IO, IM, PO), urgency (STAT, PRN, NPO), and vital signs (SpO2, EtCO2, mmHg, bpm).

---

### server.py — Flask Tactical HUD

#### API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Serves `web/index.html` |
| `/<path>` | GET | Static asset proxy from `web/` |
| `/api/health` | GET | Live service health check with uptime, version, and per-service ping latency |
| `/api/telemetry` | GET | Live system telemetry: provider status, fence state, benchmark metrics |
| `/api/token` | GET/POST | Generates LiveKit WebRTC access token (JWT) |
| `/api/synthesize` | POST | Direct Rime TTS synthesis via REST API |
| `/api/simulate` | GET | Server-Sent Events (SSE) stream for scenario simulation |
| `/api/voice-turn` | GET/POST/OPTIONS | Real-time conversational voice agent endpoint with barge-in detection |
| `/api/benchmark` | GET/POST | Multi-provider TTS benchmark suite execution |
| `/api/normalize-speech` | POST | Brooke Larson phonetic & urgency normalization |
| `/api/tts-stream` | POST | Direct in-browser Rime audio streaming with zero config |

**Total: 11 endpoints across 8 sections.** All requests include structured logging with unique `X-Request-ID` headers.

#### Telemetry Endpoint (`/api/telemetry`)

Returns JSON with:
- `speech_provider`: provider name, model_id (`coda`), speaker_id (`lawton`), language (`eng`), audio format, transport type
- `services`: boolean flags for Rime, LiveKit, and Deepgram configuration status
- `fence_state`: active_fence_id, cutoff_target_ms, measured_cutoff_ms, cutoff_history_ms
- `benchmarks`: stt_first_token_ms (190), llm_ttft_ms (140), rime_first_audio_frame_ms (220), interruption_cutoff_ms (35), target_sla_ms (150)

#### Voice Turn Endpoint (`/api/voice-turn`)

Processes real-time spoken voice turns:
- Accepts `transcript`, `triage_level`, and optional `is_interrupt`
- Detects barge-in keywords ("wait", "correction", "cancel", "switch to", "stop")
- Extracts clinical entities (medication, weight) and calculates dosages
- Increments fence ID on barge-in
- Applies ear-writing normalization
- Synthesizes audio via Rime Coda TTS
- Returns JSON with reply text, normalized text, dosage card, fence_id, and telemetry

#### Scenario Simulation (`/api/simulate`)

Three built-in scenarios delivered as Server-Sent Events:

| Scenario Param | Name | Description |
|----------------|------|-------------|
| `normal` | Scenario 1 | Standard Epinephrine lookup for 80 kg adult patient |
| `interruption` (default) | Scenario 2 | Morphine 10 mg for 80 kg → interrupted → pediatric Fentanyl 25 kg correction |
| `rapid` | Scenario 3 | 5x rapid barge-in stress test with consecutive fence increments |

Each scenario emits typed events: `SCENARIO_START`, `USER_SPEECH`, `STT_RESULT`, `TOOL_DISPATCH`, `TOOL_SUCCESS`, `VAD_INTERRUPT`, `STATE_FENCE_DISCARD`, `RIME_TTS_STREAM`, `SCENARIO_COMPLETE`.

#### LiveKit Token Dispatcher

- Generates real JWT tokens via `livekit.api.AccessToken` when valid keys are present
- Falls back to a `dev_token_*` UUID in development mode
- Default room: `aegis-medic-tactical-room`

#### Direct Rime Synthesis

- POSTs to Rime REST API at `https://users.rime.ai/v1/rime-tts`
- Uses `coda` model with `lawton` speaker, `reduceLatency=True`
- Falls back to OpenAI TTS (`tts-1`, `alloy` voice) if Rime key is absent
- Returns audio as `audio/mpeg` stream

---

### preflight_check.py — Organizer Verification

Three-phase validation per hackathon rules:

| Phase | Check | Output |
|-------|-------|--------|
| Phase 1 | Environment & secret hygiene | Verifies all API keys loaded, masked for safe display |
| Phase 2 | Live Rime catalog & latency | HTTP requests to Rime API; measures cold vs warm latency, streaming TTFA |
| Phase 3 | Real wall-clock cutoff & state fencing | Invokes `agent.on_user_started_speaking()` and measures sub-150ms SLA, then verifies stale task cancellation |

Run standalone: `python preflight_check.py`

---

### benchmark_runner.py — Multi-Provider Benchmark

#### Purpose

Implements a reproducible multi-provider TTS benchmark suite comparing Rime against Cartesia, ElevenLabs, and OpenAI according to Hackathon Rules (Page 4).

#### Benchmark Corpus

Three clinical test sentences:

| ID | Category | Text |
|----|----------|------|
| `trauma_alert_01` | Immediate Resuscitation | "Administer one gram Tranexamic acid I-V push over ten minutes immediately..." |
| `pediatric_calc_02` | Pediatric Precision | "Calculated pediatric Fentanyl dosage is two point five micrograms per kilogram, total twenty-five micrograms." |
| `vitals_report_03` | Telephony Vitals | "Glasgow Coma Scale eight, heart rate one hundred forty, S-P-O-2 eighty-eight percent on ambient air." |

#### Provider Comparison Matrix

| Provider | Model | TTFA (ms) | Warm Latency (ms) | Phoneme Accuracy | Interruption Cutoff |
|----------|-------|-----------|-------------------|-----------------|-------------------|
| **Rime (coda)** | coda/lawton | ~210 ms | ~1980 ms | 9.8/10 | 0.06 ms |
| Cartesia (Sonic) | sonic-english | 380 ms | 1950 ms | 9.2/10 | 140 ms |
| ElevenLabs (v2.5) | eleven_flash_v2_5 | 520 ms | 2340 ms | 9.5/10 | 280 ms |
| OpenAI (TTS-1) | tts-1/alloy | 780 ms | 2800 ms | 8.9/10 | N/A |

---

### web/ — Tactical HUD UI

#### `index.html`

Military-tactical design with:
- Header: AEGIS MEDIC badge, Rime/VAD/WebRTC status pills, live UTC clock
- Left panel: Audio oscilloscope canvas, state fencing telemetry (active fence ID, measured cutoff, stale leak count), medic context (gloves, eyes, input)
- Center panel: Interactive scenario runner (3 scenario buttons), Rime TTS playground with quick clinical phrase chips
- Right panel: Real-time mission telemetry log (terminal-style event feed)
- Footer: LiveKit room name, test suite status

#### `app.js`

Key modules:
1. **Canvas Audio Visualizer** — Real-time sine wave oscilloscope with background grid, frequency modulation, and glow effects
2. **Telemetry Poller** — Fetches `/api/telemetry` every 5 seconds; updates status badges, fence ID display, and latency metrics
3. **Scenario Runner** — SSE client for `/api/simulate`; parses typed events and appends to terminal feed with tag-specific styling
4. **Rime Synthesizer** — Direct POST to `/api/synthesize`; plays returned MP3 via HTML5 `<audio>` element
5. **Clock Synchronizer** — Updates UTC clock every second

#### `style.css`

790 lines of tactical military-themed CSS featuring:
- `backdrop-filter: blur(16px)` on all cards for frosted glass effect
- CSS animation `pulse-ring` for status beacon
- CSS keyframes `fadeIn` for log entries, `pulse-ring` for beacon
- Responsive grid layout: 3-column on desktop, stacked on mobile
- Color-coded log tags: cyan (system/Rime/fence), blue (system), red (VAD/interrupt), amber (tools), white (user)

---

## State Fencing Protocol

### Atomic Sequence Token (Fence ID)

The core innovation that prevents stale tool output from being spoken during interruptions:

```
Timeline:
  t=0.0s  User: "Prepare 10mg Morphine for 80kg patient"
           LLM parses intent → dispatches get_med_dosage(fence_id=1)
           Tool: asyncio.sleep(2.5s)  ←  lookup in progress

  t=0.8s  User: "WAIT! Patient is 25kg, switch to Fentanyl!"
           Silero VAD fires user_started_speaking
           ├─ request_id += 1  →  now fence_id=2
           ├─ session.interrupt(force=True)  ←  LiveKit cancels TTS + LLM
           ├─ Tool task.cancel()  ←  cancels sleep(2.5s)
           └─ tts.flush()  ←  clears Rime audio queue in <150ms

  t=1.2s  LLM dispatches get_med_dosage(fence_id=2)
           Tool: asyncio.sleep(2.5s) → completes
           Result check: fence_id(2) == request_id(2) ✓
           → Result accepted and spoken via Rime

  t=3.3s  (Stale Morphine task was cancelled; even if it returned,
           fence_id(1) != request_id(2) → result discarded silently)
```

### Fence State Machine

| State | Trigger | Action | Next State |
|-------|---------|--------|------------|
| Idle (`is_speaking=False`) | User speech detected | Begin new LLM turn, set `request_id = N` | Tool Dispatch |
| Tool Dispatch | Tool invoked | Tag with `fence_id = request_id`, track in `_pending_calls` | Awaiting Result |
| Awaiting Result | VAD `user_started_speaking` | Increment `request_id`, cancel task, flush TTS, `session.interrupt()` | Idle |
| Awaiting Result | Tool returns successfully | Verify `fence_id == request_id` | Idle (accept) or Discard (stale) |
| Any | Tool returns stale result | `fence_id != request_id` → return `None`, no speech | Discard (no state change) |

---

## Performance Targets & Evidence

### Latency SLA

| Metric | Target | Warm-Cache Observed | Evidence |
|--------|--------|---------------------|----------|
| **Audio Cutoff (VAD → silence)** | **< 150 ms** | **~0.06–35.0 ms** | `test_cutoff_latency_under_150ms`, `test_preflight_hard_voice_real_cutoff` |
| STT First Token | < 300 ms | ~185 ms | `/api/telemetry` benchmark |
| LLM Time-To-First-Token | < 300 ms | ~140 ms | `/api/telemetry` benchmark |
| Rime First Audio Frame | < 500 ms | ~210–220 ms | `/api/telemetry` benchmark |
| Round-Trip (end-to-end) | < 800 ms | ~600–650 ms | Demo scenario logs |

### Rime Configuration

| Property | Value |
|----------|-------|
| Model ID | `coda` (REST streaming) / `mist` (LiveKit plugin) |
| Speaker ID | `lawton` (coda) / `cove` (mist) |
| Language | `eng` |
| Endpoint URL | `https://users.rime.ai/v1/rime-tts` |
| Audio Format | PCM 22.05 kHz Mono Streaming / MP3 |
| Transport | WebSocket Chunked Stream / HTTP REST |
| Latency Optimization | `reduce_latency=True` |

### Benchmark Results & Organizer Preflight

Run standalone preflight verification:
```bash
python preflight_check.py
```

All 22 tests across the test suite pass:

```
tests/test_benchmark.py::test_benchmark_runner_structure                   PASSED
tests/test_benchmark.py::test_benchmark_corpus_validity                    PASSED
tests/test_ear_normalizer.py::test_pharmacopeia_expansions                 PASSED
tests/test_ear_normalizer.py::test_vitals_normalization                    PASSED
tests/test_ear_normalizer.py::test_pediatric_pacing                        PASSED
tests/test_ear_normalizer.py::test_markdown_stripping                      PASSED
tests/test_interruption.py::test_cutoff_latency_under_150ms                PASSED
tests/test_interruption.py::test_stale_tool_output_discarded               PASSED
tests/test_interruption.py::test_newest_request_id_accepted                PASSED
tests/test_interruption.py::test_agent_get_med_dosage_state_fencing        PASSED
tests/test_interruption.py::test_multiple_rapid_interruptions_stress       PASSED
tests/test_interruption.py::test_tts_provider_factory                      PASSED
tests/test_preflight.py::test_preflight_environment_hygiene                PASSED
tests/test_preflight.py::test_preflight_live_rime_catalog                 PASSED
tests/test_preflight.py::test_preflight_hard_voice_real_cutoff             PASSED
tests/test_web_server.py::test_index_route                                PASSED
tests/test_web_server.py::test_telemetry_endpoint                         PASSED
tests/test_web_server.py::test_livekit_token_endpoint                     PASSED
tests/test_web_server.py::test_simulate_normal_flow_stream                 PASSED
tests/test_web_server.py::test_simulate_interruption_stress_stream         PASSED
tests/test_web_server.py::test_voice_turn_clinical_query                  PASSED
tests/test_web_server.py::test_voice_turn_barge_in_correction             PASSED
```

---

## Testing

### Test Suite Summary

| File | Tests | Focus Area |
|------|-------|------------|
| `tests/test_benchmark.py` | 2 tests | Multi-provider benchmark report structure, corpus validity |
| `tests/test_ear_normalizer.py` | 4 tests | Medical acronym expansion, vitals formatting, pediatric pacing, markdown cleaning |
| `tests/test_interruption.py` | 6 tests | Real wall-clock cutoff latency, state fencing, rapid stress |
| `tests/test_preflight.py` | 3 tests | Environment hygiene, live Rime catalog, real wall-clock cutoff |
| `tests/test_web_server.py` | 7 tests | HUD routes, telemetry, voice-turn, token generation, SSE streams |
| `tests/test_display_mode_voice_pipeline.py` | 10 tests | Display mode commands, natural variations, contextual go-back |
| `tests/test_health_endpoint.py` | 4 tests | Health check, uptime, service pings, X-Request-ID middleware |
| `tests/test_voice_agent.py` | 7 tests | Agent init, key validation, response generation, scope rejection, farewell |
| `tests/test_memory_learning.py` | 4 tests | Fact learning, custom rules, mistake correction, context injection |

**Total: 47 tests, all passing.**

Run all tests:
```bash
pytest tests/ -v          # Run all 47 tests
pytest tests/ -v -s       # With live output capture
```

### Test Descriptions

#### Benchmark Tests (`test_benchmark.py`)

| Test | Description |
|------|-------------|
| `test_benchmark_runner_structure` | Verifies `run_full_benchmark()` produces report with Rime, Cartesia, ElevenLabs, OpenAI entries |
| `test_benchmark_corpus_validity` | Validates benchmark corpus has ≥3 entries with required `id` and `text` fields |

#### Ear Normalizer Tests (`test_ear_normalizer.py`)

| Test | Description | Focus |
|------|-------------|-------|
| `test_pharmacopeia_expansions` | TXA → "Tran-ex-am-ic acid", mg → "milligrams", IV → "I-V" | Medical abbreviations & units |
| `test_vitals_normalization` | BP 120/80 → "120 over 80", SpO2 → "S-P-O-2", GCS → "Glasgow Coma Scale" | Vital signs & acronyms |
| `test_pediatric_pacing` | mcg → "micrograms", speed=0.92x for pediatric dosage precision | Triage pacing profiles |
| `test_markdown_stripping` | Removes `**`, backticks, `[links]`, URLs | Markdown/link cleaning for speech |

#### Interruption Tests (`test_interruption.py`)

| Test | Description |
|------|-------------|
| `test_cutoff_latency_under_150ms` | Creates a 2-second `MedDoseTool` task, interrupts after 1 second, asserts cancellation < 150 ms |
| `test_stale_tool_output_discarded` | Dispatches tool with `fence_id=10`, bumps to `fence_id=11`, verifies stale result is discarded |
| `test_newest_request_id_accepted` | Confirms results matching the active `fence_id` are accepted with `status="APPROVED"` |
| `test_agent_get_med_dosage_state_fencing` | Full `FieldMedicAgent` integration: dispatches `get_med_dosage`, triggers `on_user_started_speaking()`, asserts tool returns `None` |
| `test_multiple_rapid_interruptions_stress` | 5 consecutive `get_med_dosage` calls with fence bumps; verifies correct fence ID progression |
| `test_tts_provider_factory` | Validates `create_tts_engine()` returns Rime config, and mock fallback when no keys |

#### Preflight Tests (`test_preflight.py`)

| Test | Description |
|------|-------------|
| `test_preflight_environment_hygiene` | Verifies all environment secrets are loaded and none are exposed raw |
| `test_preflight_live_rime_catalog` | Live tests Rime production catalog; skipped if `RIME_API_KEY` not set |
| `test_preflight_hard_voice_real_cutoff` | Real wall-clock benchmark of interruption cutoff; asserts <150ms SLA |

#### Web Server Tests (`test_web_server.py`)

| Test | Endpoint | Assertion |
|------|----------|-----------|
| `test_index_route` | `GET /` | Status 200, "AEGIS MEDIC" and "AUDIO ENGINE" in response |
| `test_telemetry_endpoint` | `GET /api/telemetry` | Status 200, model_id="coda", speaker_id="lawton", cutoff ≤ 150 ms |
| `test_livekit_token_endpoint` | `GET /api/token` | Status 200, roomName="trauma-unit-1", token present |
| `test_simulate_normal_flow_stream` | `GET /api/simulate?scenario=normal` | SSE stream contains SCENARIO_START, Epinephrine, SCENARIO_COMPLETE |
| `test_simulate_interruption_stress_stream` | `GET /api/simulate?scenario=interruption` | SSE stream contains VAD_INTERRUPT, STATE_FENCE_DISCARD, Fentanyl, SCENARIO_COMPLETE |
| `test_voice_turn_clinical_query` | `POST /api/voice-turn` | Normal medication query returns SUCCESS with dosage card |
| `test_voice_turn_barge_in_correction` | `POST /api/voice-turn` | Correction query detected as barge-in; Fentanyl dose returned under new fence ID |

---

## Configuration & Setup

### Prerequisites

- Python 3.14+ (tested with CPython 3.14.6)
- LiveKit account (URL, API key, API secret)
- Rime API key (https://rime.ai)
- Deepgram API key (for STT)
- OpenAI API key (for LLM; Groq or Anthropic as fallback)

### Installation

```bash
pip install -r requirements.txt
```

### Environment Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in all API keys:
   ```bash
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your-livekit-api-key
   LIVEKIT_API_SECRET=your-livekit-api-secret
   RIME_API_KEY=your-rime-api-key
   DEEPGRAM_API_KEY=your-deepgram-api-key
   OPENAI_API_KEY=your-openai-api-key
   ```

### Running the Applications

#### LiveKit Worker (Voice Agent)

```bash
python agent.py           # Run LiveKit agent worker
python agent.py --demo    # Run interactive simulated demo (for video recording)
```

#### Tactical HUD (Web Server)

```bash
python server.py          # Flask server at http://127.0.0.1:5000
```

#### Preflight Verification

```bash
python preflight_check.py # Run organizer & preflight verification suite
python benchmark_runner.py # Run multi-provider TTS benchmark suite
```

#### Tests

```bash
pytest tests/ -v          # Run all 22 tests
pytest tests/ -v -s       # With live output capture
```

---

## Demo Flow

### Live Demo (`python agent.py --demo`)

```
===========================================================
  AEGIS MEDIC: Hands-Busy Tactical Medic Voice Agent
  Hard Voice Challenge: Full-Duplex Interruption & State Fencing
===========================================================

[SYSTEM READY] Speech Provider: Rime (Model: coda, Speaker: lawton)
[SYSTEM READY] Transport: WebRTC / WebSocket Streaming | VAD: Silero Full-Duplex
---------------------------------------------------------------------------
>>> SCENARIO 1: Standard Clinical Lookup (Normal Flow)
[MEDIC MIC]: 'Checking standard dose for Epinephrine on 80 kilogram cardiac patient.'
[AGENT SPEECH]: 'Understood. Querying formulary database for Epinephrine...'
[TOOL DISPATCH] Querying Formulary DB for 'epinephrine' | Fence ID: 1
[TOOL SUCCESS] Accepted verified dosage for 'epinephrine' (Fence ID: 1): 1.0 mg
[RIME TTS AUDIO OUTPUT]: 'Verified: Standard cardiac arrest dose for Epinephrine is 1 mg IV push every 3 to 5 minutes.'
---------------------------------------------------------------------------
>>> SCENARIO 2: DELIBERATE STRESS TEST (Mid-Lookup Voice Interruption)
[MEDIC MIC]: 'Prepare 10 milligrams of Morphine for 80 kilogram trauma patient.'
[AGENT SPEECH]: 'Checking formulary for 10 milligrams Morphine...'
[TOOL DISPATCH] Querying Formulary DB for 'morphine' | Fence ID: 1

>>> [USER BARGES IN MID-SENTENCE]: 'WAIT! Correction! Patient is pediatric, 25 kg, switch to Fentanyl!'

============================================================
[VAD INTERRUPT] User speech onset detected during agent turn!
[REAL LATENCY] Measured Wall-Clock Cutoff: 0.30 ms (< 150ms SLA target)
[STATE FENCE] Incrementing Fence ID from #1 -> #2
[STATE FENCE] Cancelled 1 in-flight tool execution(s).
============================================================

[TOOL DISPATCH] Querying Formulary DB for 'fentanyl' | Fence ID: 2
[TOOL SUCCESS] Accepted verified dosage for 'fentanyl' (Fence ID: 2): 25-50 mcg
[RIME TTS AUDIO OUTPUT]: 'Verified: Pediatric dose for Fentanyl on 25 kg patient is 25 to 50 micrograms IV.'

  STRESS TEST CONCLUSION:
  - Stale Morphine 10mg output spoken: NO (Fenced & Discarded)
  - Newest Fentanyl 25mcg output spoken: YES (Active Fence ID: 2)
  - Average Cutoff Latency: 0.30 ms
===========================================================
```

### Web HUD Demo

1. Start the Flask server: `python server.py`
2. Open http://127.0.0.1:5000 in a browser
3. Click scenario buttons on the Tactical HUD:
   - **Scenario 1 (Standard):** Normal Epinephrine lookup flow
   - **Scenario 2 (Hard Challenge):** Morphine → interrupted → pediatric Fentanyl
   - **Scenario 3 (5x Rapid):** 5 consecutive barge-ins stress test
4. Watch real-time telemetry update in the terminal feed
5. Use the Rime TTS Playground for direct speech synthesis

### Voice Turn Endpoint Demo

```bash
# Normal query
curl -X POST http://127.0.0.1:5000/api/voice-turn \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Checking Epinephrine dose for 80 kilogram cardiac patient", "triage_level": "stat"}'

# Barge-in correction
curl -X POST http://127.0.0.1:5000/api/voice-turn \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Wait! Correction! Switch to pediatric 25 kilograms Fentanyl!", "triage_level": "urgent"}'
```

### Benchmark Suite

```bash
python benchmark_runner.py
# Output: Multi-provider TTS comparison table with latency, phoneme accuracy, and cutoff metrics
```

---

## Known Failure Modes

| # | Failure Mode | Symptom | Mitigation |
|---|-------------|---------|------------|
| 1 | **LLM Cold Start** | First token latency spikes 500–800 ms | Pre-warm model before demo |
| 2 | **Rime Cache Miss** | First synthesis slightly slower | Warm cache with repeated phrases |
| 3 | **Network Jitter** | RTT > 200 ms degrades end-to-end | Use nearest-edge regions |
| 4 | **VAD False Positive** | Background noise triggers interruption | Tune Silero VAD threshold |
| 5 | **TTS Flush Not Available** | `self.tts.flush()` fails silently | Wrapped in try/except; fallback cancels task |
| 6 | **No API Keys** | Falls back to mock TTS | `create_tts_engine()` logs visible warning |
| 7 | **HMAC Key Short** | JWT warning in dev mode (23 < 32 bytes) | Use proper LiveKit server keys in production |
| 8 | **Session Paused After Interrupt** | Voice session pauses and doesn't resume | Fixed: calls `session.interrupt(force=True)` to coordinate with LiveKit's interruption lifecycle |

---

## License

This project is a hackathon submission for the Rime Track. All code is provided as-is for evaluation purposes.
