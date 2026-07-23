"""
Tests for Cohort Analyzer - Validates cohort analysis datasets and output formats
"""

import sys
from pathlib import Path

# Add parent directory to path to enable imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from datetime import datetime, timedelta
from src.analytics.cohort_analyzer import (
    CohortAnalyzer,
    CohortType,
    ContributorType,
    CohortDefinition,
    CohortMetrics,
    RetentionMetrics,
    RepeatContributorMetrics,
    create_cohort_analyzer,
)
from src.db.postgres_service import PostgresService
from src.db.cohort_models import (
    GrantRound,
    ContributorRoundParticipation,
    ContributorCohort,
    CohortRetentionSummary,
    RepeatContributorSummary,
)


class TestCohortAnalyzer:
    """Test suite for CohortAnalyzer functionality"""
    
    @pytest.fixture
    def db_service(self):
        """Create a test database service backed by in-memory SQLite"""
        db = PostgresService(database_url="sqlite:///:memory:")
        db.create_tables()
        yield db
        db.drop_tables()
    
    @pytest.fixture
    def analyzer(self, db_service):
        """Create a cohort analyzer instance"""
        return CohortAnalyzer(db_service=db_service)
    
    @pytest.fixture
    def sample_rounds(self, db_service):
        """Create sample grant rounds for testing"""
        rounds = [
            GrantRound(
                id=1,
                name="Round 1",
                start_time=datetime(2026, 1, 1),
                end_time=datetime(2026, 1, 31),
                status="completed",
                total_pool=100000.0,
                total_contributions=50000.0,
                unique_contributors=50,
                unique_projects=10,
            ),
            GrantRound(
                id=2,
                name="Round 2",
                start_time=datetime(2026, 2, 1),
                end_time=datetime(2026, 2, 28),
                status="completed",
                total_pool=100000.0,
                total_contributions=60000.0,
                unique_contributors=60,
                unique_projects=12,
            ),
            GrantRound(
                id=3,
                name="Round 3",
                start_time=datetime(2026, 3, 1),
                end_time=datetime(2026, 3, 31),
                status="active",
                total_pool=100000.0,
                total_contributions=40000.0,
                unique_contributors=40,
                unique_projects=8,
            ),
        ]
        
        with db_service.get_session() as session:
            for round_data in rounds:
                session.add(round_data)
            session.flush()
        
        return rounds
    
    @pytest.fixture
    def sample_contributions(self):
        """Create sample contribution data"""
        return [
            # Round 1 contributions
            {"contributor": "0xAAA1", "amount": 100.0, "project_id": 1, "timestamp": datetime(2026, 1, 5)},
            {"contributor": "0xAAA1", "amount": 50.0, "project_id": 2, "timestamp": datetime(2026, 1, 10)},
            {"contributor": "0xBBB2", "amount": 200.0, "project_id": 1, "timestamp": datetime(2026, 1, 7)},
            {"contributor": "0xCCC3", "amount": 150.0, "project_id": 3, "timestamp": datetime(2026, 1, 15)},
            {"contributor": "0xDDD4", "amount": 75.0, "project_id": 2, "timestamp": datetime(2026, 1, 20)},
            # Round 2 contributions (some repeat, some new)
            {"contributor": "0xAAA1", "amount": 120.0, "project_id": 1, "timestamp": datetime(2026, 2, 5)},
            {"contributor": "0xBBB2", "amount": 180.0, "project_id": 4, "timestamp": datetime(2026, 2, 8)},
            {"contributor": "0xEEE5", "amount": 250.0, "project_id": 1, "timestamp": datetime(2026, 2, 12)},
            {"contributor": "0xFFF6", "amount": 100.0, "project_id": 5, "timestamp": datetime(2026, 2, 18)},
            # Round 3 contributions
            {"contributor": "0xAAA1", "amount": 80.0, "project_id": 2, "timestamp": datetime(2026, 3, 5)},
            {"contributor": "0xCCC3", "amount": 200.0, "project_id": 3, "timestamp": datetime(2026, 3, 10)},
            {"contributor": "0xEEE5", "amount": 150.0, "project_id": 4, "timestamp": datetime(2026, 3, 15)},
        ]
    
    def test_track_round_participation(self, analyzer, sample_contributions):
        """Test tracking contributor participation for a round"""
        # Track round 1 contributions
        round1_contributions = [c for c in sample_contributions if c["timestamp"].month == 1]
        saved_count = analyzer.track_round_participation(round_id=1, contributions=round1_contributions)
        
        assert saved_count == 4  # 4 unique contributors in round 1
        
        # Verify data was saved
        with analyzer.db_service.get_session() as session:
            participations = session.execute(
                session.query(ContributorRoundParticipation).filter(
                    ContributorRoundParticipation.round_id == 1
                )
            ).scalars().all()
            
            assert len(participations) == 4
            
            # Check specific contributor
            aaa1 = next(p for p in participations if p.contributor == "0xAAA1")
            assert aaa1.total_contributed == 150.0  # 100 + 50
            assert aaa1.projects_supported == 2
            assert aaa1.contribution_count == 2
    
    def test_create_first_round_cohort(self, analyzer, sample_contributions, sample_rounds):
        """Test creating a first-round cohort"""
        # Track participation for round 1
        round1_contributions = [c for c in sample_contributions if c["timestamp"].month == 1]
        analyzer.track_round_participation(round_id=1, contributions=round1_contributions)
        
        # Create first-round cohort
        cohort_metrics = analyzer.create_first_round_cohort(round_id=1)
        
        assert cohort_metrics.cohort_id == "first_round_1"
        assert cohort_metrics.member_count == 4
        assert cohort_metrics.total_contributed == 575.0  # 100+50+200+150+75
        assert len(cohort_metrics.members) == 4
        
        # Verify cohort was saved
        with analyzer.db_service.get_session() as session:
            cohort = session.execute(
                session.query(ContributorCohort).filter(
                    ContributorCohort.cohort_id == "first_round_1"
                )
            ).scalar_one_or_none()
            
            assert cohort is not None
            assert cohort.cohort_type == CohortType.FIRST_ROUND.value
            assert cohort.member_count == 4
    
    def test_calculate_retention(self, analyzer, sample_contributions, sample_rounds):
        """Test calculating retention metrics"""
        # Track participation for rounds 1 and 2
        round1_contributions = [c for c in sample_contributions if c["timestamp"].month == 1]
        round2_contributions = [c for c in sample_contributions if c["timestamp"].month == 2]
        
        analyzer.track_round_participation(round_id=1, contributions=round1_contributions)
        analyzer.track_round_participation(round_id=2, contributions=round2_contributions)
        
        # Create first-round cohort
        analyzer.create_first_round_cohort(round_id=1)
        
        # Calculate retention for round 2
        retention_metrics = analyzer.calculate_retention(
            cohort_id="first_round_1",
            round_id=2
        )
        
        assert retention_metrics.cohort_id == "first_round_1"
        assert retention_metrics.round_id == 2
        assert retention_metrics.cohort_size == 4
        # 0xAAA1 and 0xBBB2 participated in both rounds
        assert retention_metrics.retained_contributors == 2
        assert retention_metrics.retention_rate == 0.5  # 2/4
        
        # Verify retention summary was saved
        with analyzer.db_service.get_session() as session:
            summary = session.execute(
                session.query(CohortRetentionSummary).filter(
                    CohortRetentionSummary.cohort_id == "first_round_1",
                    CohortRetentionSummary.round_id == 2
                )
            ).scalar_one_or_none()
            
            assert summary is not None
            assert summary.retention_rate == 0.5
    
    def test_analyze_repeat_contributors(self, analyzer, sample_contributions, sample_rounds):
        """Test analyzing repeat contributors"""
        # Track participation for all rounds
        for round_id in [1, 2, 3]:
            round_contributions = [c for c in sample_contributions if c["timestamp"].month == round_id]
            analyzer.track_round_participation(round_id=round_id, contributions=round_contributions)
        
        # Analyze repeat contributors
        repeat_contributors = analyzer.analyze_repeat_contributors(min_rounds=2)
        
        # 0xAAA1 participated in all 3 rounds, 0xBBB2 in 2 rounds, 0xCCC3 in 2 rounds, 0xEEE5 in 2 rounds
        assert len(repeat_contributors) == 4
        
        # Check 0xAAA1 (super contributor - 3 rounds)
        aaa1 = next(c for c in repeat_contributors if c.contributor == "0xAAA1")
        assert aaa1.rounds_participated == 3
        assert aaa1.contributor_type == ContributorType.REPEAT  # 3 rounds but < 6
        assert aaa1.total_contributed_all_rounds == 350.0  # 150 + 120 + 80
        
        # Check 0xBBB2 (repeat contributor - 2 rounds)
        bbb2 = next(c for c in repeat_contributors if c.contributor == "0xBBB2")
        assert bbb2.rounds_participated == 2
        assert bbb2.contributor_type == ContributorType.REPEAT
        
        # Verify summaries were saved
        with analyzer.db_service.get_session() as session:
            summaries = session.execute(
                session.query(RepeatContributorSummary)
            ).scalars().all()
            
            assert len(summaries) >= 4
    
    def test_create_time_window_cohort(self, analyzer, sample_contributions, sample_rounds):
        """Test creating a time-window cohort"""
        # Track participation for all rounds
        for round_id in [1, 2, 3]:
            round_contributions = [c for c in sample_contributions if c["timestamp"].month == round_id]
            analyzer.track_round_participation(round_id=round_id, contributions=round_contributions)
        
        # Create Q1 2026 cohort
        cohort_metrics = analyzer.create_time_window_cohort(
            window_start=datetime(2026, 1, 1),
            window_end=datetime(2026, 3, 31)
        )
        
        assert cohort_metrics.member_count > 0
        assert "time_window" in cohort_metrics.cohort_id
        
        # Verify cohort was saved
        with analyzer.db_service.get_session() as session:
            cohort = session.execute(
                session.query(ContributorCohort).filter(
                    ContributorCohort.cohort_type == CohortType.TIME_WINDOW.value
                )
            ).scalar_one_or_none()
            
            assert cohort is not None
    
    def test_get_cohort_retention_timeline(self, analyzer, sample_contributions, sample_rounds):
        """Test getting retention timeline for a cohort"""
        # Track participation for all rounds
        for round_id in [1, 2, 3]:
            round_contributions = [c for c in sample_contributions if c["timestamp"].month == round_id]
            analyzer.track_round_participation(round_id=round_id, contributions=round_contributions)
        
        # Create first-round cohort
        analyzer.create_first_round_cohort(round_id=1)
        
        # Calculate retention for subsequent rounds
        analyzer.calculate_retention(cohort_id="first_round_1", round_id=2)
        analyzer.calculate_retention(cohort_id="first_round_1", round_id=3)
        
        # Get retention timeline
        timeline = analyzer.get_cohort_retention_timeline(cohort_id="first_round_1")
        
        assert len(timeline) == 2
        assert timeline[0]["round_id"] == 2
        assert timeline[1]["round_id"] == 3
        
        # Verify timeline structure
        for data in timeline:
            assert "round_id" in data
            assert "cohort_size" in data
            assert "retained_contributors" in data
            assert "retention_rate" in data
            assert "calculated_at" in data
    
    def test_contributor_classification(self, analyzer):
        """Test contributor classification logic"""
        # Test one-time contributor
        type_1 = analyzer._classify_contributor(rounds_participated=1, total_contributed=100)
        assert type_1 == ContributorType.ONE_TIME
        
        # Test repeat contributor
        type_2 = analyzer._classify_contributor(rounds_participated=3, total_contributed=500)
        assert type_2 == ContributorType.REPEAT
        
        # Test super contributor (6+ rounds)
        type_3 = analyzer._classify_contributor(rounds_participated=6, total_contributed=1000)
        assert type_3 == ContributorType.SUPER_CONTRIBUTOR
        
        # Test super contributor (high total)
        type_4 = analyzer._classify_contributor(rounds_participated=3, total_contributed=15000)
        assert type_4 == ContributorType.SUPER_CONTRIBUTOR
    
    def test_output_format_validation(self, analyzer, sample_contributions, sample_rounds):
        """Test that output formats match backend/dashboard consumption requirements"""
        # Track participation
        round1_contributions = [c for c in sample_contributions if c["timestamp"].month == 1]
        analyzer.track_round_participation(round_id=1, contributions=round1_contributions)
        
        # Test cohort metrics output format
        cohort_metrics = analyzer.create_first_round_cohort(round_id=1)
        cohort_dict = cohort_metrics.to_dict()
        
        required_cohort_fields = [
            "cohort_id", "member_count", "members", 
            "total_contributed", "avg_contributed_per_member"
        ]
        for field in required_cohort_fields:
            assert field in cohort_dict
        
        # Test retention metrics output format
        analyzer.track_round_participation(round_id=2, contributions=sample_contributions)
        retention_metrics = analyzer.calculate_retention(
            cohort_id="first_round_1",
            round_id=2
        )
        retention_dict = retention_metrics.to_dict()
        
        required_retention_fields = [
            "cohort_id", "round_id", "cohort_size", "retained_contributors",
            "retention_rate", "retained_total_contributed", 
            "avg_retained_contribution", "new_contributors"
        ]
        for field in required_retention_fields:
            assert field in retention_dict
        
        # Test repeat contributor metrics output format
        repeat_contributors = analyzer.analyze_repeat_contributors(min_rounds=2)
        if repeat_contributors:
            contributor_dict = repeat_contributors[0].to_dict()
            
            required_contributor_fields = [
                "contributor", "rounds_participated", "first_round_id", "last_round_id",
                "total_contributed_all_rounds", "avg_contributed_per_round",
                "total_projects_supported", "unique_projects_supported",
                "contributor_type", "round_ids"
            ]
            for field in required_contributor_fields:
                assert field in contributor_dict


class TestCohortDataStructures:
    """Test cohort data structures and serialization"""
    
    def test_cohort_definition_to_dict(self):
        """Test CohortDefinition serialization"""
        definition = CohortDefinition(
            cohort_id="test_cohort",
            cohort_type=CohortType.FIRST_ROUND,
            window_start=datetime(2026, 1, 1),
            window_end=datetime(2026, 1, 31),
            description="Test cohort"
        )
        
        data = definition.to_dict()
        
        assert data["cohort_id"] == "test_cohort"
        assert data["cohort_type"] == "first_round"
        assert "window_start" in data
        assert "window_end" in data
    
    def test_cohort_metrics_to_dict(self):
        """Test CohortMetrics serialization"""
        metrics = CohortMetrics(
            cohort_id="test_cohort",
            member_count=10,
            members=["0xAAA", "0xBBB"],
            total_contributed=1000.0,
            avg_contributed_per_member=100.0
        )
        
        data = metrics.to_dict()
        
        assert data["cohort_id"] == "test_cohort"
        assert data["member_count"] == 10
        assert len(data["members"]) == 2
        assert data["total_contributed"] == 1000.0
    
    def test_retention_metrics_to_dict(self):
        """Test RetentionMetrics serialization"""
        metrics = RetentionMetrics(
            cohort_id="test_cohort",
            round_id=2,
            cohort_size=10,
            retained_contributors=5,
            retention_rate=0.5,
            retained_total_contributed=500.0,
            avg_retained_contribution=100.0,
            new_contributors=3
        )
        
        data = metrics.to_dict()
        
        assert data["cohort_id"] == "test_cohort"
        assert data["round_id"] == 2
        assert data["retention_rate"] == 0.5
        assert data["retained_contributors"] == 5
    
    def test_repeat_contributor_metrics_to_dict(self):
        """Test RepeatContributorMetrics serialization"""
        metrics = RepeatContributorMetrics(
            contributor="0xAAA",
            rounds_participated=3,
            first_round_id=1,
            last_round_id=3,
            total_contributed_all_rounds=300.0,
            avg_contributed_per_round=100.0,
            total_projects_supported=5,
            unique_projects_supported=4,
            contributor_type=ContributorType.REPEAT,
            round_ids=[1, 2, 3],
            first_contribution_at=datetime(2026, 1, 1),
            last_contribution_at=datetime(2026, 3, 31)
        )
        
        data = metrics.to_dict()
        
        assert data["contributor"] == "0xAAA"
        assert data["rounds_participated"] == 3
        assert data["contributor_type"] == "repeat"
        assert len(data["round_ids"]) == 3
        assert "first_contribution_at" in data
        assert "last_contribution_at" in data


def test_create_cohort_analyzer_factory():
    """Test the factory function"""
    analyzer = create_cohort_analyzer()
    assert isinstance(analyzer, CohortAnalyzer)
    
    db_service = PostgresService()
    analyzer_with_db = create_cohort_analyzer(db_service=db_service)
    assert analyzer_with_db.db_service == db_service


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])
