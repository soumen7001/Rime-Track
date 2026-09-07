import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.agent_memory import AgentMemory
from voice_agent import generate_agent_response


class TestAgentMemoryAndLearning:
    """Test suite for agent continuous learning, mistake correction, and memory."""

    def test_learn_user_fact(self, tmp_path):
        """Verify the agent learns and persists user facts."""
        mem_file = str(tmp_path / "test_memory.json")
        mem = AgentMemory(memory_file=mem_file)

        # Detect fact
        confirm = mem.detect_and_learn("My name is Sarah")
        assert confirm is not None
        assert "Sarah" in confirm
        assert mem.memories["user_facts"]["user_name"] == "Sarah"

        # Verify persistence
        mem2 = AgentMemory(memory_file=mem_file)
        assert mem2.memories["user_facts"]["user_name"] == "Sarah"

    def test_learn_explicit_rule(self, tmp_path):
        """Verify the agent learns custom user instructions and rules."""
        mem_file = str(tmp_path / "test_memory.json")
        mem = AgentMemory(memory_file=mem_file)

        confirm = mem.detect_and_learn("Remember that our unit protocol requires 2 IV lines for trauma")
        assert confirm is not None
        assert "remembered" in confirm.lower()

        context = mem.get_memory_context()
        assert "2 IV lines" in context

    def test_correction_from_mistake(self, tmp_path):
        """Verify the agent captures and records mistake corrections."""
        mem_file = str(tmp_path / "test_memory.json")
        mem = AgentMemory(memory_file=mem_file)

        # Simulate agent making a statement, and user correcting it
        mistake_reply = "The pediatric dose is 50 mg."
        user_correction = "No, actually the pediatric dose is 25 mg for a 25 kg patient."

        confirm = mem.detect_and_learn(user_correction, last_agent_reply=mistake_reply)
        assert confirm is not None
        assert "updated my memory" in confirm or "correction" in confirm.lower()
        assert len(mem.memories["corrections"]) == 1
        assert "25 mg" in mem.memories["corrections"][0]["correction"]

    def test_memory_context_injection(self, tmp_path):
        """Verify memory context is properly formatted for LLM prompts."""
        mem_file = str(tmp_path / "test_memory.json")
        mem = AgentMemory(memory_file=mem_file)

        mem.add_fact("role", "Senior Flight Paramedic")
        mem.add_correction(mistake="Give 100mg", correction="Give 50mg max")

        context = mem.get_memory_context()
        assert "Senior Flight Paramedic" in context
        assert "Give 50mg max" in context
