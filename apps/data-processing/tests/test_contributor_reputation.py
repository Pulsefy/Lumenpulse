"""
Tests for Contributor Reputation Snapshot Builder
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
from src.analytics.contributor_reputation import (
    ContributorReputationSnapshotBuilder,
    ContributorMetrics,
)


class TestContributorMetrics:
    """Test ContributorMetrics dataclass"""

    def test_to_dict(self):
        """Test conversion to dictionary"""
        now = datetime.utcnow()
        metrics = ContributorMetrics(
            contributor_address="GABC123",
            total_contributions=10,
            total_value_xlm=100.5,
            first_contribution_date=now - timedelta(days=30),
            last_contribution_date=now,
            activity_streak_days=5,
            unique_projects=3,
            reputation_score=85.5,
            snapshot_date=now,
            snapshot_metadata={"rank": 1, "percentile": 100.0},
        )

        result = metrics.to_dict()

        assert result["contributor_address"] == "GABC123"
        assert result["total_contributions"] == 10
        assert result["total_value_xlm"] == 100.5
        assert result["activity_streak_days"] == 5
        assert result["reputation_score"] == 85.5
        assert result["snapshot_metadata"]["rank"] == 1

    def test_default_values(self):
        """Test default values for optional fields"""
        metrics = ContributorMetrics(contributor_address="GABC123")

        assert metrics.total_contributions == 0
        assert metrics.total_value_xlm == 0.0
        assert metrics.activity_streak_days == 0
        assert metrics.reputation_score == 0.0
        assert metrics.snapshot_metadata == {}


class TestContributorReputationSnapshotBuilder:
    """Test ContributorReputationSnapshotBuilder"""

    @pytest.fixture
    def builder(self):
        """Create a builder with mock session"""
        mock_session = Mock()
        return ContributorReputationSnapshotBuilder(db_session=mock_session)

    def test_calculate_activity_streak_empty(self, builder):
        """Test activity streak calculation with no timestamps"""
        streak = builder._calculate_activity_streak([], datetime.utcnow())
        assert streak == 0

    def test_calculate_activity_streak_single_day(self, builder):
        """Test activity streak with single day"""
        now = datetime.utcnow()
        timestamps = [now]
        streak = builder._calculate_activity_streak(timestamps, now)
        assert streak == 1

    def test_calculate_activity_streak_consecutive_days(self, builder):
        """Test activity streak with consecutive days"""
        now = datetime.utcnow()
        timestamps = [
            now - timedelta(days=2),
            now - timedelta(days=1),
            now,
        ]
        streak = builder._calculate_activity_streak(timestamps, now)
        assert streak == 3

    def test_calculate_activity_streak_with_gaps(self, builder):
        """Test activity streak breaks on gaps"""
        now = datetime.utcnow()
        timestamps = [
            now - timedelta(days=10),
            now - timedelta(days=1),
            now,
        ]
        streak = builder._calculate_activity_streak(timestamps, now)
        # Should only count the last 2 consecutive days
        assert streak == 2

    def test_calculate_metrics(self, builder):
        """Test metrics calculation for a contributor"""
        now = datetime.utcnow()
        address = "GABC123"
        data = {
            "contributions": [
                {"timestamp": now - timedelta(days=1), "value_xlm": 10.0},
                {"timestamp": now, "value_xlm": 20.0},
            ],
            "total_value": 30.0,
            "projects": {"project_1", "project_2"},
            "timestamps": [now - timedelta(days=1), now],
        }

        metrics = builder._calculate_metrics(address, data, now)

        assert metrics.contributor_address == address
        assert metrics.total_contributions == 2
        assert metrics.total_value_xlm == 30.0
        assert metrics.unique_projects == 2
        assert metrics.activity_streak_days == 2

    def test_calculate_reputation_scores_empty(self, builder):
        """Test reputation scoring with empty list"""
        result = builder._calculate_reputation_scores([])
        assert result == []

    def test_calculate_reputation_scores_single(self, builder):
        """Test reputation scoring with single contributor"""
        snapshots = [
            ContributorMetrics(
                contributor_address="GABC123",
                total_contributions=10,
                total_value_xlm=100.0,
                activity_streak_days=5,
                unique_projects=3,
            )
        ]

        result = builder._calculate_reputation_scores(snapshots)

        assert len(result) == 1
        assert result[0].reputation_score > 0
        assert result[0].reputation_score <= 100

    def test_calculate_reputation_scores_ranking(self, builder):
        """Test reputation scoring produces correct ranking"""
        snapshots = [
            ContributorMetrics(
                contributor_address="GLOW",
                total_contributions=5,
                total_value_xlm=50.0,
                activity_streak_days=2,
                unique_projects=1,
            ),
            ContributorMetrics(
                contributor_address="GHIGH",
                total_contributions=20,
                total_value_xlm=200.0,
                activity_streak_days=10,
                unique_projects=5,
            ),
        ]

        result = builder._calculate_reputation_scores(snapshots)

        # GHIGH should have higher score and be first
        assert result[0].contributor_address == "GHIGH"
        assert result[0].reputation_score > result[1].reputation_score

    def test_calculate_percentiles(self, builder):
        """Test percentile calculation"""
        snapshots = [
            ContributorMetrics(
                contributor_address=f"G{i}", reputation_score=100 - i * 10
            )
            for i in range(10)
        ]

        result = builder._calculate_percentiles(snapshots)

        # First should be 100th percentile (rank 1)
        assert result[0].snapshot_metadata["rank"] == 1
        assert result[0].snapshot_metadata["percentile"] == 90.0

        # Last should be 0th percentile
        assert result[-1].snapshot_metadata["rank"] == 10
        assert result[-1].snapshot_metadata["percentile"] == 0.0

    def test_generate_mock_contributor_data(self, builder):
        """Test mock data generation"""
        now = datetime.utcnow()
        data = builder._generate_mock_contributor_data(now)

        assert len(data) >= 20
        assert len(data) <= 50

        # Check structure of first contributor
        first_address = list(data.keys())[0]
        first_data = data[first_address]

        assert "contributions" in first_data
        assert "total_value" in first_data
        assert "projects" in first_data
        assert "timestamps" in first_data
        assert len(first_data["contributions"]) > 0

    @patch("src.analytics.contributor_reputation.AnalyticsRecord")
    def test_fetch_contributor_data_no_events_uses_mock(self, mock_record, builder):
        """Test that mock data is generated when no events exist"""
        builder.db_session.query.return_value.filter.return_value.order_by.return_value.all.return_value = (
            []
        )

        now = datetime.utcnow()
        data = builder._fetch_contributor_data(builder.db_session, now)

        # Should fall back to mock data
        assert len(data) >= 20

    def test_build_snapshot(self, builder):
        """Test complete snapshot building"""
        now = datetime.utcnow()

        # Mock the fetch to return some data
        with patch.object(builder, "_fetch_contributor_data") as mock_fetch:
            mock_fetch.return_value = {
                "GABC123": {
                    "contributions": [{"timestamp": now, "value_xlm": 10.0}],
                    "total_value": 10.0,
                    "projects": {"project_1"},
                    "timestamps": [now],
                }
            }

            snapshots = builder.build_snapshot(now)

            assert len(snapshots) == 1
            assert snapshots[0].contributor_address == "GABC123"
            assert snapshots[0].reputation_score >= 0

    def test_get_top_n(self, builder):
        """Test getting top N contributors"""
        now = datetime.utcnow()

        with patch.object(builder, "build_snapshot") as mock_build:
            mock_build.return_value = [
                ContributorMetrics(
                    contributor_address=f"G{i}",
                    reputation_score=100 - i * 10,
                )
                for i in range(20)
            ]

            top_5 = builder.get_top_n(5, now)

            assert len(top_5) == 5
            # Should be sorted by reputation score
            assert top_5[0].reputation_score > top_5[1].reputation_score

    def test_run_snapshot_job_success(self, builder):
        """Test successful snapshot job execution"""
        with (
            patch.object(builder, "build_snapshot") as mock_build,
            patch.object(builder, "save_snapshots") as mock_save,
        ):

            mock_build.return_value = [
                ContributorMetrics(
                    contributor_address="GABC123",
                    reputation_score=85.0,
                )
            ]
            mock_save.return_value = 1

            result = builder.run_snapshot_job()

            assert result["status"] == "completed"
            assert result["snapshots_saved"] == 1
            assert "duration_seconds" in result

    def test_run_snapshot_job_no_data(self, builder):
        """Test snapshot job with no data"""
        with patch.object(builder, "build_snapshot") as mock_build:
            mock_build.return_value = []

            result = builder.run_snapshot_job()

            assert result["status"] == "completed_no_data"
            assert result["snapshots_saved"] == 0

    def test_run_snapshot_job_failure(self, builder):
        """Test snapshot job failure handling"""
        with patch.object(builder, "build_snapshot") as mock_build:
            mock_build.side_effect = Exception("Database error")

            result = builder.run_snapshot_job()

            assert result["status"] == "failed"
            assert "error" in result
            assert "Database error" in result["error"]

    def test_save_snapshots(self, builder):
        """Test saving snapshots to database"""
        now = datetime.utcnow()
        snapshots = [
            ContributorMetrics(
                contributor_address="GABC123",
                total_contributions=10,
                total_value_xlm=100.0,
                activity_streak_days=5,
                unique_projects=3,
                reputation_score=85.0,
                snapshot_date=now,
            )
        ]

        # Mock the session
        mock_session = builder.db_session
        mock_session.query.return_value.filter.return_value.first.return_value = None

        with patch(
            "src.analytics.contributor_reputation.ContributorReputationSnapshot"
        ):
            saved_count = builder.save_snapshots(snapshots)

            assert saved_count == 1
            mock_session.add.assert_called_once()
            mock_session.commit.assert_called_once()


class TestContributorReputationIntegration:
    """Integration tests for contributor reputation system"""

    def test_full_snapshot_workflow(self):
        """Test complete workflow from build to save"""
        mock_session = Mock()
        builder = ContributorReputationSnapshotBuilder(db_session=mock_session)

        now = datetime.utcnow()

        # Mock database query to return empty (trigger mock data)
        mock_session.query.return_value.filter.return_value.order_by.return_value.all.return_value = (
            []
        )

        # Build snapshot
        with patch.object(builder, "_generate_mock_contributor_data") as mock_gen:
            mock_gen.return_value = {
                "GABC123": {
                    "contributions": [{"timestamp": now, "value_xlm": 50.0}],
                    "total_value": 50.0,
                    "projects": {"project_1", "project_2"},
                    "timestamps": [now],
                }
            }

            snapshots = builder.build_snapshot(now)

            assert len(snapshots) > 0
            assert snapshots[0].reputation_score > 0
            assert "rank" in snapshots[0].snapshot_metadata
            assert "percentile" in snapshots[0].snapshot_metadata

    def test_top_n_sorted_correctly(self):
        """Test that top-N returns contributors sorted by score"""
        mock_session = Mock()
        builder = ContributorReputationSnapshotBuilder(db_session=mock_session)

        now = datetime.utcnow()

        with patch.object(builder, "_fetch_contributor_data") as mock_fetch:
            mock_fetch.return_value = {
                f"G{i}": {
                    "contributions": [{"timestamp": now, "value_xlm": float(i * 10)}],
                    "total_value": float(i * 10),
                    "projects": {f"project_{i}"},
                    "timestamps": [now],
                }
                for i in range(1, 11)
            }

            top_5 = builder.get_top_n(5, now)

            assert len(top_5) == 5
            # Verify descending order
            for i in range(len(top_5) - 1):
                assert top_5[i].reputation_score >= top_5[i + 1].reputation_score
