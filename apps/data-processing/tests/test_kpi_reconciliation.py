import pytest
from unittest.mock import patch, MagicMock
from src.kpi_reconciliation import KPIReconciler, KPIReconciliationFinding
from src.db.models import ProjectView

def test_kpi_reconciliation_finding_to_dict():
    finding = KPIReconciliationFinding(
        project_id=42,
        field_name="total_contributions",
        backend_value=123.45,
        onchain_value=120.0,
        drift_absolute=3.45,
        drift_percentage=0.02875,
        severity="warning",
        diagnostics="Drift!"
    )
    d = finding.to_dict()
    assert d["project_id"] == 42
    assert d["scope"] == "kpi"
    assert d["field"] == "total_contributions"
    assert d["backend_value"] == "123.45"
    assert d["chain_derived_value"] == "120.0"
    assert d["severity"] == "warning"

@patch("src.kpi_reconciliation.requests.post")
def test_reconcile_project_no_drift(mock_post):
    # Mock Soroban RPC response for ProjectData
    # Let's mock a valid response
    # total_deposited is index 5 in the array (e.g. 1000 * 1e7 = 10000000000)
    mock_post.return_value.status_code = 200
    
    # We will construct a dummy ProjectData XDR returned
    # But to make tests super reliable and avoid XDR version binary issues in mock, 
    # we can mock fetch_onchain_project_data directly!
    pass

def test_reconcile_project_with_drift():
    reconciler = KPIReconciler()
    
    # Mock project view
    project_view = ProjectView(
        project_id=1,
        total_contributions=105.0,  # db value
    )
    
    # Mock fetch_onchain_project_data to return total_deposited = 100.0 * 1e7
    reconciler.fetch_onchain_project_data = MagicMock(return_value={
        "total_deposited": 1000000000,  # 100.0
        "is_active": True
    })
    
    finding = reconciler.reconcile_project(project_view)
    
    assert finding is not None
    assert finding.project_id == 1
    assert finding.field_name == "total_contributions"
    assert finding.backend_value == 105.0
    assert finding.onchain_value == 100.0
    assert finding.drift_absolute == 5.0
    assert finding.drift_percentage == 0.05
    assert finding.severity == "warning"

def test_reconcile_project_no_drift_threshold():
    reconciler = KPIReconciler()
    
    # Mock project view
    project_view = ProjectView(
        project_id=1,
        total_contributions=100.0001,  # tiny drift below 1%
    )
    
    reconciler.fetch_onchain_project_data = MagicMock(return_value={
        "total_deposited": 1000000000,  # 100.0
        "is_active": True
    })
    
    finding = reconciler.reconcile_project(project_view)
    assert finding is None
