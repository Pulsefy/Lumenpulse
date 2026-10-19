# Monitoring

Prometheus, Alertmanager and Grafana are defined as code:

| Path | Purpose |
| --- | --- |
| `docker-compose.monitoring.yml` | The three services, persistent volumes, healthchecks; shares the `lumenpulse` compose network |
| `prometheus.yml`, `prometheus-rules.yml` | Scrape config, alert rules, recording rules |
| `monitoring/alertmanager.yml` | Routing and receivers |
| `monitoring/grafana/provisioning/` | Datasource (uid `prometheus`) and dashboard provider |
| `monitoring/grafana/dashboards/` | Dashboard rendered from `lumenpulse-grafana-dashboard.json` |
| `monitoring/tests/alerts.test.yml` | `promtool` unit tests for the alert rules |

## Running it

```bash
docker compose up -d                                   # application stack
node monitoring/render-dashboard.mjs                   # only after editing the source dashboard
docker compose -f docker-compose.monitoring.yml up -d --wait
```

Prometheus: <http://localhost:9090>, Alertmanager: <http://localhost:9093>,
Grafana: <http://localhost:3002> (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`).
`DEPLOY_ENVIRONMENT` sets the `environment` external label.

## Scrape access

The backend only serves `/metrics` to addresses in `METRICS_ALLOWED_IPS`
(comma-separated, CIDR supported). `docker-compose.yml` defaults it to loopback and
the private ranges so Prometheus on the compose network is allowed; narrow it in
production to the monitoring host or subnet.

## Alert destinations

Alertmanager reads destinations from files in `monitoring/secrets/`, which are
git-ignored: `slack-webhook-url` (all alerts) and `pagerduty-key` (critical alerts,
which go to both). The **Monitoring Deploy** workflow writes them from the
`monitoring` environment secrets `ALERT_SLACK_WEBHOOK_URL` and `ALERT_PAGERDUTY_KEY`
and syncs the stack to the host named by `MONITORING_SSH_HOST` / `MONITORING_SSH_KEY`.

## Validation in CI

The **Monitoring** workflow runs on every change to these files:
`promtool check config`, `promtool test rules` (proves `InstanceDown` fires and stays
quiet), `amtool check-config`, `amtool config routes test` (critical alerts reach
`oncall-pager` and `team-slack`, warnings reach `team-slack`), a check that the
committed dashboard equals the rendered source, and `docker compose config`.
