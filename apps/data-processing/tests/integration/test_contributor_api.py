"""
Integration tests for Contributor Reputation API endpoints
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch
from datetime import datetime, timedelta
from src.api.server import app
from src.analytics.contributor_reputation import ContributorMetrics


@pytest.fixture
def client():
    """Create test client"""
    return TestClient(app)


@pytest.fixture
def api_key_header():
    """Get API key header for authenticated requests"""
    import os

    api_key = os.getenv("API_KEY", "test-api-key")
    return {"X-API-Key": api_key}


class TestContributorAPIEndpoints:
    """Test contributor reputation API endpoints"""

    def test_get_top_contributors_success(self, client, api_key_header):
        """Test successful top contributors retrieval"""
        with patch(
            "src.api.server.ContributorReputationSnapshotBuilder"
        ) as mock_builder_class:
            mock_builder = Mock()
            mock_builder.get_top_n.return_value = [
                ContributorMetrics(
                    contributor_address="GABC123",
                    total_contributions=50,
                    total_value_xlm=500.0,
                    activity_streak_days=10,
                    unique_projects=5,
                    reputation_score=95.5,
                    snapshot_date=datetime.utcnow(),
                    snapshot_metadata={"rank": 1, "percentile": 100.0},
                ),
                ContributorMetrics(
                    contributor_address="GDEF456",
                    total_contributions=30,
                    total_value_xlm=300.0,
                    activity_streak_days=7,
                    unique_projects=3,
                    reputation_score=80.0,
                    snapshot_date=datetime.utcnow(),
                    snapshot_metadata={"rank": 2, "percentile": 90.0},
                ),
            ]
            mock_builder_class.return_value = mock_builder

            response = client.get("/contributors/top?n=2", headers=api_key_header)

            assert response.status_code == 200
            data = response.json()
            assert "contributors" in data
            assert "total_count" in data
            assert data["total_count"] == 2
            assert len(data["contributors"]) == 2
            assert data["contributors"][0]["contributor_address"] == "GABC123"
            assert data["contributors"][0]["reputation_score"] == 95.5

    def test_get_top_contributors_default_n(self, client, api_key_header):
        """Test default N value (10) for top contributors"""
        with patch(
            "src.api.server.ContributorReputationSnapshotBuilder"
        ) as mock_builder_class:
            mock_builder = Mock()
            mock_builder.get_top_n.return_value = []
            mock_builder_class.return_value = mock_builder

            response = client.get("/contributors/top", headers=api_key_header)

            assert response.status_code == 200
            data = response.json()
            assert data["total_count"] == 0
            # Verify default n=10 was used
            mock_builder.get_top_n.assert_called_once()
            call_args = mock_builder.get_top_n.call_args
            assert call_args[0][0] == 10 or call_args[1].get("n", 10) == 10

    def test_get_top_contributors_invalid_n(self, client, api_key_header):
        """Test validation for invalid N values"""
        # Test n=0 (below minimum)
        response = client.get("/contributors/top?n=0", headers=api_key_header)
        assert response.status_code == 422  # Validation error

        # Test n=101 (above maximum)
        response = client.get("/contributors/top?n=101", headers=api_key_header)
        assert response.status_code == 422

    def test_get_top_contributors_error_handling(self, client, api_key_header):
        """Test error handling in top contributors endpoint"""
        with patch(
            "src.api.server.ContributorReputationSnapshotBuilder"
        ) as mock_builder_class:
            mock_builder = Mock()
            mock_builder.get_top_n.side_effect = Exception("Database connection failed")
            mock_builder_class.return_value = mock_builder

            response = client.get("/contributors/top?n=10", headers=api_key_header)

            assert response.status_code == 500
            data = response.json()
            assert "detail" in data
            assert "Database connection failed" in data["detail"]

    def test_trigger_snapshot_success(self, client, api_key_header):
        """Test manual snapshot trigger"""
        with patch(
            "src.api.server.ContributorReputationSnapshotBuilder"
        ) as mock_builder_class:
            mock_builder = Mock()
            mock_builder.run_snapshot_job.return_value = {
                "status": "completed",
                "snapshots_saved": 25,
                "top_contributor": "GABC123",
                "top_score": 95.5,
                "duration_seconds": 2.5,
                "timestamp": datetime.utcnow().isoformat(),
            }
            mock_builder_class.return_value = mock_builder

            response = client.post("/contributors/snapshot", headers=api_key_header)

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "completed"
            assert data["snapshots_saved"] == 25
            assert data["top_contributor"] == "GABC123"

    def test_trigger_snapshot_failure(self, client, api_key_header):
        """Test snapshot trigger failure"""
        with patch(
            "src.api.server.ContributorReputationSnapshotBuilder"
        ) as mock_builder_class:
            mock_builder = Mock()
            mock_builder.run_snapshot_job.return_value = {
                "status": "failed",
                "error": "Database timeout",
                "duration_seconds": 30.0,
                "timestamp": datetime.utcnow().isoformat(),
            }
            mock_builder_class.return_value = mock_builder

            response = client.post("/contributors/snapshot", headers=api_key_header)

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "failed"
            assert data["error"] == "Database timeout"

    def test_get_snapshot_schedule(self, client, api_key_header):
        """Test snapshot schedule documentation endpoint"""
        response = client.get("/contributors/snapshot/schedule", headers=api_key_header)

        assert response.status_code == 200
        data = response.json()

        assert "schedule" in data
        assert data["schedule"]["cron"] == "0 0 * * *"
        assert data["schedule"]["description"] == "Daily at 00:00 UTC"
        assert data["schedule"]["timezone"] == "UTC"

        assert "configuration" in data
        assert "data_source" in data["configuration"]
        assert "metrics_captured" in data["configuration"]
        assert len(data["configuration"]["metrics_captured"]) > 0

        assert "scoring_algorithm" in data["configuration"]
        assert "total_contributions" in data["configuration"]["scoring_algorithm"]

        assert "endpoints" in data
        assert "GET /contributors/top" in data["endpoints"]

    def test_root_endpoint_includes_contributor_endpoints(self, client):
        """Test that root endpoint documents new contributor endpoints"""
        response = client.get("/")

        assert response.status_code == 200
        data = response.json()

        assert "endpoints" in data
        assert "GET /contributors/top" in data["endpoints"]
        assert "POST /contributors/snapshot" in data["endpoints"]
        assert "GET /contributors/snapshot/schedule" in data["endpoints"]

    def test_contributor_metrics_response_format(self, client, api_key_header):
        """Test response format matches expected schema"""
        now = datetime.utcnow()
        with patch(
            "src.api.server.ContributorReputationSnapshotBuilder"
        ) as mock_builder_class:
            mock_builder = Mock()
            mock_builder.get_top_n.return_value = [
                ContributorMetrics(
                    contributor_address="GTEST123",
                    total_contributions=100,
                    total_value_xlm=1000.0,
                    first_contribution_date=now - timedelta(days=90),
                    last_contribution_date=now,
                    activity_streak_days=15,
                    unique_projects=10,
                    reputation_score=99.9,
                    snapshot_date=now,
                    snapshot_metadata={"rank": 1, "percentile": 100.0},
                )
            ]
            mock_builder_class.return_value = mock_builder

            response = client.get("/contributors/top?n=1", headers=api_key_header)

            assert response.status_code == 200
            data = response.json()

            contributor = data["contributors"][0]
            assert contributor["contributor_address"] == "GTEST123"
            assert contributor["total_contributions"] == 100
            assert contributor["total_value_xlm"] == 1000.0
            assert contributor["activity_streak_days"] == 15
            assert contributor["unique_projects"] == 10
            assert contributor["reputation_score"] == 99.9
            assert contributor["snapshot_metadata"]["rank"] == 1
            assert contributor["snapshot_metadata"]["percentile"] == 100.0


class TestContributorAPIAuthentication:
    """Test authentication for contributor endpoints"""

    def test_top_contributors_requires_api_key(self, client):
        """Test that top contributors endpoint requires API key"""
        response = client.get("/contributors/top?n=10")

        # Should fail without API key (401 or 403)
        assert response.status_code in [401, 403]

    def test_snapshot_trigger_requires_api_key(self, client):
        """Test that snapshot trigger requires API key"""
        response = client.post("/contributors/snapshot")

        # Should fail without API key
        assert response.status_code in [401, 403]

    def test_schedule_requires_api_key(self, client):
        """Test that schedule endpoint requires API key"""
        response = client.get("/contributors/snapshot/schedule")

        # Should fail without API key
        assert response.status_code in [401, 403]
