"""add async analytics job queue table (#1248)"""

from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analytics_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("job_id", sa.String(length=36), nullable=False),
        sa.Column("job_type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("dedupe_key", sa.String(length=255), nullable=True),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", name="ux_analytics_jobs_job_id"),
        sa.UniqueConstraint("dedupe_key", name="ux_analytics_jobs_dedupe_key"),
    )
    op.create_index("ix_analytics_jobs_job_id", "analytics_jobs", ["job_id"])
    op.create_index("ix_analytics_jobs_job_type", "analytics_jobs", ["job_type"])
    op.create_index("ix_analytics_jobs_status", "analytics_jobs", ["status"])
    op.create_index("ix_analytics_jobs_dedupe_key", "analytics_jobs", ["dedupe_key"])
    op.create_index("ix_analytics_jobs_created_at", "analytics_jobs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_analytics_jobs_created_at", table_name="analytics_jobs")
    op.drop_index("ix_analytics_jobs_dedupe_key", table_name="analytics_jobs")
    op.drop_index("ix_analytics_jobs_status", table_name="analytics_jobs")
    op.drop_index("ix_analytics_jobs_job_type", table_name="analytics_jobs")
    op.drop_index("ix_analytics_jobs_job_id", table_name="analytics_jobs")
    op.drop_table("analytics_jobs")
