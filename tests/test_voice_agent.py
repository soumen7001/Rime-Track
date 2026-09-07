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
