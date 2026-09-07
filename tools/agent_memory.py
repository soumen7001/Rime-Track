"""
Agent Memory & Continuous Learning System
==========================================
Persistent memory and active learning module for the Voice Agent.

Capabilities:
1. Detects user corrections, preferences, and explicit learning commands.
2. Persists memories in JSON format (agent_memory.json).
3. Injects relevant learned facts into the LLM system prompt for accurate contextual answers.
4. Corrects past mistakes dynamically based on user feedback.
"""

import json
import os
import re
import time
from typing import Any, Dict, List, Optional


class AgentMemory:
    """
    Manages long-term persistent memory and dynamic learning for the agent.
    """

    def __init__(self, memory_file: str = "agent_memory.json"):
        self.memory_file = memory_file
        self.memories: Dict[str, Any] = {
            "user_facts": {},      # e.g., {"user_name": "Alex", "role": "Flight Medic"}
            "corrections": [],     # e.g., [{"mistake": "X", "correction": "Y", "timestamp": "..."}]
            "preferences": {},     # e.g., {"voice_speed": "fast", "conciseness": "high"}
            "clinical_rules": {},   # e.g., {"default_adult_weight": 80}
            "conversation_history": []
        }
        self.load()

    def load(self) -> None:
        """Load memories from disk if available."""
        if os.path.exists(self.memory_file):
            try:
                with open(self.memory_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.memories.update(data)
            except Exception as e:
                print(f"[MEMORY WARNING] Could not load memory file: {e}")

    def save(self) -> None:
        """Persist memories to disk."""
        try:
            with open(self.memory_file, "w", encoding="utf-8") as f:
                json.dump(self.memories, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[MEMORY WARNING] Could not save memory file: {e}")

    def add_fact(self, key: str, value: str) -> None:
        """Store or update a learned fact."""
        self.memories["user_facts"][key] = value
        self.save()

    def add_correction(self, mistake: str, correction: str, topic: Optional[str] = None) -> None:
        """Record a corrected mistake so the agent does not repeat it."""
        entry = {
            "topic": topic or "general",
            "mistake": mistake,
            "correction": correction,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        self.memories["corrections"].append(entry)
        self.save()

    def detect_and_learn(self, user_input: str, last_agent_reply: Optional[str] = None) -> Optional[str]:
        """
        Analyze user input for corrections, preferences, and facts to remember.
        Returns a confirmation message if a learning event was triggered.
        """
        lower = user_input.strip().lower()

        # 1. Explicit remember command (e.g., "Remember that I am a paramedic")
        remember_match = re.search(r'(?:remember|note|learn)\s+(?:that\s+)?(.+)', user_input, re.IGNORECASE)
        if remember_match:
            fact = remember_match.group(1).strip()
            self.add_fact(f"fact_{int(time.time())}", fact)
            return f"I have noted and remembered that: {fact}."

        # 2. Name introduction (e.g., "My name is John" / "Call me Dr. Smith")
        name_match = re.search(r'(?:my name is|call me|i am)\s+([A-Za-z]+)', user_input, re.IGNORECASE)
        if name_match and not any(w in lower for w in ["looking", "giving", "checking", "administering", "treating"]):
            name = name_match.group(1).capitalize()
            self.add_fact("user_name", name)
            return f"Understood, I will remember your name is {name}."

        # 3. Explicit correction of previous response (e.g., "No, actually ...", "Correction: ...", "That's wrong, ...")
        correction_match = re.search(
            r'(?:no[,\s]+actually|correction[:\s]|that(?:\'s|\s+is)\s+(?:wrong|incorrect)[,\s]*|instead\s+(?:use|give|it is))\s*(.+)',
            lower,
            re.IGNORECASE
        )
        if correction_match:
            correction = correction_match.group(1).strip()
            mistake = last_agent_reply or "previous statement"
            self.add_correction(mistake=mistake, correction=correction)
            return f"Thank you for the correction. I have updated my memory with: {correction}."

        return None

    def get_memory_context(self) -> str:
        """
        Build a concise context block of learned memories to inject into the LLM system prompt.
        """
        lines = []

        if self.memories.get("user_facts"):
            facts_str = "; ".join(f"{k}: {v}" for k, v in self.memories["user_facts"].items())
            lines.append(f"Learned User Facts: {facts_str}")

        if self.memories.get("corrections"):
            # Include the 5 most recent corrections
            recent_corrections = self.memories["corrections"][-5:]
            corr_str = " | ".join(
                f"Instead of '{c['mistake'][:40]}', correct answer is '{c['correction']}'"
                for c in recent_corrections
            )
            lines.append(f"Past Corrections & Rules: {corr_str}")

        if self.memories.get("preferences"):
            pref_str = "; ".join(f"{k}: {v}" for k, v in self.memories["preferences"].items())
            lines.append(f"User Preferences: {pref_str}")

        return "\n".join(lines)

    def clear(self) -> None:
        """Reset memory store."""
        self.memories = {
            "user_facts": {},
            "corrections": [],
            "preferences": {},
            "clinical_rules": {},
            "conversation_history": []
        }
        self.save()


# Global memory singleton instance
memory = AgentMemory()
