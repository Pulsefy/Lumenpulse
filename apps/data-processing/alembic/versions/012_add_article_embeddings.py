"""add versioned article embedding vectors (#1455)

Revision ID: 012
Revises: 011
Create Date: 2026-09-24
"""

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "article_embeddings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("article_id", sa.String(length=255), nullable=False),
        sa.Column("model_name", sa.String(length=100), nullable=False),
        sa.Column("model_version", sa.String(length=100), nullable=False),
        sa.Column("dimension", sa.Integer(), nullable=False),
        sa.Column("embedding", sa.JSON(), nullable=False),
        sa.Column("text_hash", sa.String(length=64), nullable=False),
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
        sa.UniqueConstraint(
            "article_id",
            "model_version",
            name="ux_article_embeddings_article_model",
        ),
    )
    op.create_index(
        "ix_article_embeddings_article_id",
        "article_embeddings",
        ["article_id"],
    )
    op.create_index(
        "ix_article_embeddings_model_version",
        "article_embeddings",
        ["model_version"],
    )


def downgrade() -> None:
    op.drop_index("ix_article_embeddings_model_version", table_name="article_embeddings")
    op.drop_index("ix_article_embeddings_article_id", table_name="article_embeddings")
    op.drop_table("article_embeddings")
