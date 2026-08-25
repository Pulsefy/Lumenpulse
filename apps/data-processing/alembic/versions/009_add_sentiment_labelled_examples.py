"""Add sentiment_labelled_examples table

Revision ID: 009
Revises: 008
Create Date: 2026-08-25 13:00:00.000000

Adds the human-labelled ground-truth store required for evaluating the
sentiment model during retraining runs (Issue Wave 8 – precision/recall/F1
quality gate).

Each row holds a single labelled text snippet together with:
  - label     : "positive" | "negative" | "neutral"
  - labeller  : who assigned the label (username / "seed")
  - labelled_at : when the label was created / last corrected
  - split     : "train" | "eval" — whether the row participates in
                lexicon enrichment ("train") or is held out strictly
                for evaluation ("eval")
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sentiment_labelled_examples",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("labeller", sa.String(length=255), nullable=False, server_default="seed"),
        sa.Column(
            "labelled_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("split", sa.String(length=10), nullable=False, server_default="train"),
        sa.Column("correction_note", sa.Text(), nullable=True),
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

    op.create_index("idx_sle_label", "sentiment_labelled_examples", ["label"])
    op.create_index("idx_sle_split", "sentiment_labelled_examples", ["split"])
    op.create_index("idx_sle_labeller", "sentiment_labelled_examples", ["labeller"])
    op.create_index(
        "idx_sle_split_label", "sentiment_labelled_examples", ["split", "label"]
    )
    op.create_index(
        "idx_sle_labelled_at", "sentiment_labelled_examples", ["labelled_at"]
    )


def downgrade() -> None:
    op.drop_index("idx_sle_labelled_at", table_name="sentiment_labelled_examples")
    op.drop_index("idx_sle_split_label", table_name="sentiment_labelled_examples")
    op.drop_index("idx_sle_labeller", table_name="sentiment_labelled_examples")
    op.drop_index("idx_sle_split", table_name="sentiment_labelled_examples")
    op.drop_index("idx_sle_label", table_name="sentiment_labelled_examples")
    op.drop_table("sentiment_labelled_examples")
