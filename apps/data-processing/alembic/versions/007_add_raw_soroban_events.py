"""Add raw_soroban_events table

Revision ID: 007
Revises: 006
Create Date: 2026-07-23 00:00:00.000000

Stores raw Soroban contract events in an append-only format for debugging,
replay, and downstream reprocessing.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "raw_soroban_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("contract_id", sa.String(length=255), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("ledger", sa.BigInteger(), nullable=False),
        sa.Column("paging_token", sa.String(length=255), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=True),
        sa.Column("source_rpc_url", sa.String(length=512), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Unique constraint on (contract_id, event_id) to ensure idempotency.
    op.create_index(
        "ux_raw_soroban_events_contract_event",
        "raw_soroban_events",
        ["contract_id", "event_id"],
        unique=True,
    )

    # Index on (contract_id, ledger) for scanning contract history.
    op.create_index(
        "idx_raw_soroban_events_contract_ledger",
        "raw_soroban_events",
        ["contract_id", "ledger"],
    )

    # Index on ledger for system-wide range queries.
    op.create_index(
        "idx_raw_soroban_events_ledger",
        "raw_soroban_events",
        ["ledger"],
    )

    # Index on event_type to filter by type.
    op.create_index(
        "idx_raw_soroban_events_event_type",
        "raw_soroban_events",
        ["event_type"],
    )

    # Index on source_rpc_url to filter by source.
    op.create_index(
        "idx_raw_soroban_events_source_rpc_url",
        "raw_soroban_events",
        ["source_rpc_url"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_raw_soroban_events_source_rpc_url", table_name="raw_soroban_events"
    )
    op.drop_index("idx_raw_soroban_events_event_type", table_name="raw_soroban_events")
    op.drop_index("idx_raw_soroban_events_ledger", table_name="raw_soroban_events")
    op.drop_index(
        "idx_raw_soroban_events_contract_ledger", table_name="raw_soroban_events"
    )
    op.drop_index(
        "ux_raw_soroban_events_contract_event", table_name="raw_soroban_events"
    )
    op.drop_table("raw_soroban_events")
