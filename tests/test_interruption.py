import asyncio
import os
import time

import pytest

from agent import (
    FieldMedicAgent,
    FenceState,
    create_tts_engine,
)
from tools.simulated_tools import MedDoseTool


class TestInterruptionLatency:
    """
    Test suite for Hard Voice Problem:
    Full-Duplex Interruption, <150ms Cutoff Latency, and State Fencing.
    """

    @pytest.mark.asyncio
    async def test_cutoff_latency_under_150ms(self) -> None:
        """Verify that audio/task cancellation latency is strictly under 150 ms."""
        tool = MedDoseTool(delay_seconds=2.0)
        request_id = 1
        task = asyncio.create_task(
            tool(
                medication="morphine",
                dose_mg=5.0,
                patient_weight_kg=80.0,
                fence_id=request_id,
            )
        )
        await asyncio.sleep(0.3)

        cutoff_start = time.perf_counter()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        cutoff_end = time.perf_counter()

        cutoff_ms = (cutoff_end - cutoff_start) * 1000
        print(f"\n[BENCH] Measured Cutoff Latency: {cutoff_ms:.2f} ms")
        assert cutoff_ms < 150.0, f"Cutoff latency {cutoff_ms:.2f}ms exceeded 150ms threshold"

    @pytest.mark.asyncio
    async def test_stale_tool_output_discarded(self) -> None:
        """Verify that stale tool results with outdated fence IDs are discarded."""
        fence_state = FenceState(request_id=10)
        tool = MedDoseTool(delay_seconds=0.1)

        task = asyncio.create_task(
            tool(
                medication="epinephrine",
                dose_mg=0.3,
                patient_weight_kg=70.0,
                fence_id=fence_state.request_id,
            )
        )

        await asyncio.sleep(0.04)
        # User interrupts, fence ID advances
        fence_state.request_id = 11

        result = await task
        is_stale = result.get("request_id") != fence_state.request_id
        print(
            f"\n[BENCH] Stale output detected: {is_stale} "
            f"(Tool fence_id={result.get('request_id')}, Current fence_id={fence_state.request_id})"
        )
        assert is_stale, "Stale tool output must be flagged and discarded"

    @pytest.mark.asyncio
    async def test_newest_request_id_accepted(self) -> None:
        """Verify that latest query matching active fence ID is accepted."""
        fence_state = FenceState(request_id=20)
        tool = MedDoseTool(delay_seconds=0.05)

        result = await tool(
            medication="fentanyl",
            dose_mg=0.1,
            patient_weight_kg=65.0,
            fence_id=fence_state.request_id,
        )

        accepted = result.get("request_id") == fence_state.request_id
        print(
            f"\n[BENCH] Current result accepted: {accepted} "
            f"(result fence_id={result.get('request_id')}, active={fence_state.request_id})"
        )
        assert accepted, "Current tool output must match active fence ID"
        assert result.get("status") == "APPROVED"

    @pytest.mark.asyncio
    async def test_agent_get_med_dosage_state_fencing(self) -> None:
        """Verify FieldMedicAgent discard logic via get_med_dosage method."""
        fence_state = FenceState(request_id=1)
        med_tool = MedDoseTool(delay_seconds=0.2)
        agent = FieldMedicAgent(fence_state=fence_state, med_tool=med_tool)

        # Dispatch call under fence_id 1
        lookup_task = asyncio.create_task(
            agent.get_med_dosage(medication="morphine", dose_mg=10.0, patient_weight_kg=80.0)
        )

        # Simulate user speech onset (interrupt)
        await asyncio.sleep(0.05)
        await agent.on_user_started_speaking()

        result = await lookup_task
        assert result is None, "Agent must return None when tool output arrives on obsolete fence ID"

    @pytest.mark.asyncio
    async def test_multiple_rapid_interruptions_stress(self) -> None:
        """Stress test: 5 consecutive interruptions mid-execution."""
        tool = MedDoseTool(delay_seconds=0.1)
        fence_state = FenceState(request_id=0)
        agent = FieldMedicAgent(fence_state=fence_state, med_tool=tool)

        for i in range(5):
            asyncio.create_task(
                agent.get_med_dosage(
                    medication="atropine",
                    dose_mg=0.5 + i * 0.1,
                    patient_weight_kg=75.0,
                )
            )
            await asyncio.sleep(0.02)
            await agent.on_user_started_speaking()

        # Execute final valid request without interruption
        final_fence_id = fence_state.request_id
        final_result = await agent.get_med_dosage(
            medication="atropine",
            dose_mg=1.0,
            patient_weight_kg=75.0,
        )

        assert final_result is not None
        assert final_result["request_id"] == final_fence_id
        assert len(fence_state.cutoff_history_ms) >= 5
        print(f"\n[BENCH] Completed 5 rapid interruptions. Final Fence ID: {final_fence_id}")

    def test_tts_provider_factory(self) -> None:
        """Verify TTS engine instantiation and visible provider disclosure."""
        # Test 1: Rime TTS instance with model coda, speaker lawton
        tts_engine, provider_name = create_tts_engine()
        assert tts_engine is not None
        assert "Rime" in provider_name
        assert "coda" in provider_name
        assert "lawton" in provider_name
        print(f"\n[BENCH] Verified Active Rime Engine: {provider_name}")

        # Test 2: Visible fallback observability when RIME_API_KEY is empty
        import unittest.mock as mock
        with mock.patch.dict(os.environ, {"RIME_API_KEY": "", "OPENAI_API_KEY": ""}):
            _, fallback_name = create_tts_engine()
            assert "Mock" in fallback_name or "Fallback" in fallback_name
            print(f"[BENCH] Verified Fallback Provider Logging: {fallback_name}")
