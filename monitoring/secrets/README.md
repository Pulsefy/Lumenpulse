Alertmanager reads its destinations from files in this directory:

- `slack-webhook-url` — Slack incoming webhook URL
- `pagerduty-key` — PagerDuty Events v2 routing key

The files are git-ignored. `docker-compose.monitoring.yml` mounts this directory read-only.
