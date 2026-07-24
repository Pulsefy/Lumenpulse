"""
KPI Reconciliation against Live Contract Reads

Goal:
Continuously compare derived database KPIs with direct contract reads via Soroban RPC
to detect data drift before it impacts user surfaces.

Acceptance Criteria:
- Reconciles total_contributions (core KPI) against on-chain total_deposited.
- Configurable drift thresholds.
- Actionable diagnostics logged on mismatch.
- Rate-limiting safe for testnet.
"""

from __future__ import annotations

import base64
import os
import math
import time
import requests
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, desc

from src.utils.logger import setup_logger
from src.db.postgres_service import PostgresService
from src.db.models import ProjectView, MetadataDriftFinding
import stellar_sdk
from stellar_sdk import xdr, strkey

logger = setup_logger(__name__)

# Default configuration values
DEFAULT_CROWDFUND_VAULT = "CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO"
DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org:443"
DEFAULT_DECIMALS = 7  # Soroban standard tokens typically use 7 decimals
DEFAULT_DRIFT_PERCENTAGE_THRESHOLD = 0.01  # 1% drift threshold
DEFAULT_DRIFT_ABSOLUTE_THRESHOLD = 0.001  # Absolute threshold to ignore tiny floating point noise

@dataclass
class KPIReconciliationFinding:
    project_id: int
    field_name: str
    backend_value: float
    onchain_value: float
    drift_absolute: float
    drift_percentage: float
    severity: str
    diagnostics: str
    detected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": f"kpi_rec_{self.detected_at.strftime('%Y%m%d_%H%M%S')}",
            "project_id": self.project_id,
            "scope": "kpi",
            "field": self.field_name,
            "backend_value": str(self.backend_value),
            "chain_derived_value": str(self.onchain_value),
            "severity": self.severity,
            "detected_at": self.detected_at,
        }

class KPIReconciler:
    """
    Reconciles off-chain ProjectView KPIs against on-chain contract state via Soroban RPC.
    """

    def __init__(
        self,
        db_service: Optional[PostgresService] = None,
        rpc_url: Optional[str] = None,
        contract_id: Optional[str] = None,
        drift_percentage_threshold: float = DEFAULT_DRIFT_PERCENTAGE_THRESHOLD,
        drift_absolute_threshold: float = DEFAULT_DRIFT_ABSOLUTE_THRESHOLD,
        decimals: int = DEFAULT_DECIMALS,
    ):
        self.db_service = db_service or PostgresService()
        self.rpc_url = rpc_url or os.getenv("SOROBAN_RPC_URL") or DEFAULT_RPC_URL
        self.contract_id = contract_id or os.getenv("CROWDFUND_VAULT_CONTRACT_ID") or DEFAULT_CROWDFUND_VAULT
        self.drift_percentage_threshold = drift_percentage_threshold
        self.drift_absolute_threshold = drift_absolute_threshold
        self.scaling_factor = 10 ** decimals

    def get_project_ledger_key(self, project_id: int) -> str:
        """
        Builds the base64-encoded LedgerKey for DataKey::Project(project_id) on the contract.
        """
        contract_bytes = strkey.StrKey.decode_contract(self.contract_id)
        sc_address = xdr.SCAddress(
            type=xdr.SCAddressType.SC_ADDRESS_TYPE_CONTRACT,
            contract_id=xdr.Hash(contract_bytes)
        )
        
        project_sym = xdr.SCVal(
            type=xdr.SCValType.SCV_SYMBOL,
            sym=xdr.SCSymbol(b"Project")
        )
        project_id_val = xdr.SCVal(
            type=xdr.SCValType.SCV_U64,
            u64=xdr.Uint64(project_id)
        )
        key_vec = xdr.SCVal(
            type=xdr.SCValType.SCV_VEC,
            vec=xdr.SCVec(sc_vec=[project_sym, project_id_val])
        )
        
        contract_data_key = xdr.LedgerKeyContractData(
            contract=sc_address,
            key=key_vec,
            durability=xdr.ContractDataDurability.PERSISTENT
        )
        
        ledger_key = xdr.LedgerKey(
            type=xdr.LedgerEntryType.CONTRACT_DATA,
            contract_data=contract_data_key
        )
        
        return base64.b64encode(ledger_key.to_xdr_bytes()).decode('utf-8')

    def parse_scval(self, scval: Any) -> Any:
        """
        Recursively decodes an SCVal into native Python types.
        """
        if scval.type == xdr.SCValType.SCV_VOID:
            return None
        elif scval.type == xdr.SCValType.SCV_BOOL:
            return scval.b
        elif scval.type == xdr.SCValType.SCV_U32:
            return scval.u32.uint32
        elif scval.type == xdr.SCValType.SCV_I32:
            return scval.i32.int32
        elif scval.type == xdr.SCValType.SCV_U64:
            return scval.u64.uint64
        elif scval.type == xdr.SCValType.SCV_I64:
            return scval.i64.int64
        elif scval.type == xdr.SCValType.SCV_SYMBOL:
            return scval.sym.sc_symbol.decode('utf-8')
        elif scval.type == xdr.SCValType.SCV_STRING:
            return scval.str.sc_string.decode('utf-8')
        elif scval.type == xdr.SCValType.SCV_BYTES:
            return scval.bytes.sc_bytes
        elif scval.type == xdr.SCValType.SCV_I128:
            hi = scval.i128.hi
            lo = scval.i128.lo
            val = (hi << 64) | lo
            if hi < 0 or (hi & (1 << 63)):
                val = val - (1 << 128)
            return val
        elif scval.type == xdr.SCValType.SCV_U128:
            hi = scval.u128.hi
            lo = scval.u128.lo
            return (hi << 64) | lo
        elif scval.type == xdr.SCValType.SCV_VEC:
            if scval.vec and scval.vec.sc_vec:
                return [self.parse_scval(v) for v in scval.vec.sc_vec]
            return []
        elif scval.type == xdr.SCValType.SCV_MAP:
            res = {}
            if scval.map and scval.map.sc_map:
                for entry in scval.map.sc_map:
                    key = self.parse_scval(entry.key)
                    val = self.parse_scval(entry.val)
                    res[key] = val
            return res
        elif scval.type == xdr.SCValType.SCV_ADDRESS:
            addr = scval.address
            if addr.type == xdr.SCAddressType.SC_ADDRESS_TYPE_ACCOUNT:
                return strkey.StrKey.encode_ed25519_public_key(addr.account_id.ed25519.uint256)
            elif addr.type == xdr.SCAddressType.SC_ADDRESS_TYPE_CONTRACT:
                return strkey.StrKey.encode_contract(addr.contract_id.hash)
        
        # Fallback for newer XDR structures (e.g. SCV_STRUCT)
        if hasattr(scval, 'struct') and scval.struct and hasattr(scval.struct, 'fields'):
            res = {}
            for field in scval.struct.fields:
                name = field.name.sc_symbol.decode('utf-8')
                res[name] = self.parse_scval(field.val)
            return res
            
        return str(scval)

    def fetch_onchain_project_data(self, project_id: int) -> Optional[Dict[str, Any]]:
        """
        Queries Soroban RPC for the ProjectData ledger entry.
        """
        b64_key = self.get_project_ledger_key(project_id)
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getLedgerEntries",
            "params": {
                "keys": [b64_key]
            }
        }
        try:
            response = requests.post(self.rpc_url, json=payload, timeout=10)
            if response.status_code == 429:
                logger.warning("Soroban RPC rate limited (429). Gracefully halting RPC checks.")
                return None
            response.raise_for_status()
            res = response.json()
            
            if "error" in res:
                logger.error(f"RPC returned error: {res['error']}")
                return None
                
            entries = res.get("result", {}).get("entries", [])
            if not entries:
                return None
                
            entry_xdr = entries[0].get("xdr")
            entry_bytes = base64.b64decode(entry_xdr)
            
            # Parse the LedgerEntry
            entry = xdr.LedgerEntry.from_xdr(entry_bytes)
            scval = entry.data.contract_data.val
            parsed = self.parse_scval(scval)
            
            # Map dynamic types
            if isinstance(parsed, dict):
                return parsed
            elif isinstance(parsed, list) and len(parsed) >= 8:
                return {
                    "id": parsed[0],
                    "owner": parsed[1],
                    "name": parsed[2],
                    "target_amount": parsed[3],
                    "token_address": parsed[4],
                    "total_deposited": parsed[5],
                    "total_withdrawn": parsed[6],
                    "is_active": parsed[7],
                }
            return None
        except Exception as e:
            logger.error(f"Failed to fetch or decode onchain data for project {project_id}: {e}")
            return None

    def reconcile_project(self, project_view: ProjectView) -> Optional[KPIReconciliationFinding]:
        """
        Performs KPI reconciliation for a single project.
        """
        project_id = project_view.project_id
        onchain_data = self.fetch_onchain_project_data(project_id)
        if onchain_data is None:
            return None

        onchain_total_raw = onchain_data.get("total_deposited", 0)
        onchain_total = float(onchain_total_raw) / self.scaling_factor
        backend_total = float(project_view.total_contributions or 0.0)

        drift_absolute = abs(backend_total - onchain_total)
        
        # Avoid division by zero
        if onchain_total > 0:
            drift_percentage = drift_absolute / onchain_total
        elif backend_total > 0:
            drift_percentage = drift_absolute / backend_total
        else:
            drift_percentage = 0.0

        # Mismatch detection logic
        if drift_absolute > self.drift_absolute_threshold and drift_percentage > self.drift_percentage_threshold:
            severity = "critical" if drift_percentage >= 0.1 else "warning"
            diagnostics = (
                f"KPI Drift Detected in Project {project_id}: "
                f"Field='total_contributions'. "
                f"Backend (db) value={backend_total:.6f}, "
                f"On-chain (contract) value={onchain_total:.6f}. "
                f"Absolute drift={drift_absolute:.6f}, "
                f"Percentage drift={drift_percentage * 100:.2f}%. "
                f"Drift threshold={self.drift_percentage_threshold * 100:.1f}%."
            )
            logger.warning(diagnostics)
            
            return KPIReconciliationFinding(
                project_id=project_id,
                field_name="total_contributions",
                backend_value=backend_total,
                onchain_value=onchain_total,
                drift_absolute=drift_absolute,
                drift_percentage=drift_percentage,
                severity=severity,
                diagnostics=diagnostics
            )
        
        return None

    def run_reconciliation(self, limit: int = 10, rate_limit_sleep: float = 0.2) -> List[KPIReconciliationFinding]:
        """
        Runs reconciliation against the top N projects by contributions.
        Uses rate limiting sleep between RPC requests to remain safe for testnet.
        """
        # Fetch the top projects by volume to reconcile
        with self.db_service.get_session() as session:
            stmt = select(ProjectView).order_by(desc(ProjectView.total_contributions)).limit(limit)
            projects = session.execute(stmt).scalars().all()

        findings: List[KPIReconciliationFinding] = []
        logger.info(f"Starting KPI reconciliation check for {len(projects)} projects.")
        
        for project in projects:
            try:
                finding = self.reconcile_project(project)
                if finding:
                    findings.append(finding)
            except Exception as e:
                logger.error(f"Error during reconciliation of project {project.project_id}: {e}")
            
            # Rate limiting safety for testnet
            if rate_limit_sleep > 0:
                time.sleep(rate_limit_sleep)
                
        # Persist findings if any are found
        if findings:
            finding_dicts = [f.to_dict() for f in findings]
            saved = self.db_service.save_metadata_drift_findings(finding_dicts)
            logger.warning(f"Reconciliation completed: {len(findings)} KPI drift findings persisted to database.")
        else:
            logger.info("Reconciliation completed: No KPI drift detected.")

        return findings
