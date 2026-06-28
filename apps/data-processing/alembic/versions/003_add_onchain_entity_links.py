"""Add on-chain entity links for news articles

Revision ID: 003
Revises: 002
Create Date: 2026-06-01 23:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "articles",
        sa.Column("onchain_entity_links", sa.JSON(), nullable=True),
    )

    op.create_table(
        "article_onchain_entity_links",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("article_id", sa.String(length=255), nullable=False),
        sa.Column("stable_entity_id", sa.String(length=255), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("matched_text", sa.String(length=255), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("asset_code", sa.String(length=20), nullable=True),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("contract_id", sa.String(length=255), nullable=True),
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
        "ix_article_onchain_entity_links_article_id",
        "article_onchain_entity_links",
        ["article_id"],
    )
    op.create_index(
        "ix_article_onchain_entity_links_asset_code",
        "article_onchain_entity_links",
        ["asset_code"],
    )
    op.create_index(
        "ix_article_onchain_entity_links_contract_id",
        "article_onchain_entity_links",
        ["contract_id"],
    )
    op.create_index(
        "ix_article_onchain_entity_links_entity_type",
        "article_onchain_entity_links",
        ["entity_type"],
    )
    op.create_index(
        "ix_article_onchain_entity_links_project_id",
        "article_onchain_entity_links",
        ["project_id"],
    )
    op.create_index(
        "ix_article_onchain_entity_links_stable_entity_id",
        "article_onchain_entity_links",
        ["stable_entity_id"],
    )
    op.create_index(
        "ux_article_onchain_links_article_entity",
        "article_onchain_entity_links",
        ["article_id", "stable_entity_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ux_article_onchain_links_article_entity",
        table_name="article_onchain_entity_links",
    )
    op.drop_index(
        "ix_article_onchain_entity_links_stable_entity_id",
        table_name="article_onchain_entity_links",
    )
    op.drop_index(
        "ix_article_onchain_entity_links_project_id",
        table_name="article_onchain_entity_links",
    )
    op.drop_index(
        "ix_article_onchain_entity_links_entity_type",
        table_name="article_onchain_entity_links",
    )
    op.drop_index(
        "ix_article_onchain_entity_links_contract_id",
        table_name="article_onchain_entity_links",
    )
    op.drop_index(
        "ix_article_onchain_entity_links_asset_code",
        table_name="article_onchain_entity_links",
    )
    op.drop_index(
        "ix_article_onchain_entity_links_article_id",
        table_name="article_onchain_entity_links",
    )
    op.drop_table("article_onchain_entity_links")
    op.drop_column("articles", "onchain_entity_links")
