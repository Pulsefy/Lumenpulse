"""Add daily_onchain_kpi_snapshots table

Revision ID: 008
Revises: 007
Create Date: 2026-07-24 00:00:00.000000

Persists daily snapshots of core on-chain KPIs (TVL, volume, active rounds,
contribution counts) so trend analysis is cheap and consistent.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "daily_onchain_kpi_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("snapshot_date", sa.String(length=10), nullable=False),
        sa.Column(
            "period", sa.String(length=20), nullable=False, server_default="daily"
        ),
        sa.Column("tvl", sa.Float(), nullable=False, server_default="0"),
        sa.Column("volume", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "active_rounds", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "contribution_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "unique_contributors", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("extra_data", sa.JSON(), nullable=True),
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

    # One snapshot per (date, period) — prevents duplicate runs.
    op.create_unique_constraint(
        "ux_daily_onchain_kpi_snapshots_date_period",
        "daily_onchain_kpi_snapshots",
        ["snapshot_date", "period"],
    )

    # Index for period filtering.
    op.create_index(
        "idx_daily_onchain_kpi_snapshots_period",
        "daily_onchain_kpi_snapshots",
        ["period"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_daily_onchain_kpi_snapshots_period",
        table_name="daily_onchain_kpi_snapshots",
    )
    op.drop_constraint(
        "ux_daily_onchain_kpi_snapshots_date_period",
        "daily_onchain_kpi_snapshots",
        type_="unique",
    )
    op.drop_table("daily_onchain_kpi_snapshots")
