"""Add contributor activity timeline index.

Revision ID: 1810000000000
Revises: 1800000000000
Create Date: 2026-06-25

Adds a composite index on contract_events(contributor, timestamp DESC) to
support fast contributor-centric timeline queries required by issue #876.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "1810000000000"
down_revision = "1800000000000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_contract_events_contributor_timestamp",
        "contract_events",
        ["contributor", "timestamp"],
        postgresql_ops={"timestamp": "DESC NULLS LAST"},
    )


def downgrade() -> None:
    op.drop_index(
        "idx_contract_events_contributor_timestamp",
        table_name="contract_events",
    )
