import pytest
from tools.ear_writing_normalizer import EarWritingNormalizer, normalizer

def test_pharmacopeia_expansions():
    text = "Administer TXA 1g IV immediately."
    normalized, speed = normalizer.normalize_for_speech(text, triage_level="immediate")
    assert "Tran-ex-am-ic acid" in normalized
    assert "1 grams" in normalized or "1 gram" in normalized or "1" in normalized
    assert "I-V" in normalized
    assert speed == 1.12

def test_vitals_normalization():
    text = "Patient BP 120/80, SpO2 92%, GCS 14."
    normalized, speed = normalizer.normalize_for_speech(text, triage_level="urgent")
    assert "120 over 80" in normalized
    assert "S-P-O-2" in normalized
    assert "Glasgow Coma Scale" in normalized
    assert speed == 1.05

def test_pediatric_pacing():
    text = "Calculated Fentanyl dose 25mcg."
    normalized, speed = normalizer.normalize_for_speech(text, triage_level="pediatric_dosage")
    assert "micrograms" in normalized
    assert speed == 0.92

def test_markdown_stripping():
    text = "**CRITICAL ALERT**: - Push `TXA` [protocol](http://link)"
    normalized, speed = normalizer.normalize_for_speech(text)
    assert "**" not in normalized
    assert "`" not in normalized
    assert "protocol" in normalized
    assert "http" not in normalized
