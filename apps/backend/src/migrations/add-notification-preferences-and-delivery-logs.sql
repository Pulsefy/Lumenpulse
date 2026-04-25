-- Migration: Add notification preferences and delivery tracking
-- Created: 2026-04-25

-- Create notification_preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    enabled_channels JSONB NOT NULL DEFAULT '["in_app"]',
    event_preferences JSONB NOT NULL DEFAULT '{}',
    quiet_hours JSONB,
    daily_limit INTEGER NOT NULL DEFAULT 0,
    min VARCHAR(20) NOT NULL DEFAULT 'low',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for notification_preferences
CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);

-- Create notification_delivery_logs table
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL,
    user_id UUID NOT NULL,
    channel VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    event_category VARCHAR(50),
    severity VARCHAR(20),
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for notification_delivery_logs
CREATE INDEX idx_delivery_logs_notification_id ON notification_delivery_logs(notification_id);
CREATE INDEX idx_delivery_logs_user_id ON notification_delivery_logs(user_id);
CREATE INDEX idx_delivery_logs_channel_status ON notification_delivery_logs(channel, status);
CREATE INDEX idx_delivery_logs_created_at ON notification_delivery_logs(created_at);

-- Add comments
COMMENT ON TABLE notification_preferences IS 'User notification preferences and settings';
COMMENT ON TABLE notification_delivery_logs IS 'Tracks notification delivery attempts and status';

COMMENT ON COLUMN notification_preferences.enabled_channels IS 'Array of enabled notification channels: in_app, email, push, webhook, sms';
COMMENT ON COLUMN notification_preferences.event_preferences IS 'Event category preferences map';
COMMENT ON COLUMN notification_preferences.quiet_hours IS 'Quiet hours configuration JSON';
COMMENT ON COLUMN notification_preferences.daily_limit IS 'Maximum notifications per day (0 = unlimited)';
COMMENT ON COLUMN notification_preferences.min_severity IS 'Minimum severity level: low, medium, high, critical';

COMMENT ON COLUMN notification_delivery_logs.channel IS 'Delivery channel used';
COMMENT ON COLUMN notification_delivery_logs.status IS 'Delivery status: pending, sent, delivered, failed, skipped';
COMMENT ON COLUMN notification_delivery_logs.event_category IS 'Event category that triggered notification';
COMMENT ON COLUMN notification_delivery_logs.retry_count IS 'Number of retry attempts';

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for notification_preferences
CREATE TRIGGER update_notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
