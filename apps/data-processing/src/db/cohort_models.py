"""
Cohort analysis models for grant round contributor tracking
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, BigInteger, Index
from sqlalchemy.sql import func

from .models import Base


class GrantRound(Base):
    """
    Stores metadata for quadratic funding grant rounds
    """

    __tablename__ = "grant_rounds"

    id = Column(BigInteger, primary_key=True, autoincrement=False)  # Round ID from chain
    name = Column(String(255), nullable=True)
    description = Column(String(1000), nullable=True)
    
    # Round timing
    start_time = Column(DateTime(timezone=True), nullable=False, index=True)
    end_time = Column(DateTime(timezone=True), nullable=False, index=True)
    
    # Round metrics
    total_pool = Column(Float, nullable=True)
    total_contributions = Column(Float, nullable=True)
    unique_contributors = Column(Integer, nullable=True)
    unique_projects = Column(Integer, nullable=True)
    
    # Round status
    status = Column(String(50), nullable=False, default="active", index=True)  # active, completed, cancelled
    
    # Additional metadata
    extra_data = Column(JSON, nullable=True)
    
    # Timestamps
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_grant_rounds_start_time", "start_time"),
        Index("idx_grant_rounds_end_time", "end_time"),
        Index("idx_grant_rounds_status", "status"),
    )

    def __repr__(self):
        return f"<GrantRound(id={self.id}, name={self.name}, status={self.status})>"


class ContributorRoundParticipation(Base):
    """
    Tracks individual contributor participation in each round
    """

    __tablename__ = "contributor_round_participation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    round_id = Column(BigInteger, nullable=False, index=True)
    contributor = Column(String(255), nullable=False, index=True)
    
    # Participation metrics
    total_contributed = Column(Float, nullable=False, default=0.0)
    projects_supported = Column(Integer, nullable=False, default=0)
    contribution_count = Column(Integer, nullable=False, default=0)
    
    # First and last contribution in round
    first_contribution_at = Column(DateTime(timezone=True), nullable=True)
    last_contribution_at = Column(DateTime(timezone=True), nullable=True)
    
    # Project IDs supported (for analysis)
    project_ids = Column(JSON, nullable=True)  # Array of project IDs
    
    # Timestamps
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ux_contributor_round_participation_round_contributor",
            "round_id",
            "contributor",
            unique=True,
        ),
        Index("idx_contributor_round_participation_contributor", "contributor"),
    )

    def __repr__(self):
        return (
            f"<ContributorRoundParticipation(round_id={self.round_id}, "
            f"contributor={self.contributor}, total={self.total_contributed})>"
        )


class ContributorCohort(Base):
    """
    Stores cohort definitions and summaries for time-windowed analysis
    """

    __tablename__ = "contributor_cohorts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cohort_id = Column(String(255), nullable=False, unique=True, index=True)
    
    # Cohort definition
    cohort_type = Column(String(50), nullable=False, index=True)  # first_round, time_window, etc.
    definition_window_start = Column(DateTime(timezone=True), nullable=False)
    definition_window_end = Column(DateTime(timezone=True), nullable=False)
    
    # Cohort members
    member_count = Column(Integer, nullable=False, default=0)
    members = Column(JSON, nullable=True)  # Array of contributor addresses
    
    # Cohort metrics
    total_contributed = Column(Float, nullable=True)
    avg_contributed_per_member = Column(Float, nullable=True)
    
    # Timestamps
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_contributor_cohorts_type", "cohort_type"),
        Index("idx_contributor_cohorts_window", "definition_window_start", "definition_window_end"),
    )

    def __repr__(self):
        return (
            f"<ContributorCohort(cohort_id={self.cohort_id}, type={self.cohort_type}, "
            f"members={self.member_count})>"
        )


class CohortRetentionSummary(Base):
    """
    Stores retention metrics for cohorts across subsequent rounds
    """

    __tablename__ = "cohort_retention_summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cohort_id = Column(String(255), nullable=False, index=True)
    round_id = Column(BigInteger, nullable=False, index=True)
    
    # Retention metrics
    cohort_size = Column(Integer, nullable=False)
    retained_contributors = Column(Integer, nullable=False)
    retention_rate = Column(Float, nullable=False)
    
    # Contribution metrics for retained contributors
    retained_total_contributed = Column(Float, nullable=True)
    avg_retained_contribution = Column(Float, nullable=True)
    
    # New contributors in this round (not in cohort)
    new_contributors = Column(Integer, nullable=True)
    
    # Timestamps
    calculated_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ux_cohort_retention_cohort_round",
            "cohort_id",
            "round_id",
            unique=True,
        ),
        Index("idx_cohort_retention_calculated_at", "calculated_at"),
    )

    def __repr__(self):
        return (
            f"<CohortRetentionSummary(cohort_id={self.cohort_id}, round_id={self.round_id}, "
            f"retention_rate={self.retention_rate:.2%})>"
        )


class RepeatContributorSummary(Base):
    """
    Stores aggregated metrics for repeat contributors across rounds
    """

    __tablename__ = "repeat_contributor_summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contributor = Column(String(255), nullable=False, unique=True, index=True)
    
    # Participation metrics
    rounds_participated = Column(Integer, nullable=False, default=0)
    first_round_id = Column(BigInteger, nullable=True)
    last_round_id = Column(BigInteger, nullable=True)
    
    # Contribution metrics
    total_contributed_all_rounds = Column(Float, nullable=False, default=0.0)
    avg_contributed_per_round = Column(Float, nullable=True)
    
    # Project diversity
    total_projects_supported = Column(Integer, nullable=False, default=0)
    unique_projects_supported = Column(Integer, nullable=False, default=0)
    
    # Classification
    contributor_type = Column(String(50), nullable=True, index=True)  # one_time, repeat, super_contributor
    
    # Round participation history
    round_ids = Column(JSON, nullable=True)  # Array of round IDs participated
    
    # Timestamps
    first_contribution_at = Column(DateTime(timezone=True), nullable=True)
    last_contribution_at = Column(DateTime(timezone=True), nullable=True)
    calculated_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_repeat_contributor_type", "contributor_type"),
        Index("idx_repeat_contributor_rounds", "rounds_participated"),
    )

    def __repr__(self):
        return (
            f"<RepeatContributorSummary(contributor={self.contributor}, "
            f"rounds={self.rounds_participated}, type={self.contributor_type})>"
        )
