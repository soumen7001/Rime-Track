import asyncio
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class MedDoseRequest:
    request_id: int
    medication: str
    dose_mg: float
    patient_weight_kg: float
    patient_age_group: str = "adult"  # "adult" or "pediatric"


class MedDoseTool:
    """
    Simulated Medical Dosage & Protocol Lookup Tool.
    Introduces a configurable delay (default 2.5s) to simulate an EHR / Formulary DB query,
    enabling real-time testing of full-duplex interruption, cancellation, and state fencing.
    """

    name = "get_med_dosage"
    description = (
        "Fetch emergency medication dosage, indications, and safety limits "
        "from the clinical formulary database based on patient weight and condition."
    )

    # Reference emergency formulary guidelines
    DOSAGE_FORMULARY = {
        "epinephrine": {
            "cardiac_arrest_adult": "1 mg IV/IO every 3-5 min",
            "anaphylaxis_adult": "0.3 - 0.5 mg IM (1:1,000)",
            "anaphylaxis_pediatric": "0.01 mg/kg IM (max 0.3 mg)",
            "max_single_dose_mg": 1.0,
            "unit": "mg",
        },
        "morphine": {
            "adult_analgesia": "0.1 mg/kg IV (typically 2-10 mg)",
            "pediatric_analgesia": "0.05 - 0.1 mg/kg IV",
            "max_single_dose_mg": 10.0,
            "unit": "mg",
        },
        "fentanyl": {
            "adult_analgesia": "1 - 2 mcg/kg IV (typically 50-100 mcg)",
            "pediatric_analgesia": "1 - 2 mcg/kg IV/IN",
            "max_single_dose_mg": 0.2,
            "unit": "mcg",
        },
        "amiodarone": {
            "cardiac_arrest_first_dose": "300 mg IV/IO push",
            "cardiac_arrest_second_dose": "150 mg IV/IO push",
            "pediatric_dose": "5 mg/kg IV/IO",
            "max_single_dose_mg": 300.0,
            "unit": "mg",
        },
        "naloxone": {
            "opioid_overdose_adult": "0.4 - 2.0 mg IV/IM/IN",
            "opioid_overdose_pediatric": "0.1 mg/kg IV/IM (max 2 mg)",
            "max_single_dose_mg": 2.0,
            "unit": "mg",
        },
        "atropine": {
            "bradycardia_adult": "0.5 - 1.0 mg IV every 3-5 min (max 3 mg)",
            "pediatric_dose": "0.02 mg/kg IV (min 0.1 mg, max 0.5 mg)",
            "max_single_dose_mg": 1.0,
            "unit": "mg",
        },
        "ketamine": {
            "procedural_sedation": "1 - 2 mg/kg IV or 4 - 5 mg/kg IM",
            "analgesia": "0.1 - 0.3 mg/kg IV",
            "max_single_dose_mg": 200.0,
            "unit": "mg",
        },
    }

    def __init__(self, delay_seconds: float = 2.5) -> None:
        self._delay = delay_seconds
        self._pending_calls: Dict[int, asyncio.Task] = {}
        self.call_history: list = []

    async def __call__(
        self,
        medication: str,
        dose_mg: float,
        patient_weight_kg: float,
        fence_id: int,
    ) -> Dict[str, Any]:
        task = asyncio.create_task(
            self._simulated_db_lookup(
                medication=medication.strip().lower(),
                dose_mg=dose_mg,
                patient_weight_kg=patient_weight_kg,
                fence_id=fence_id,
            )
        )
        self._pending_calls[fence_id] = task
        try:
            return await task
        finally:
            self._pending_calls.pop(fence_id, None)

    async def _simulated_db_lookup(
        self,
        medication: str,
        dose_mg: float,
        patient_weight_kg: float,
        fence_id: int,
    ) -> Dict[str, Any]:
        start_time = time.perf_counter()
        # Simulated database latency to demonstrate mid-lookup interruption
        await asyncio.sleep(self._delay)
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        med_info = self.DOSAGE_FORMULARY.get(medication, {
            "standard_dose": f"Calculated {dose_mg}mg for {patient_weight_kg}kg body weight",
            "max_single_dose_mg": dose_mg * 1.5,
            "unit": "mg",
        })

        is_weight_adjusted = patient_weight_kg > 0
        calculated_dose = dose_mg
        if is_weight_adjusted and "pediatric_analgesia" in med_info and patient_weight_kg < 40:
            calculated_dose = round(0.1 * patient_weight_kg, 2)

        result = {
            "request_id": fence_id,
            "medication": medication.capitalize(),
            "requested_dose_mg": dose_mg,
            "patient_weight_kg": patient_weight_kg,
            "calculated_dose": f"{calculated_dose} mg",
            "formulary_guideline": med_info.get("adult_analgesia") or med_info.get("cardiac_arrest_adult") or f"{dose_mg} mg standard",
            "status": "APPROVED",
            "lookup_latency_ms": round(elapsed_ms, 2),
            "source": "Clinical_Formulary_Service_v2.4",
        }
        self.call_history.append(result)
        return result

    def cancel_pending(self, fence_id: int) -> bool:
        task = self._pending_calls.get(fence_id)
        if task and not task.done():
            task.cancel()
            self._pending_calls.pop(fence_id, None)
            return True
        return False

    def cancel_all(self) -> int:
        cancelled_count = 0
        for fence_id, task in list(self._pending_calls.items()):
            if not task.done():
                task.cancel()
                cancelled_count += 1
        self._pending_calls.clear()
        return cancelled_count
