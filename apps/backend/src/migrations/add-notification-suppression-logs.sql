-- Migration: Add notification suppression logs for fanout observability
-- Created: 2026-07-25

-- Create suppression_reason enum type
CREATE TYPE suppression_reason AS ENUM (
    'quiet_hours',
    'severity_threshold',
    'daily_limit',
    'event_category_disabled',
    'not_in_watchlist',
    'no_preferences',
    'channel_unavailable'
);

-- Create notification_suppression_logs table
CREATE TABLE IF NOT EXISTS notification_suppression_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    event_category VARCHAR(50) NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    reason suppression_reason NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_suppression_logs_user_id ON notification_suppression_logs(user_id);
CREATE INDEX idx_suppression_logs_event_category ON notification_suppression_logs(event_category);
CREATE INDEX idx_suppression_logs_reason ON notification_suppression_logs(reason);
CREATE INDEX idx_suppression_logs_created_at ON notification_suppression_logs(created_at);
CREATE INDEX idx_suppression_logs_user_event ON notification_suppression_logs(user_id, event_category);

-- Add comments for documentation
COMMENT ON TABLE notification_suppression_logs IS 'Tracks notifications suppressed during fanout for debugging and observability';
COMMENT ON COLUMN notification_suppression_logs.user_id IS 'User whose notification was suppressed';
COMMENT ON COLUMN notification_suppression_logs.event_category IS 'Event category that triggered the notification attempt';
COMMENT ON COLUMN notification_suppression_logs.notification_type IS 'Type of notification that was suppressed';
COMMENT ON COLUMN notification_suppression_logs.reason IS 'Reason for suppression: quiet_hours, severity_threshold, daily_limit, event_category_disabled, not_in_watchlist, no_preferences, channel_unavailable';
COMMENT ON COLUMN notification_suppression_logs.metadata IS 'Additional context about the suppression event';
