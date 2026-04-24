"""Add Telegram subscription and command tracking tables

Revision ID: add_telegram_tables
Revises: 
Create Date: 2026-04-24 11:52:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_telegram_tables'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Create telegram_subscriptions table
    op.create_table(
        'telegram_subscriptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.BigInteger(), nullable=False),
        sa.Column('chat_type', sa.String(length=20), nullable=False),
        sa.Column('username', sa.String(length=255), nullable=True),
        sa.Column('first_name', sa.String(length=255), nullable=True),
        sa.Column('last_name', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('sentiment_alerts', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('price_alerts', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('trend_alerts', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('news_alerts', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_silenced', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('silence_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('subscribed_assets', sa.JSON(), nullable=True),
        sa.Column('alert_thresholds', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_interaction', sa.DateTime(timezone=True), nullable=True),
        sa.Index('idx_telegram_subscriptions_chat_id', 'chat_id'),
        sa.Index('idx_telegram_subscriptions_is_active', 'is_active'),
        sa.Index('idx_telegram_subscriptions_is_silenced', 'is_silenced'),
        sa.Index('idx_telegram_subscriptions_created_at', 'created_at'),
        sa.Index('idx_telegram_subscriptions_last_interaction', 'last_interaction'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create telegram_commands table
    op.create_table(
        'telegram_commands',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.BigInteger(), nullable=False),
        sa.Column('command', sa.String(length=50), nullable=False),
        sa.Column('args', sa.Text(), nullable=True),
        sa.Column('response_sent', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('response_text', sa.Text(), nullable=True),
        sa.Column('processing_time_ms', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('error_type', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Index('idx_telegram_commands_chat_id', 'chat_id'),
        sa.Index('idx_telegram_commands_command', 'command'),
        sa.Index('idx_telegram_commands_created_at', 'created_at'),
        sa.Index('idx_telegram_commands_chat_command', 'chat_id', 'command'),
        sa.PrimaryKeyConstraint('id')
    )

    # Add trigger for updated_at timestamp
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';
    """)

    op.execute("""
        CREATE TRIGGER update_telegram_subscriptions_updated_at 
            BEFORE UPDATE ON telegram_subscriptions 
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    """)


def downgrade():
    # Drop triggers
    op.execute("DROP TRIGGER IF EXISTS update_telegram_subscriptions_updated_at ON telegram_subscriptions")
    
    # Drop tables
    op.drop_table('telegram_commands')
    op.drop_table('telegram_subscriptions')
    
    # Drop function
    op.execute("DROP FUNCTION IF EXISTS update_updated_at_column()")
