import pytest
from server import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_index_route(client):
    """Verify that the tactical HUD web interface is served."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"AEGIS MEDIC" in response.data
    assert b"AUDIO ENGINE & OSCILLOSCOPE" in response.data


def test_telemetry_endpoint(client):
    """Verify telemetry endpoint returns Rime provider configuration & benchmark metrics."""
    response = client.get("/api/telemetry")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ONLINE"
    assert data["speech_provider"]["model_id"] == "coda"
    assert data["speech_provider"]["speaker_id"] == "lawton"
    assert data["benchmarks"]["interruption_cutoff_ms"] <= 150.0


def test_livekit_token_endpoint(client):
    """Verify LiveKit WebRTC connection token generation."""
    response = client.get("/api/token?room=trauma-unit-1&name=medic-alpha")
    assert response.status_code == 200
    data = response.get_json()
    assert data["roomName"] == "trauma-unit-1"
    assert "token" in data


def test_simulate_normal_flow_stream(client):
    """Verify SSE streaming for normal clinical scenario."""
    response = client.get("/api/simulate?scenario=normal")
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    data = response.data.decode("utf-8")
    assert "SCENARIO_START" in data
    assert "Epinephrine" in data
    assert "SCENARIO_COMPLETE" in data


def test_simulate_interruption_stress_stream(client):
    """Verify SSE streaming for mid-lookup interruption & state fencing."""
    response = client.get("/api/simulate?scenario=interruption")
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    data = response.data.decode("utf-8")
    assert "VAD_INTERRUPT" in data
    assert "STATE_FENCE_DISCARD" in data
    assert "Fentanyl" in data
    assert "SCENARIO_COMPLETE" in data
