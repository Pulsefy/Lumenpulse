from src.analytics.crowdfund_metrics import compute_kpis_from_events

def test_simple_deposit_withdraw_and_correction():
    events = [
        {
            "id": "e1",
            "type": "deposit",
            "project_id": 1,
            "amount": 100.0,
            "timestamp": "2024-01-01T00:00:00Z",
        },
        {
            "id": "e2",
            "type": "withdraw",
            "project_id": 1,
            "amount": 30.0,
            "timestamp": "2024-01-01T01:00:00Z",
        },
        # correction: e3 replaces e1 with amount 120
        {
            "id": "e3",
            "type": "deposit",
            "project_id": 1,
            "amount": 120.0,
            "timestamp": "2024-01-01T02:00:00Z",
            "correction_of": "e1",
        },
    ]

    series = compute_kpis_from_events(events)

    # After e1: tvl=100, cumulative=100
    assert series[0]["tvl"] == 100.0
    assert series[0]["cumulative_deposits"] == 100.0

    # After e2: tvl=70, cumulative still 100
    assert series[1]["tvl"] == 70.0
    assert series[1]["cumulative_deposits"] == 100.0

    # After e3 correction: original deposit 100 reversed and replaced by 120
    # balances: start 0 -> e1 +100 -> e2 -30 => 70
    # reverse e1: 70 -100 => floored at 0 -> then apply e3 +120 => 120
    # cumulative deposits: 100 -> (100 -100) +120 = 120
    assert series[2]["tvl"] == 120.0
    assert series[2]["cumulative_deposits"] == 120.0
