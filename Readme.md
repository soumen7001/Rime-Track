### Winning Project Concept: "Hands-Busy Dispatcher / Field Medic Voice Agent"

To score in the top tier of the Rime track, voice must be strictly mandatory (not a generic chatbot), and you must solve one defined hard engineering challenge: **Full-Duplex Interruption, Latency, and State Fencing during Tool Calls**.

* **Use Case:** A hands-busy field triage/inspection assistant where the user is wearing a headset, giving rapid patient/equipment stats, running tool queries, and frequently interrupting mid-sentence to correct critical values.


* **The Hard Problem Claim:** "When a user interrupts mid-generation during an active tool lookup, the system cancels queued Rime TTS audio in $<150\text{ ms}$, fences the obsolete tool call state, and responds to the new constraint without speaking stale results."



---

### System Architecture

```
[User Mic / WebRTC] 
       │ (Audio Stream)
       ▼
[LiveKit Agents Worker] (Turn Detection / VAD)
       │
       ├──> [Deepgram / Whisper] (Real-time ASR)
       │           │
       │           ▼
       ├──> [LLM: Groq / Anthropic / OpenAI] (Streaming Tokens + Function Calling)
       │           │
       │    (Interrupt Signal / Audio Cancellation Hook)
       │           │
       └──> [Rime TTS Streaming API] (Low-latency audio chunks)
                   │
                   ▼
          [WebRTC Speaker Output]

```

---

### Implementation Plan

#### Phase 1: Environment & Core Orchestration Stack (Day 1, Morning)

1. **Set Up LiveKit Agents:**
* Initialize a Python-based worker using `livekit-agents` (the prompt's officially recommended starting framework).


* Configure real-time audio transport over WebRTC.




2. **Integrate Rime TTS:**
* Plug in the official Rime streaming integration via the live model/speaker catalog.


* Store API keys securely in server-side `.env` files (ensuring no secrets leak into client code or repo).




3. **Connect Fast STT & LLM:**
* Use an ultra-fast streaming ASR (e.g., Deepgram via LiveKit) and a low-latency LLM engine (e.g., Groq Llama-3.3-70B or Claude 3.5 Haiku) to ensure the full round-trip delay is dominated only by audio synthesis and transport.





#### Phase 2: Solving the "Hard Voice Problem" (Day 1, Afternoon to Night)

1. **Implement Interruption Detection (Full-Duplex VAD):**
* Configure LiveKit’s Voice Activity Detection (Silero VAD) to fire an immediate `user_started_speaking` event while TTS audio is playing.




2. **Audio Cutoff & Buffer Clearing:**
* On interruption, immediately flush the client-side audio playback queue and stop the downstream Rime TTS socket stream to stop audio within $<150\text{ ms}$.




3. **State Fencing & Tool Interruption (The Decisive Judging Factor):**
* Introduce a tool call with a simulated delay (e.g., 2.5 seconds to fetch medical dosage or inventory database).


* Implement an **Atomic Sequence Token (Fence ID)**:
* When a tool call is dispatched, tag it with `request_id = N`.
* If the user interrupts and says *"Wait, change that to 50mg"*, increment to `request_id = N + 1`.
* When the delayed tool $N$ returns, the worker discards it silently rather than sending it to Rime for synthesis.


* Only result $N+1$ is spoken to the user.







#### Phase 3: Benchmark & `RIME_EVIDENCE.md` (Day 2, Morning)

The rubric explicitly allocates **20% for Evidence & Reproducibility**. Create a reproducible automated test script in your repo:

1. **Write a Benchmarking Script (`test_interruption.py`):**
* Inject synthetic audio simulating user turn $\rightarrow$ tool execution $\rightarrow$ mid-sentence interruption.


* Measure and log:
* **Cutoff Latency:** Time from VAD trip to zero audio output (ms).


* **Perceived Response Time:** Time from user silence to first Rime audio frame received.


* **State Consistency:** Assert that stale tool outputs are never rendered or spoken.






2. **Assemble `RIME_EVIDENCE.md`:**
* Document the claim, acceptance criteria, test harness, hardware setup, exact Rime model ID, voice ID, and latency numbers with and without warm cache.





#### Phase 4: Video Demo & Submission Packaging (Day 2, Afternoon)

1. **Record the 4–5 Minute Demo Video:**
* **Minute 1:** Define the user (e.g., field medic/technician whose hands and eyes are occupied) and show why voice is non-negotiable.


* **Minute 2:** Demonstrate the standard happy-path workflow with seamless Rime TTS responses.


* **Minute 3 (The Core Score):** Perform the **deliberate stress test**. Trigger a multi-second tool query, interrupt halfway through with a correction, and prove that audio cuts off instantly and no stale data is spoken.


* **Minute 4:** Display the real-time telemetry panel/terminal logs showing the latency metrics and Rime provider confirmation.




2. **Repository Polish:**
* Check configuration hygiene: remove any exposed credentials and provide a clean `.env.example`.


* Include the required README with setup instructions, known failure modes, and transport/model specs.





---

### Deliverables Checklist

* [ ] **Working App / Repo:** LiveKit + Rime agent handling full-duplex audio and interruption state-fencing.


* [ ] **`RIME_EVIDENCE.md`:** Rigorous benchmarks detailing cutoff latency, TTFT (Time To First Token), and state integrity.


* [ ] **4–5 Minute Video Demo:** Highlighting user necessity, normal flow, and the live interruption stress test.


* [ ] **Preflight & Config Hygiene:** Clean `.env.example`, valid Rime production model IDs, and no hardcoded secrets.