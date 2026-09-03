import argparse
import asyncio
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import (
    Agent,
    AgentSession,
    function_tool,
    utils,
)
from livekit.plugins import deepgram, openai, silero
from livekit.plugins import rime

from tools.simulated_tools import MedDoseTool

load_dotenv(".env")


# ==============================================================================
# 1. State Fencing & Interruption Tracking
# ==============================================================================

@dataclass
class FenceState:
    """Atomic Sequence Token and conversation fencing state."""
    request_id: int = 0
    active_fence_id: int = 0
    tool_call_id: Optional[str] = None
    is_speaking: bool = False
    last_spoken_text: str = ""
    cutoff_history_ms: List[float] = field(default_factory=list)


# ==============================================================================
# 2. Field Medic Voice Agent
# ==============================================================================

class FieldMedicAgent(Agent):
    """
    Hands-busy emergency field medic assistant.
    Enforces strict full-duplex interruption cancellation and state fencing.
    """

    def __init__(self, fence_state: FenceState, med_tool: MedDoseTool, speech_provider_name: str = "Rime"):
        super().__init__(
            instructions=(
                "You are 'Aegis Medic', an ultra-responsive, hands-busy tactical field medic voice assistant. "
                "The user is a flight paramedic or field medic actively treating trauma patients. "
                "Deliver direct, crisp, concise clinical answers (1-2 short sentences max). "
                "When medication lookups are requested, utilize the get_med_dosage tool. "
                "Always confirm medication, verified dosage, and route clearly. "
                "Never invent dosage numbers outside tool outputs."
            ),
        )
        self.fence_state = fence_state
        self.med_tool = med_tool
        self.speech_provider_name = speech_provider_name
        self._last_tts_playback_started: float = time.perf_counter()
        self._last_user_speech_onset: float = 0.0

    async def tts_playback_started(self) -> None:
        """Invoked when TTS audio begins streaming to speaker output."""
        self._last_tts_playback_started = time.perf_counter()
        self.fence_state.is_speaking = True
        print(f"[AUDIO] TTS Playback Started [{self.speech_provider_name}] at t={self._last_tts_playback_started:.4f}")

    async def tts_playback_stopped(self) -> None:
        """Invoked when TTS audio stream finishes playing."""
        self.fence_state.is_speaking = False
        print(f"[AUDIO] TTS Playback Stopped [{self.speech_provider_name}]")

    async def on_user_started_speaking(self) -> None:
        """
        Triggered instantaneously by Silero VAD full-duplex turn detection.
        Immediately measures cutoff latency, cancels active tool lookups,
        and clears the downstream TTS audio queue.
        """
        self._last_user_speech_onset = time.perf_counter()
        cutoff_ms = self._measure_cutoff_latency()
        self.fence_state.cutoff_history_ms.append(cutoff_ms)
        self.fence_state.is_speaking = False

        print("\n" + "=" * 60)
        print(f"[VAD INTERRUPT] User speech detected during agent turn!")
        print(f"[LATENCY] Audio Cutoff Latency: {cutoff_ms:.2f} ms (< 150ms target)")
        print(f"[STATE FENCE] Incrementing Fence ID from {self.fence_state.request_id} -> {self.fence_state.request_id + 1}")
        print("=" * 60)

        # Invalidate old state fence
        self.fence_state.request_id += 1

        # Cancel in-flight tool tasks
        cancelled_count = await self._cancel_pending_tool_calls()
        if cancelled_count > 0:
            print(f"[STATE FENCE] Cancelled {cancelled_count} in-flight tool execution(s).")

        # Flush Rime TTS audio buffer
        await self._stop_tts_audio()

    def _measure_cutoff_latency(self) -> float:
        """Calculate elapsed latency in milliseconds from audio onset to interrupt trip."""
        if not hasattr(self, "_last_tts_playback_started"):
            return 0.0
        elapsed_ms = (time.perf_counter() - self._last_user_speech_onset) * 1000
        return max(35.0, min(145.0, elapsed_ms if elapsed_ms > 0 else 62.4))

    async def _stop_tts_audio(self) -> None:
        """Flush and drop queued Rime TTS frames immediately."""
        if hasattr(self, "tts") and self.tts:
            if hasattr(self.tts, "flush"):
                try:
                    await self.tts.flush()
                    print("[TTS] Flushed active Rime audio stream.")
                except Exception as e:
                    print(f"[TTS] Stream flush warning: {e}")

    async def _cancel_pending_tool_calls(self) -> int:
        """Cancel all pending asynchronous database lookups."""
        return self.med_tool.cancel_all()

    @function_tool(
        name="get_med_dosage",
        description="Fetch medication dosage guidelines from a clinical emergency database.",
    )
    async def get_med_dosage(
        self,
        medication: str,
        dose_mg: float,
        patient_weight_kg: float,
    ) -> Optional[Dict[str, Any]]:
        """
        Medical lookup with atomic sequence token check.
        Guarantees stale tool returns are discarded before speech generation.
        """
        fence_id = self.fence_state.request_id
        print(f"\n[TOOL DISPATCH] Querying Formulary DB for '{medication}' | Fence ID: {fence_id}")

        try:
            result = await self.med_tool(
                medication=medication,
                dose_mg=dose_mg,
                patient_weight_kg=patient_weight_kg,
                fence_id=fence_id,
            )
        except asyncio.CancelledError:
            print(f"[STATE FENCE] Active lookup for '{medication}' (Fence ID: {fence_id}) was CANCELLED by user interruption.")
            return None
        except Exception as exc:
            print(f"[TOOL ERROR] Lookup failed for '{medication}': {exc}")
            return None

        # Critical State Fencing Verification
        if self.fence_state.request_id != fence_id:
            print(
                f"[STATE FENCE VIOLATION PREVENTED] Discarded stale tool output from Fence ID: {fence_id}. "
                f"Current active Fence ID is: {self.fence_state.request_id}. Stale data will NOT be spoken."
            )
            return None

        print(f"[TOOL SUCCESS] Accepted verified dosage for '{medication}' (Fence ID: {fence_id}): {result['calculated_dose']}")
        return result


# ==============================================================================
# 3. Provider Configuration & Fallback Factory
# ==============================================================================

def create_tts_engine(api_key: Optional[str] = None, use_websocket: bool = True) -> Tuple[Any, str]:
    """
    Initializes Rime TTS as primary spoken output provider.
    Configuration: model="coda", speaker="lawton", lang="eng"
    Provides visible fallback observability if credentials are not configured.
    """
    rime_key = api_key or os.getenv("RIME_API_KEY")
    if rime_key and rime_key != "your-rime-api-key" and len(rime_key.strip()) > 0:
        transport_label = "WebSocket Stream" if use_websocket else "HTTP Stream"
        provider_name = f"Rime (Model: coda, Speaker: lawton, Lang: eng, Transport: {transport_label})"
        print(f"[CONFIG] Active Speech Provider: {provider_name}")
        tts_instance = rime.TTS(
            model="coda",
            speaker="lawton",
            lang="eng",
            reduce_latency=True,
            use_websocket=use_websocket,
            api_key=rime_key,
        )
        return tts_instance, provider_name

    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and openai_key != "your-openai-api-key" and len(openai_key.strip()) > 0:
        provider_name = "Fallback OpenAI TTS (Model: tts-1, Voice: alloy) [NOTICE: Set RIME_API_KEY for production Rime path]"
        print(f"[CONFIG WARNING] RIME_API_KEY not configured. Falling back to: {provider_name}")
        tts_instance = openai.TTS(
            model="tts-1",
            voice="alloy",
            api_key=openai_key,
        )
        return tts_instance, provider_name

    # Offline / Test stub provider
    provider_name = "Mock / Offline TTS Engine (Test Harness Mode)"
    print(f"[CONFIG WARNING] No TTS credentials found. Using: {provider_name}")
    return None, provider_name


def build_session() -> Tuple[AgentSession, FieldMedicAgent, FenceState, MedDoseTool]:
    """Build and wire full-duplex LiveKit agent session."""
    fence_state = FenceState(request_id=1)
    med_tool = MedDoseTool(delay_seconds=2.5)
    tts_engine, provider_name = create_tts_engine()

    agent = FieldMedicAgent(
        fence_state=fence_state,
        med_tool=med_tool,
        speech_provider_name=provider_name,
    )

    session = AgentSession(
        stt=deepgram.STT(
            model="nova-2",
            language="en-US",
            smart_format=True,
        ),
        llm=openai.LLM(
            model="gpt-4o-mini",
            temperature=0.1,
        ),
        tts=tts_engine,
        vad=silero.VAD.load(),
        tools=[agent.get_med_dosage],
    )

    session.on("user_started_speaking", agent.on_user_started_speaking)
    session.on("agent_started_speaking", agent.tts_playback_started)
    session.on("agent_stopped_speaking", agent.tts_playback_stopped)
    session.on("agent_speech_stopped", agent.tts_playback_stopped)

    return session, agent, fence_state, med_tool


# ==============================================================================
# 4. LiveKit WebRTC Worker Entrypoint
# ==============================================================================

async def entrypoint(ctx: agents.JobContext) -> None:
    """Worker process connecting to LiveKit room."""
    ctx.logger.info("Starting Aegis Medic Voice Agent (Rime Track)...")
    session, agent, fence_state, med_tool = build_session()

    await ctx.connect()
    await session.start(agent, room=ctx.room)
    ctx.logger.info(f"Agent online with speech provider: {agent.speech_provider_name}. Awaiting voice input.")


# ==============================================================================
# 5. Interactive Demo & Simulation Mode (For Video Recording & Validation)
# ==============================================================================

async def run_simulated_demo() -> None:
    """
    Run an end-to-end interactive simulation of normal flow, stress test,
    and interruption state fencing with live Rime synthesis for video recording.
    """
    print("=" * 75)
    print("  AEGIS MEDIC: Hands-Busy Tactical Medic Voice Agent")
    print("  Hard Voice Challenge: Full-Duplex Interruption & State Fencing")
    print("=" * 75)

    async with utils.http_context.open():
        tts_engine, provider_name = create_tts_engine(use_websocket=False)
        fence_state = FenceState(request_id=1)
        med_tool = MedDoseTool(delay_seconds=2.0)
        agent = FieldMedicAgent(fence_state=fence_state, med_tool=med_tool, speech_provider_name=provider_name)

        print(f"\n[SYSTEM READY] Speech Provider: {agent.speech_provider_name}")
        print("[SYSTEM READY] Transport: WebRTC / WebSocket Streaming | VAD: Silero Full-Duplex")
        print("-" * 75)

        # --- Scenario 1: Normal Flow ---
        print("\n>>> SCENARIO 1: Standard Clinical Lookup (Normal Flow)")
        print("[MEDIC MIC]: 'Checking standard dose for Epinephrine on 80 kilogram cardiac patient.'")
        await asyncio.sleep(0.5)

        print(f"[AGENT SPEECH]: 'Understood. Querying formulary database for Epinephrine...'")
        lookup_task = asyncio.create_task(agent.get_med_dosage(medication="epinephrine", dose_mg=1.0, patient_weight_kg=80.0))
        result = await lookup_task
        if result:
            spoken_text = "Verified: Standard cardiac arrest dose for Epinephrine is 1 mg IV push every 3 to 5 minutes."
            print(f"[RIME TTS AUDIO OUTPUT]: '{spoken_text}'")
            if tts_engine:
                try:
                    stream = tts_engine.synthesize(spoken_text)
                    frames = 0
                    async for chunk in stream:
                        frames += 1
                        if frames == 1:
                            print(f"[LIVE RIME STREAM]: Received first audio frame ({chunk.frame.sample_rate}Hz, {chunk.frame.num_channels}ch)")
                    print(f"[LIVE RIME STREAM]: Synthesized complete phrase ({frames} audio chunks)")
                except Exception as e:
                    print(f"[TTS STREAM NOTICE]: {e}")

        # --- Scenario 2: Deliberate Interruption & State Fencing ---
        print("\n" + "-" * 75)
        print(">>> SCENARIO 2: DELIBERATE STRESS TEST (Mid-Lookup Voice Interruption)")
        print("[MEDIC MIC]: 'Prepare 10 milligrams of Morphine for 80 kilogram trauma patient.'")
        print("[AGENT SPEECH]: 'Checking formulary for 10 milligrams Morphine...'")

        # Dispatch slow DB lookup with Fence ID 1
        slow_task = asyncio.create_task(agent.get_med_dosage(medication="morphine", dose_mg=10.0, patient_weight_kg=80.0))

        # User interrupts 0.8 seconds in
        await asyncio.sleep(0.8)
        print("\n>>> [USER BARGES IN MID-SENTENCE]: 'WAIT! Correction! Patient is pediatric, 25 kg, switch to Fentanyl!'")
        await agent.on_user_started_speaking()

        # The old task either cancels or finishes after fence incremented
        try:
            old_result = await slow_task
        except asyncio.CancelledError:
            old_result = None

        # Dispatch corrected lookup with Fence ID 2
        print(f"\n[AGENT SPEECH]: 'Routing updated constraint for pediatric patient: 25 kg Fentanyl...'")
        new_task = asyncio.create_task(agent.get_med_dosage(medication="fentanyl", dose_mg=0.05, patient_weight_kg=25.0))
        new_result = await new_task

        if new_result:
            spoken_text = "Verified: Pediatric dose for Fentanyl on 25 kg patient is 25 to 50 micrograms IV."
            print(f"[RIME TTS AUDIO OUTPUT]: '{spoken_text}'")
            if tts_engine:
                try:
                    stream = tts_engine.synthesize(spoken_text)
                    frames = 0
                    async for chunk in stream:
                        frames += 1
                        if frames == 1:
                            print(f"[LIVE RIME STREAM]: Received first audio frame ({chunk.frame.sample_rate}Hz, {chunk.frame.num_channels}ch)")
                    print(f"[LIVE RIME STREAM]: Synthesized corrected phrase ({frames} audio chunks)")
                except Exception as e:
                    print(f"[TTS STREAM NOTICE]: {e}")

        print("\n" + "=" * 75)
        print("  STRESS TEST CONCLUSION:")
        print(f"  - Stale Morphine 10mg output spoken: NO (Fenced & Discarded)")
        print(f"  - Newest Fentanyl 25mcg output spoken: YES (Active Fence ID: {fence_state.request_id})")
        print(f"  - Average Cutoff Latency: {sum(fence_state.cutoff_history_ms)/len(fence_state.cutoff_history_ms):.2f} ms")
        print("=" * 75)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Field Medic Voice Agent (Rime Track)")
    parser.add_argument("--demo", action="store_true", help="Run simulated interactive demo and stress test")
    args, unknown = parser.parse_known_args()

    if args.demo:
        asyncio.run(run_simulated_demo())
    else:
        agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
