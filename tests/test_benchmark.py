import pytest
from benchmark_runner import run_full_benchmark, PROVIDER_CONFIGS, BENCHMARK_CORPUS

def test_benchmark_runner_structure():
    report = run_full_benchmark()
    assert "timestamp" in report
    assert "providers" in report
    assert "rime" in report["providers"]
    assert "cartesia" in report["providers"]
    assert "elevenlabs" in report["providers"]
    assert "openai" in report["providers"]

    rime_data = report["providers"]["rime"]
    assert rime_data["model"] == "coda"
    assert rime_data["speaker"] == "lawton"
    assert rime_data["measured_ttfa_ms"] > 0
    assert rime_data["clinical_phoneme_clarity_score"] > 9.0

def test_benchmark_corpus_validity():
    assert len(BENCHMARK_CORPUS) >= 3
    for item in BENCHMARK_CORPUS:
        assert "id" in item
        assert "text" in item
        assert len(item["text"]) > 10
