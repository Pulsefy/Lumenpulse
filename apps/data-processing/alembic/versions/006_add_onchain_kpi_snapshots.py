"""Add onchain_kpi_snapshots table

Revision ID: 006
Revises: 005
Create Date: 2026-06-28 00:00:00.000000

Schema
------
onchain_kpi_snapshots captures one row per calendar day with:
  period_date       VARCHAR(10)  – YYYY-MM-DD, unique (prevents duplicate snapshots)
  tvl_xlm           FLOAT        – total value locked (XLM)
  volume_xlm        FLOAT        – 24-h on-chain volume (XLM)
  active_rounds     INTEGER      – active quadratic-funding rounds
  contribution_count INTEGER     – contribution events for the period
  extra_data        JSON         – forward-compatible KPI extension field
  captured_at       TIMESTAMPTZ  – snapshot capture wall-clock time
  created_at        TIMESTAMPTZ  – row insertion time
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "onchain_kpi_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("period_date", sa.String(length=10), nullable=False),
        sa.Column("tvl_xlm", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("volume_xlm", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("active_rounds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("contribution_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extra_data", sa.JSON(), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period_date", name="uq_onchain_kpi_snapshots_period_date"),
    )
    op.create_index(
        "idx_onchain_kpi_snapshots_period_date",
        "onchain_kpi_snapshots",
        ["period_date"],
    )


def downgrade() -> None:
    op.drop_index("idx_onchain_kpi_snapshots_period_date", table_name="onchain_kpi_snapshots")
    op.drop_table("onchain_kpi_snapshots")
