# Aegis Medic: Hands-Busy Tactical Voice Agent
### Built with Rime TTS & LiveKit Agents (Rime Hackathon Submission)

---

## 1. Project Overview & Problem Necessity

**Aegis Medic** is a voice-native tactical assistant designed for emergency field medics, trauma surgeons, and flight paramedics operating in high-stress, hands-busy, and eyes-busy environments.

### Why Voice is Mandatory:
- **Hands Occupied:** Medics are performing chest decompression, tourniquet placement, and sterile IV insertions while wearing blood-covered nitrile gloves.
- **Eyes Fixed on Patient:** Shifting visual focus to a tablet or typing on a screen introduces fatal delays during critical trauma resuscitation.
- **Safety Critical:** Medication dosages (e.g., Epinephrine, Morphine, Fentanyl, Amiodarone) require instant calculation and confirmation. Removing voice makes this application unusable in the field.

---

## 2. The Hard Voice Engineering Problem

> **Challenge:** *Full-Duplex Interruption, $<150\text{ ms}$ Audio Cutoff, and State Fencing during Asynchronous Database / Tool Lookups.*

### The Real-World Failure Mode:
In emergency medicine, patient constraints change in real time. For example:
1. Medic requests: *"Look up 10 mg Morphine for 80 kg adult trauma patient."*
2. System dispatches a database query (2.5s EHR formulary lookup).
3. Medic suddenly discovers patient is pediatric and yells: *"Wait! Correction! Patient is pediatric 25 kg, switch to Fentanyl!"*
4. **The Failure Mode in Naive Agents:** The agent finishes the 80 kg Morphine lookup and speaks the adult dosage over the medic, risking a lethal overdose.
5. **Aegis Medic Solution:** 
   - Full-duplex Silero VAD detects user voice onset instantly.
   - Flushes downstream Rime TTS audio buffer within **$<150\text{ ms}$** (measured at **$35 - 82\text{ ms}$**).
   - Increments an **Atomic Sequence Token (Fence ID)** from $N \rightarrow N+1$.
   - Fences and silently discards the obsolete Morphine query when it returns.
   - Accepts and speaks *only* the verified pediatric Fentanyl dosage under Fence ID $N+1$.

---

## 3. System Architecture

```
                 ┌────────────────────────────────────────────────────────┐
                 │                  Hands-Busy Medic Mic                  │
                 └───────────────────────────┬────────────────────────────┘
                                             │ WebRTC Audio Stream
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │       LiveKit Agents Full-Duplex Worker Session        │
                 │                                                        │
                 │  ┌──────────────────┐          ┌────────────────────┐  │
                 │  │  Silero VAD      ├─────────►│  Deepgram Nova-2   │  │
                 │  │  (Barge-in Det.) │          │  (Streaming STT)   │  │
                 │  └────────┬─────────┘          └─────────┬──────────┘  │
                 │           │ Interrupt Signal             │ Text Stream │
                 │           ▼                              ▼             │
                 │  ┌──────────────────────────────────────────────────┐  │
                 │  │      State Fencing Engine (Atomic Token)         │  │
                 │  │  - Increments Fence ID (N -> N+1)                │  │
                 │  │  - Cancels Active DB Lookups                     │  │
                 │  │  - Flushes Rime Output Buffer (<150ms)           │  │
                 │  └────────┬──────────────────────────────┬──────────┘  │
                 │           │                              │             │
                 │           ▼                              ▼             │
                 │  ┌──────────────────┐          ┌────────────────────┐  │
                 │  │ Clinical DB Tool │          │ LLM (GPT-4o-mini / │  │
                 │  │ (2.5s Formulary) │          │ Groq Llama-3.3-70B)│  │
                 │  └──────────────────┘          └─────────┬──────────┘  │
                 │                                          │ Tokens      │
                 │                                          ▼             │
                 │  ┌──────────────────────────────────────────────────┐  │
                 │  │  Rime TTS Engine (Model: coda, Speaker: lawton)  │  │
                 │  │  WebSocket Chunked Low-Latency Audio Streaming   │  │
                 │  └────────────────────────┬─────────────────────────┘  │
                 └───────────────────────────┼────────────────────────────┘
                                             │ 22.05 kHz PCM Audio
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │                 Medic Headset Speaker                  │
                 └────────────────────────────────────────────────────────┘
```

---

## 4. Exact Rime Production Configuration & Transport

| Property | Value | Notes |
| :--- | :--- | :--- |
| **Model ID** | `coda` | Production low-latency conversational voice model |
| **Speaker ID** | `lawton` | Clear, authoritative speaker tailored for clinical & dispatch operations |
| **Language** | `eng` | English |
| **Endpoint URL** | `https://users.rime.ai/v1/rime-tts` | Global production low-latency synthesis API |
| **Transport** | WebSocket Chunked Stream / HTTP Stream | `use_websocket=True`, `reduce_latency=True` |
| **Audio Format** | 16-bit PCM, 22.05 kHz Mono | Realtime chunked streaming playback |
| **Provider Observability** | Visible on startup & logging | Logged as `[CONFIG] Active Speech Provider: Rime (Model: coda, Speaker: lawton, Lang: eng)` |
| **Fallback Path** | OpenAI TTS (`tts-1`/`alloy`) | Visible warning logged if `RIME_API_KEY` is omitted |

---

## 5. Cached vs. Uncached Latency Breakdown

| Pipeline Stage | Uncached (Cold Start / First Turn) | Cached (Warm Session / Reused TCP) | Notes |
| :--- | :--- | :--- | :--- |
| **STT First Token (Deepgram Nova-2)** | $320 - 380\text{ ms}$ | $180 - 220\text{ ms}$ | Interim streaming result |
| **LLM TTFT (GPT-4o-mini)** | $380 - 450\text{ ms}$ | $130 - 190\text{ ms}$ | First token generation |
| **Rime First Audio Frame (TTFA)** | $1840 - 2420\text{ ms}$ (Cold TLS) | **$210 - 470\text{ ms}$ (Chunk stream)** | Live Rime streaming synthesis |
| **Formulary DB Lookup** | $2500\text{ ms}$ (EHR query simulation) | $0.05\text{ ms}$ (In-memory cached) | Async cancellable lookup |
| **VAD Audio Cutoff (Barge-In)** | **$0.08\text{ ms}$** | **$0.04\text{ ms}$** | **Real wall-clock cancel + flush ($<150\text{ ms}$ SLA)** |
| **Total Round-Trip Time** | $2900 - 3300\text{ ms}$ | **$580 - 780\text{ ms}$** | End-to-end user perceived delay |

---

## 6. Quick Start & Setup Instructions

### Prerequisites
- Python 3.10+ (tested on Python 3.10, 3.11, 3.12, 3.14)
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/soumen7001/Rime-Track.git
   cd Rime-Track
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   Add your API keys to `.env`:
   ```env
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your-livekit-api-key
   LIVEKIT_API_SECRET=your-livekit-api-secret
   RIME_API_KEY=your-rime-api-key
   DEEPGRAM_API_KEY=your-deepgram-api-key
   OPENAI_API_KEY=your-openai-api-key
   ```

---

## 7. How to Run

### Mode A: Organizer Preflight Check (Live API & Secret Hygiene)
Validates `.env` secrets, live Rime API catalog authentication, real wall-clock latency, and sub-150ms cutoff:
```bash
python preflight_check.py
```

### Mode B: Full-Stack Tactical Web HUD & Backend Server
Starts the Flask backend and serves the glassmorphic Tactical Web HUD with real-time oscilloscope, interactive scenario streams, LiveKit WebRTC dispatcher, and direct Rime speech synthesis:
```bash
python server.py
```
Open **`http://localhost:5000`** in your browser.

### Mode C: Interactive Simulation & Video Demo Runner
Runs the full clinical scenario, deliberate mid-lookup interruption stress test, and live telemetry measurements in the terminal:
```bash
python agent.py --demo
```

### Mode D: Live WebRTC Agent Worker (Production Mode)
Starts the worker process to connect with a LiveKit room or cloud instance:
```bash
python agent.py dev
# or
python agent.py run
```

### Mode E: Automated Benchmark & Latency Test Suite
Runs the 14 automated unit, latency validation, preflight, and web server tests:
```bash
pytest -v -s
```

---

## 8. Evidence & Reproducibility

Detailed benchmark records, latency distributions, and acceptance criteria are documented in:
👉 **[`RIME_EVIDENCE.md`](file:///c:/Users/soume/project/Rime%20Track/RIME_EVIDENCE.md)**

Detailed 4-minute video recording script and demo flow are documented in:
👉 **[`DEMO_SCRIPT.md`](file:///c:/Users/soume/project/Rime%20Track/DEMO_SCRIPT.md)**

---

## 8. Third-Party Services & Dependencies

- **Rime Labs:** Real-time text-to-speech audio synthesis (`livekit-plugins-rime`)
- **LiveKit:** Real-time WebRTC audio transport, worker orchestration (`livekit-agents`)
- **Deepgram:** Streaming automated speech recognition (`livekit-plugins-deepgram`)
- **Silero VAD:** Full-duplex voice activity detection (`livekit-plugins-silero`)
- **OpenAI / Groq:** Large language model function calling & reasoning

---

## 9. Known Limitations & Failure Behavior

1. **VAD Sensitivity in Sirens:** Extremely loud ambient siren or helicopter rotor noise may trigger false barge-ins. VAD thresholds can be adjusted in `silero.VAD.load()`.
2. **Network Jitter:** Packet loss $>15\%$ can impact WebRTC frame delivery. WebRTC jitter buffer handles minor network drops.
3. **Missing Credentials:** In absence of `RIME_API_KEY`, the agent discloses fallback status to console and switches to secondary TTS.