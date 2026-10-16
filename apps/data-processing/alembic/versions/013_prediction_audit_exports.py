"""add searchable prediction fields and export audit records

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
    op.add_column(
        "prediction_logs",
        sa.Column("subject_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "prediction_logs",
        sa.Column("feature_values", sa.JSON(), nullable=True),
    )
    op.create_index(
        "ix_prediction_logs_subject_hash",
        "prediction_logs",
        ["subject_hash"],
        unique=False,
    )
    op.create_table(
        "prediction_audit_exports",
        sa.Column("export_id", sa.String(length=36), nullable=False),
        sa.Column("request_id", sa.String(length=255), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("exported_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("export_id"),
    )
    op.create_index(
        "ix_prediction_audit_exports_request_id",
        "prediction_audit_exports",
        ["request_id"],
        unique=False,
    )
    op.create_index(
        "ix_prediction_audit_exports_created_at",
        "prediction_audit_exports",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_prediction_audit_exports_created_at",
        table_name="prediction_audit_exports",
    )
    op.drop_index(
        "ix_prediction_audit_exports_request_id",
        table_name="prediction_audit_exports",
    )
    op.drop_table("prediction_audit_exports")
    op.drop_index("ix_prediction_logs_subject_hash", table_name="prediction_logs")
    op.drop_column("prediction_logs", "feature_values")
    op.drop_column("prediction_logs", "subject_hash")
