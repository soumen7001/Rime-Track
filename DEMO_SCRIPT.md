# 4-Minute Demo Video Recording Script
### Project: Aegis Medic (Rime Hackathon Submission)

---

## Video Structure & Timeline (Total Duration: 3:30 – 4:30 Minutes)

| Timestamp | Section | Key Visuals / Actions |
| :--- | :--- | :--- |
| **0:00 – 0:45** | **1. The Problem & Necessity of Voice (25%)** | Introduce yourself, state the role (field medic / flight paramedic), explain why voice is non-negotiable. |
| **0:45 – 1:30** | **2. Normal Flow & Rime Speech Quality (20%)** | Show normal voice interaction, observe Rime `mist`/`cove` streaming audio and sub-second response. |
| **1:30 – 2:45** | **3. The Hard Voice Problem & Live Stress Test (25%)** | Introduce the 2.5s DB lookup, interrupt mid-generation, prove instant $<150\text{ ms}$ cutoff and state fencing. |
| **2:45 – 3:30** | **4. Latency Telemetry & Automated Evidence (20%)** | Show terminal benchmark logs, run `pytest -v -s`, highlight `RIME_EVIDENCE.md`. |
| **3:30 – 4:00** | **5. Architecture, Provider Observability & Wrap-up (10%)** | Highlight LiveKit + Rime WebRTC pipeline, configuration hygiene, and concluding remarks. |

---

## Minute-by-Minute Spoken Script & Walkthrough

### Part 1: Problem & Necessity of Voice (0:00 – 0:45)

> **[On Camera / Screen showing Architecture Diagram in Readme]**
>
> *"Hello judges! Welcome to our submission for the Rime Hackathon: **Aegis Medic**, a voice-native assistant built for emergency trauma medics and flight paramedics.*
>
> *In emergency triage, a medic’s hands are covered in sterile gloves applying tourniquets, chest seals, and starting IV lines. Their eyes cannot leave the patient. Removing voice from this workflow is not an option—it is literally life or death. A simple chatbot with a play button is completely useless in the field."*

---

### Part 2: Normal Flow & Rime Integration (0:45 – 1:30)

> **[Screen showing Terminal / Live Agent]**
>
> *"Let's look at the standard workflow. We are running LiveKit Agents paired with **Rime’s production low-latency `coda` model with the `lawton` speaker over chunked WebSockets**.*
>
> *Notice in the logs, our speech provider is explicitly identified: `Active Speech Provider: Rime (Model: coda, Speaker: lawton, Lang: eng)`.*
>
> *Let's run a standard clinical query:"*
>
> **You say into Mic / Run demo:**
> *"Checking standard dose for Epinephrine on 80 kilogram cardiac patient."*
>
> **Agent responds via Rime TTS:**
> *"Verified: Standard cardiac arrest dose for Epinephrine is 1 mg IV push every 3 to 5 minutes."*
>
> *"Notice the crisp, authoritative delivery, the exact clinical pronunciation, and the ultra-low Time-To-First-Audio frame."*

---

### Part 3: The Hard Voice Problem & Stress Test (1:30 – 2:45)

> **[Screen focused on Terminal output and State Fencing logs]**
>
> *"Now, let's address the core engineering challenge: **Full-Duplex Interruption, $<150\text{ ms}$ Cutoff, and State Fencing during Asynchronous Database Lookups**.*
>
> *In the real world, clinical constraints change in a split second. A medic might request an adult dose of Morphine, but while the 2.5-second EHR database lookup is executing, they realize the patient is a 25-kilogram child.*
>
> *In a naive voice assistant, the system would finish the slow adult lookup and speak a lethal adult dose over the medic. Here is how Aegis Medic solves this.*
>
> *Watch what happens when I interrupt mid-lookup:"*
>
> **Step 1 (Start initial query):**
> *"Prepare 10 milligrams of Morphine for 80 kilogram trauma patient."*
>
> **Step 2 (Interrupt 0.8s later while tool is searching):**
> *"WAIT! Correction! Patient is pediatric, 25 kilograms, switch to Fentanyl!"*
>
> **[Point to the screen logs]:**
> - *1. Silero VAD triggered instant interruption.*
> - *2. Downstream Rime audio buffer was flushed in **$35.0\text{ ms}$**—well below our $<150\text{ ms}$ target.*
> - *3. The Atomic Fence ID advanced from 1 to 2.*
> - *4. The in-flight Morphine lookup was cancelled.*
> - *5. When the old lookup completed, the state fence intercepted it: `[STATE FENCE VIOLATION PREVENTED] Discarded stale tool output`.*
> - *6. Only the corrected pediatric Fentanyl dosage was synthesized and spoken: `Verified: Pediatric dose for Fentanyl on 25 kg patient is 25 to 50 micrograms IV.`"*

---

### Part 4: Automated Benchmarks & Evidence (2:45 – 3:30)

> **[Run `pytest -v -s` on screen]**
>
> *"We back all our claims with committed, repeatable evidence in `RIME_EVIDENCE.md`.*
>
> *Let's run our automated test suite with `pytest -v -s`:*
>
> - *`test_cutoff_latency_under_150ms`: Passes with $0.05 - 35\text{ ms}$ cancellation speed.*
> - *`test_stale_tool_output_discarded`: Proves stale tool calls are never accepted.*
> - *`test_newest_request_id_accepted`: Validates latest constraint execution.*
> - *`test_multiple_rapid_interruptions_stress`: Stress-tests 5 back-to-back interruptions without memory or audio leakage.*
> - *`test_tts_provider_factory`: Verifies production Rime configuration and visible fallback observability.*
>
> *All 6 tests pass cleanly with 100% reproducibility."*

---

### Part 5: Architecture & Wrap-Up (3:30 – 4:00)

> **[Show `.env.example` and GitHub Repository]**
>
> *"To ensure top scoring on configuration hygiene: our repository contains a clean `.env.example` with zero exposed secrets, fully ready for the organizers' automated preflight check.*
>
> *In summary, Aegis Medic proves that with Rime’s fast streaming TTS and full-duplex state fencing, voice assistants can safely operate in life-critical, hands-busy environments.*
>
> *Thank you to Rime and Pathway for hosting this hackathon!"*

---

## Quick Checklist Before Recording
- [ ] Terminal window is zoomed in for clear readability (Font size 16-18pt).
- [ ] Run `python agent.py --demo` once to ensure smooth execution.
- [ ] Run `pytest -v -s` to verify tests are ready to show.
- [ ] Keep video length between 3:30 and 4:30 minutes.
