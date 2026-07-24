"""Add ledger_cursors table

Revision ID: 008
Revises: 007
Create Date: 2026-07-24 18:00:00.000000

Persistent ledger cursor store for the ingestion recovery coordinator.
Each row tracks the ingestion progress of one stream (global or per-contract).
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
        "ledger_cursors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.String(length=512), nullable=False),
        sa.Column("last_ingested_ledger", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("safe_ledger", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("last_event_id", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="idle"),
        sa.Column("error_message", sa.String(length=2048), nullable=True),
        sa.Column(
            "updated_at",
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
        sa.PrimaryKeyConstraint("id"),
    )

    # Unique index on stream_id — each stream has exactly one cursor row.
    op.create_index(
        "ux_ledger_cursors_stream_id",
        "ledger_cursors",
        ["stream_id"],
        unique=True,
    )

    # Index on status to quickly query failed/ingesting streams.
    op.create_index(
        "idx_ledger_cursors_status",
        "ledger_cursors",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("idx_ledger_cursors_status", table_name="ledger_cursors")
    op.drop_index("ux_ledger_cursors_stream_id", table_name="ledger_cursors")
    op.drop_table("ledger_cursors")
