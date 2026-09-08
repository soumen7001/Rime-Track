import os
import sys
import unittest.mock as mock
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voice_agent import RimeVoiceAgent, generate_agent_response


class TestVoiceAgent:
    """Test suite for Rime Voice Agent."""

    def test_initialization_with_env_key(self):
        """Test agent initialization with RIME_API_KEY from environment."""
        with mock.patch.dict(os.environ, {"RIME_API_KEY": "test-mock-key"}):
            agent = RimeVoiceAgent()
            assert agent.speaker == "wawona"
            assert agent.model_id == "coda"
            assert agent.sample_rate == 24000

    def test_missing_api_key_raises_error(self):
        """Test that missing or dummy API key raises ValueError."""
        with mock.patch.dict(os.environ, {"RIME_API_KEY": ""}):
            with pytest.raises(ValueError, match="RIME_API_KEY is not set"):
                RimeVoiceAgent(api_key="")

    def test_agent_response_generation(self):
        """Test simple conversational response generation."""
        resp = generate_agent_response("who are you?")
        assert len(resp) > 5

        resp_time = generate_agent_response("what time is it?")
        assert len(resp_time) > 5

        resp_joke = generate_agent_response("tell me a joke")
        assert len(resp_joke) > 10

    def test_out_of_scope_rejection(self):
        """Verify the agent rejects unrelated topics outside its clinical scope."""
        out_of_scope_prompts = [
            "Who won the cricket match yesterday?",
            "Give me a chocolate cake recipe",
            "Tell me about bitcoin prices",
            "Who is the president of France?",
        ]
        for prompt in out_of_scope_prompts:
            resp = generate_agent_response(prompt)
            assert any(phrase in resp.lower() for phrase in [
                "scope", "specialize", "clinical", "outside", "emergency",
            ]), f"Expected out-of-scope rejection for: {prompt!r}, got: {resp!r}"

    def test_greeting_response(self):
        """Verify 'who are you' returns a valid identity response."""
        resp = generate_agent_response("who are you?")
        assert any(keyword in resp.lower() for keyword in [
            "rime", "voice", "agent", "aegis", "medic",
        ]), f"Expected identity keywords in greeting response, got: {resp!r}"

    def test_farewell_response(self):
        """Verify 'bye' returns a goodbye message."""
        resp = generate_agent_response("bye")
        assert any(word in resp.lower() for word in [
            "goodbye", "bye", "farewell", "see you", "signing off", "sign off", "stay safe",
        ]), f"Expected farewell keywords, got: {resp!r}"

    def test_time_response(self):
        """Verify 'what time is it' returns a relevant response about time."""
        resp = generate_agent_response("what time is it?")
        # Rule-based path returns "HH:MM AM/PM"; LLM path may explain it can't tell time.
        # Either way the response must reference "time" meaningfully.
        has_formatted_time = ":" in resp and ("am" in resp.lower() or "pm" in resp.lower())
        mentions_time = "time" in resp.lower()
        assert has_formatted_time or mentions_time, \
            f"Expected time-related response, got: {resp!r}"
