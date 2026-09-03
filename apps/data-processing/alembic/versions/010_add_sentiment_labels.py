"""add persisted human sentiment labels (#1241)"""

from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sentiment_labels",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("labeller", sa.String(length=255), nullable=False),
        sa.Column("labelled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_held_out", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("text", name="ux_sentiment_labels_text"),
    )
    op.create_index("idx_sentiment_labels_evaluation_split", "sentiment_labels", ["is_held_out", "label"])
    op.create_index("ix_sentiment_labels_label", "sentiment_labels", ["label"])
    op.create_index("ix_sentiment_labels_labelled_at", "sentiment_labels", ["labelled_at"])
    op.create_index("ix_sentiment_labels_is_held_out", "sentiment_labels", ["is_held_out"])


def downgrade() -> None:
    op.drop_index("ix_sentiment_labels_is_held_out", table_name="sentiment_labels")
    op.drop_index("ix_sentiment_labels_labelled_at", table_name="sentiment_labels")
    op.drop_index("ix_sentiment_labels_label", table_name="sentiment_labels")
    op.drop_index("idx_sentiment_labels_evaluation_split", table_name="sentiment_labels")
    op.drop_table("sentiment_labels")
