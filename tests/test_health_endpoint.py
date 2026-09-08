import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


class TestHealthEndpoint:
    """Test suite for the /api/health live service health check endpoint."""

    def test_health_endpoint_returns_200(self, client):
        """Verify the health endpoint is reachable and returns valid JSON."""
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data is not None
        assert "status" in data
        assert data["status"] in ("HEALTHY", "DEGRADED")
        assert "server" in data
        assert data["server"] == "Aegis Medic Tactical HUD"

    def test_health_endpoint_has_uptime(self, client):
        """Verify uptime is a positive number of seconds."""
        resp = client.get("/api/health")
        data = resp.get_json()
        assert "uptime_seconds" in data
        assert isinstance(data["uptime_seconds"], (int, float))
        assert data["uptime_seconds"] >= 0

    def test_health_endpoint_has_service_checks(self, client):
        """Verify each expected service section exists in the response."""
        resp = client.get("/api/health")
        data = resp.get_json()
        assert "services" in data
        services = data["services"]
        assert "rime" in services
        assert "groq" in services
        assert "openai" in services
        # Each service must report configured flag and latency
        for svc_name, svc_data in services.items():
            assert "configured" in svc_data, f"{svc_name} missing 'configured' field"
            assert "reachable" in svc_data, f"{svc_name} missing 'reachable' field"
            assert "latency_ms" in svc_data, f"{svc_name} missing 'latency_ms' field"

    def test_health_endpoint_request_id_header(self, client):
        """Verify the X-Request-ID header is returned on every response."""
        resp = client.get("/api/health")
        assert "X-Request-ID" in resp.headers
        request_id = resp.headers["X-Request-ID"]
        assert len(request_id) == 12  # hex[:12]
        # Verify uniqueness across two requests
        resp2 = client.get("/api/health")
        assert resp2.headers["X-Request-ID"] != request_id
