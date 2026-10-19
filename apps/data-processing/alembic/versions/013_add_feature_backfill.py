"""persist resumable historical feature backfills (#1636)

Revision ID: 013
Revises: 012
Create Date: 2026-10-16
"""

from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feature_backfill_values",
        sa.Column("backfill_id", sa.String(length=64), nullable=False),
        sa.Column("asset", sa.String(length=64), nullable=False),
        sa.Column("feature_name", sa.String(length=128), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("schema_version", sa.String(length=32), nullable=False),
        sa.Column("schema_fingerprint", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "backfill_id", "timestamp", name="pk_feature_backfill_values"
        ),
    )
    op.create_index(
        "ix_feature_backfill_values_lookup",
        "feature_backfill_values",
        ["asset", "feature_name", "timestamp"],
    )
    op.create_table(
        "feature_backfill_checkpoints",
        sa.Column("backfill_id", sa.String(length=64), nullable=False),
        sa.Column("asset", sa.String(length=64), nullable=False),
        sa.Column("feature_name", sa.String(length=128), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rows_processed", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("schema_version", sa.String(length=32), nullable=False),
        sa.Column("schema_fingerprint", sa.String(length=32), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("backfill_id"),
    )


def downgrade() -> None:
    op.drop_table("feature_backfill_checkpoints")
    op.drop_index(
        "ix_feature_backfill_values_lookup", table_name="feature_backfill_values"
    )
    op.drop_table("feature_backfill_values")
