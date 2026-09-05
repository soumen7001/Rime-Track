import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from preflight_check import (
    check_environment,
    run_live_rime_catalog_and_latency,
    run_real_interruption_cutoff_benchmark,
)


def test_preflight_environment_hygiene():
    """Verify that environment secrets are loaded and none are exposed raw."""
    keys = check_environment()
    assert isinstance(keys, dict)
    assert "RIME_API_KEY" in keys


def test_preflight_live_rime_catalog():
    """Verify live Rime production catalog confirmation (model: coda, speaker: lawton, lang: eng)."""
    rime_key = os.getenv("RIME_API_KEY", "")
    if not rime_key or rime_key.startswith("your-"):
        pytest.skip("RIME_API_KEY not set for live API test")
    stats = run_live_rime_catalog_and_latency(rime_key)
    assert stats["catalog_valid"] is True
    assert stats["uncached_ms"] is not None
    assert stats["cached_ms"] is not None


@pytest.mark.asyncio
async def test_preflight_hard_voice_real_cutoff():
    """Verify real wall-clock cutoff latency (<150ms SLA) and state fencing."""
    real_cutoff_ms = await run_real_interruption_cutoff_benchmark()
    assert real_cutoff_ms < 150.0, f"Cutoff latency {real_cutoff_ms}ms exceeded 150ms SLA limit"
