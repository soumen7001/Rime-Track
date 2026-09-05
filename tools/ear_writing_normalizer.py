"""
Aegis Medic - 'Writing for the Ear' Phonetic & Pacing Normalizer
---------------------------------------------------------------
Implements Brooke Larson's "Writing for the Ear" guidelines for voice AI:
1. Expands complex medical pharmacopeia and Latin abbreviations into human-spoken phonetics.
2. Formats numbers, fractions, vitals, and dosages for unambiguous conversational delivery.
3. Keeps sentence lengths short and punctuation optimized for natural pauses in Rime TTS.
4. Dynamically selects urgency pacing based on triage severity level.
"""

import re
from typing import Dict, Tuple

# Pharmacopeia and Medical Acronym Phonetic Mapping
MEDICAL_EXPANSIONS: Dict[str, str] = {
    r"\bTXA\b": "Tran-ex-am-ic acid",
    r"\btxa\b": "Tran-ex-am-ic acid",
    r"\bGCS\b": "Glasgow Coma Scale",
    r"\bgcs\b": "Glasgow Coma Scale",
    r"\bSpO2\b": "S-P-O-2",
    r"\bspo2\b": "S-P-O-2",
    r"\bEtCO2\b": "end-tidal C-O-2",
    r"\betco2\b": "end-tidal C-O-2",
    r"\bIV\b": "I-V",
    r"\biv\b": "I-V",
    r"\bIO\b": "I-O",
    r"\bio\b": "I-O",
    r"\bIM\b": "I-M",
    r"\bim\b": "I-M",
    r"\bPO\b": "orally",
    r"\bpo\b": "orally",
    r"\bPRN\b": "as needed",
    r"\bprn\b": "as needed",
    r"\bNPO\b": "nothing by mouth",
    r"\bnpo\b": "nothing by mouth",
    r"\bBP\b": "blood pressure",
    r"\bbp\b": "blood pressure",
    r"\bHR\b": "heart rate",
    r"\bhr\b": "heart rate",
    r"\bRR\b": "respiratory rate",
    r"\brr\b": "respiratory rate",
    r"\bFAST\b": "FAST ultrasound",
    r"\bTBI\b": "traumatic brain injury",
    r"\btbi\b": "traumatic brain injury",
    r"\bGSW\b": "gunshot wound",
    r"\bgsw\b": "gunshot wound",
    r"\bMVC\b": "motor vehicle collision",
    r"\bmvc\b": "motor vehicle collision",
    r"\bSTAT\b": "immediately",
    r"\bstat\b": "immediately",
    r"\bmEq\b": "milliequivalents",
    r"\bmeq\b": "milliequivalents",
    r"\bmcg\b": "micrograms",
    r"\bmg\b": "milligrams",
    r"\bg\b": "grams",
    r"\bkg\b": "kilograms",
    r"\bml\b": "milliliters",
    r"\bmL\b": "milliliters",
    r"\bL\b": "liters",
    r"\bdl\b": "deciliters",
    r"\bmmHg\b": "millimeters of mercury",
    r"\bmmhg\b": "millimeters of mercury",
    r"\bbpm\b": "beats per minute",
    r"\bBPM\b": "beats per minute",
}

# Unit formatting patterns
UNIT_PATTERNS = [
    # Blood pressure: 120/80 -> 120 over 80
    (r"(\d+)/(\d+)\s*(?:mmHg|mmhg)?", r"\1 over \2"),
    # Dosage with unit: 10mg -> 10 milligrams
    (r"(\d+(?:\.\d+)?)\s*mg\b", r"\1 milligrams"),
    (r"(\d+(?:\.\d+)?)\s*mcg\b", r"\1 micrograms"),
    (r"(\d+(?:\.\d+)?)\s*g\b", r"\1 grams"),
    (r"(\d+(?:\.\d+)?)\s*kg\b", r"\1 kilograms"),
    (r"(\d+(?:\.\d+)?)\s*ml\b", r"\1 milliliters"),
    (r"(\d+(?:\.\d+)?)\s*mL\b", r"\1 milliliters"),
    (r"(\d+(?:\.\d+)?)\s*%\b", r"\1 percent"),
    # Infusion rates: 1g over 10 min -> 1 gram infused over 10 minutes
    (r"(\d+)\s*min\b", r"\1 minutes"),
    (r"(\d+)\s*sec\b", r"\1 seconds"),
    (r"(\d+)\s*hrs?\b", r"\1 hours"),
]

# Urgency Pacing Profiles
TRIAGE_PACING = {
    "immediate": {"speed": 1.12, "cadence": "rapid_urgent", "pause_sec": 0.15},
    "urgent": {"speed": 1.05, "cadence": "command_direct", "pause_sec": 0.20},
    "pediatric_dosage": {"speed": 0.92, "cadence": "deliberate_precision", "pause_sec": 0.35},
    "routine": {"speed": 1.00, "cadence": "standard_clinical", "pause_sec": 0.25},
}


class EarWritingNormalizer:
    """Normalizes raw LLM clinical output for clear auditory delivery by Rime TTS."""

    @staticmethod
    def normalize_for_speech(text: str, triage_level: str = "urgent") -> Tuple[str, float]:
        """
        Transforms text into speech-optimized format and returns (normalized_text, rime_speed).
        """
        if not text:
            return "", 1.0

        normalized = text

        # 1. Clean markdown formatting (bullet points, bolding, italics)
        normalized = re.sub(r"[\*\_#`]", "", normalized)
        normalized = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", normalized)
        normalized = re.sub(r"^\s*[-+•]\s*", "", normalized, flags=re.MULTILINE)

        # 2. Normalize unit patterns (e.g. 120/80 -> 120 over 80)
        for pattern, replacement in UNIT_PATTERNS:
            normalized = re.sub(pattern, replacement, normalized)

        # 3. Apply medical acronym & pharmacopeia expansions
        for abbr, expansion in MEDICAL_EXPANSIONS.items():
            normalized = re.sub(abbr, expansion, normalized)

        # 4. Brooke Larson ear-writing rules:
        # Break overly long run-on compound sentences into punchy spoken segments.
        normalized = re.sub(r";\s*", ". ", normalized)
        normalized = re.sub(r"\s*--\s*", ", ", normalized)
        normalized = re.sub(r"\s+-\s+", ", ", normalized)

        # Ensure commas are followed by proper breathing pauses
        normalized = re.sub(r",(?!\s)", ", ", normalized)
        normalized = re.sub(r"\.(?!\s|$)", ". ", normalized)

        # Remove double spaces
        normalized = re.sub(r"\s{2,}", " ", normalized).strip()

        # Determine Rime pacing speed multiplier
        pacing_config = TRIAGE_PACING.get(triage_level, TRIAGE_PACING["urgent"])
        speed = pacing_config["speed"]

        return normalized, speed


# Global instance for easy import
normalizer = EarWritingNormalizer()
