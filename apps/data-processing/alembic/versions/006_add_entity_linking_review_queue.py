"""Add entity linking review queue table

Revision ID: 006
Revises: 005
Create Date: 2026-07-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "entity_linking_review_queue",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("article_id", sa.String(length=255), nullable=False),
        sa.Column("stable_entity_id", sa.String(length=255), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("matched_text", sa.String(length=255), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("supporting_evidence", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=50), server_default="pending", nullable=False),
        sa.Column("corrected_entity_id", sa.String(length=255), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_entity_linking_review_queue_article_id",
        "entity_linking_review_queue",
        ["article_id"],
    )
    op.create_index(
        "ix_entity_linking_review_queue_stable_entity_id",
        "entity_linking_review_queue",
        ["stable_entity_id"],
    )
    op.create_index(
        "ix_entity_linking_review_queue_entity_type",
        "entity_linking_review_queue",
        ["entity_type"],
    )
    op.create_index(
        "ix_entity_linking_review_queue_status",
        "entity_linking_review_queue",
        ["status"],
    )
    op.create_index(
        "ux_entity_review_queue_article_entity",
        "entity_linking_review_queue",
        ["article_id", "stable_entity_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ux_entity_review_queue_article_entity",
        table_name="entity_linking_review_queue",
    )
    op.drop_index(
        "ix_entity_linking_review_queue_status",
        table_name="entity_linking_review_queue",
    )
    op.drop_index(
        "ix_entity_linking_review_queue_entity_type",
        table_name="entity_linking_review_queue",
    )
    op.drop_index(
        "ix_entity_linking_review_queue_stable_entity_id",
        table_name="entity_linking_review_queue",
    )
    op.drop_index(
        "ix_entity_linking_review_queue_article_id",
        table_name="entity_linking_review_queue",
    )
    op.drop_table("entity_linking_review_queue")
