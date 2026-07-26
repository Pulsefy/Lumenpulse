"""Add narrative_attribution_scores table

Revision ID: 006
Revises: 005
Create Date: 2026-07-23 00:00:00.000000

Stores the output of the AttributionScorer for each (article, target) pair
produced by the data-processing pipeline.  Results can be joined to
contributor or project views via ``target_id`` + ``target_type``.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "narrative_attribution_scores",
        # --------------- primary key -----------------------------------
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        # --------------- article reference -----------------------------
        # Soft-reference (no FK) so the table survives article pruning.
        sa.Column("article_id", sa.String(length=255), nullable=False),
        # --------------- target reference ------------------------------
        # target_id  = Stellar address for contributors, project_id str for projects.
        # target_type = "contributor" | "project"
        sa.Column("target_id", sa.String(length=255), nullable=False),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        # --------------- score & confidence ----------------------------
        # score in [0.0, 1.0]; confidence_tier in {high, medium, low, very_low}
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column(
            "confidence_tier",
            sa.String(length=20),
            nullable=False,
            server_default="very_low",
        ),
        sa.Column(
            "low_confidence",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        # --------------- explainability payload -----------------------
        # Full JSON breakdown: list of SignalBreakdown dicts for tuning.
        sa.Column("signals", sa.JSON(), nullable=True),
        # --------------- provenance -----------------------------------
        sa.Column(
            "scorer_version",
            sa.String(length=50),
            nullable=False,
            server_default="attribution_scorer_v1",
        ),
        # --------------- timestamps -----------------------------------
        sa.Column(
            "scored_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Unique constraint: one score per (article, target) pair — upsert-friendly.
    op.create_index(
        "ux_narrative_attribution_article_target",
        "narrative_attribution_scores",
        ["article_id", "target_id", "target_type"],
        unique=True,
    )

    # Fast look-up by target (for contributor / project view joins).
    op.create_index(
        "idx_narrative_attribution_target",
        "narrative_attribution_scores",
        ["target_id", "target_type"],
    )

    # Range scan on score for top-N queries.
    op.create_index(
        "idx_narrative_attribution_score",
        "narrative_attribution_scores",
        ["score"],
    )

    # Filter by confidence tier to skip low-signal results.
    op.create_index(
        "idx_narrative_attribution_confidence_tier",
        "narrative_attribution_scores",
        ["confidence_tier"],
    )

    # Time-ordered scans for trend windows.
    op.create_index(
        "idx_narrative_attribution_scored_at",
        "narrative_attribution_scores",
        ["scored_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_narrative_attribution_scored_at",
        table_name="narrative_attribution_scores",
    )
    op.drop_index(
        "idx_narrative_attribution_confidence_tier",
        table_name="narrative_attribution_scores",
    )
    op.drop_index(
        "idx_narrative_attribution_score",
        table_name="narrative_attribution_scores",
    )
    op.drop_index(
        "idx_narrative_attribution_target",
        table_name="narrative_attribution_scores",
    )
    op.drop_index(
        "ux_narrative_attribution_article_target",
        table_name="narrative_attribution_scores",
    )
    op.drop_table("narrative_attribution_scores")
