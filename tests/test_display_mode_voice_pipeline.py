import pytest
import json
from server import app, detect_display_command, DISPLAY_MODES


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


class TestDisplayModeVoicePipeline:
    """
    Test suite verifying Voice Input -> Intent Detection -> Action -> State Verification -> Voice/Text Output
    covering all acceptance tests specified in the requirements.
    """

    def test_single_source_of_truth(self):
        """DISPLAY_MODES must be centralized and properly defined."""
        assert "orb" in DISPLAY_MODES
        assert "oscilloscope" in DISPLAY_MODES
        assert DISPLAY_MODES["orb"] == "3D Holographic Orb"
        assert DISPLAY_MODES["oscilloscope"] == "Tactical Oscilloscope"

    def test_switch_to_holographic_mode(self, client):
        """Test 1: Voice command 'Switch to holographic mode.'"""
        resp = client.post("/api/voice-turn", json={
            "transcript": "Switch to holographic mode.",
            "current_display_mode": "oscilloscope"
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["action"] is not None
        assert data["action"]["type"] == "set_display_mode"
        assert data["action"]["mode"] == "orb"
        assert data["action"]["mode_name"] == "3D Holographic Orb"
        assert "3D Holographic Orb" in data["reply_text"]
        assert data["reply_text"] == "Done! I switched the display to 3D Holographic Orb."

    def test_switch_to_tactical_oscilloscope(self, client):
        """Test 2: Voice command 'Switch to tactical oscilloscope.'"""
        resp = client.post("/api/voice-turn", json={
            "transcript": "Switch to tactical oscilloscope.",
            "current_display_mode": "orb"
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["action"] is not None
        assert data["action"]["type"] == "set_display_mode"
        assert data["action"]["mode"] == "oscilloscope"
        assert data["action"]["mode_name"] == "Tactical Oscilloscope"
        assert "Tactical Oscilloscope" in data["reply_text"]
        assert data["reply_text"] == "Done! I switched the display to Tactical Oscilloscope."

    def test_go_back_to_holographic(self, client):
        """Test 3: Voice command 'Go back to holographic.'"""
        resp = client.post("/api/voice-turn", json={
            "transcript": "Go back to holographic.",
            "current_display_mode": "oscilloscope"
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["action"] is not None
        assert data["action"]["mode"] == "orb"
        assert data["reply_text"] == "Done! I switched the display to 3D Holographic Orb."

    def test_ambiguous_change_display_command(self, client):
        """Test 4: Ambiguous voice command 'Change the display.'"""
        resp = client.post("/api/voice-turn", json={
            "transcript": "Change the display.",
            "current_display_mode": "orb"
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("action") is None
        assert "Which display mode would you like?" in data["reply_text"]
        assert "3D Holographic Orb" in data["reply_text"]
        assert "Tactical Oscilloscope" in data["reply_text"]

    def test_invalid_mode_command(self, client):
        """Test 5: Invalid mode command 'Switch to quantum banana mode.'"""
        resp = client.post("/api/voice-turn", json={
            "transcript": "Switch to quantum banana mode.",
            "current_display_mode": "orb"
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("action") is None
        assert "Quantum Banana" in data["reply_text"]
        assert "I don't recognize Quantum Banana mode" in data["reply_text"]

    def test_natural_variations_holographic(self):
        """Test natural variations for holographic orb."""
        variations = [
            "switch to holographic mode",
            "go to holographic mode",
            "turn on holographic",
            "use the holographic orb",
            "show the 3D holographic orb",
            "change display to holographic",
            "make it holographic",
            "activate holographic mode",
            "switch to orb"
        ]
        for v in variations:
            res = detect_display_command(v)
            assert res is not None, f"Failed on variation: {v}"
            assert res["intent"] == "set_mode", f"Failed intent on: {v}"
            assert res["mode"] == "orb", f"Failed mode on: {v}"

    def test_natural_variations_tactical(self):
        """Test natural variations for tactical oscilloscope."""
        variations = [
            "switch to tactical mode",
            "use tactical oscilloscope",
            "show tactical display",
            "activate oscilloscope mode",
            "switch to oscilloscope",
            "make it tactical",
            "go to oscilloscope",
            "change display to tactical oscilloscope"
        ]
        for v in variations:
            res = detect_display_command(v)
            assert res is not None, f"Failed on variation: {v}"
            assert res["intent"] == "set_mode", f"Failed intent on: {v}"
            assert res["mode"] == "oscilloscope", f"Failed mode on: {v}"

    def test_contextual_go_back_with_previous_mode(self):
        """Test contextual 'go back' when previous mode is known."""
        res = detect_display_command("go back", current_mode="oscilloscope", previous_mode="orb")
        assert res is not None
        assert res["intent"] == "set_mode"
        assert res["mode"] == "orb"

    def test_contextual_go_back_without_previous_mode(self):
        """Test contextual 'go back' when previous mode is not known."""
        res = detect_display_command("go back", current_mode="orb", previous_mode=None)
        assert res is not None
        assert res["intent"] == "ask_clarification"
