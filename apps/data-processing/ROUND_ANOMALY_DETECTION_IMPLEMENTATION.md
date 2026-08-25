# Round Anomaly Detection Implementation Summary (#874)

## Overview
Implemented a comprehensive anomaly detection system for quadratic funding rounds to identify suspicious allocation patterns and unusual participation behavior. The system flags anomalies for maintainer review without blocking the base data processing pipeline.

## Acceptance Criteria Met

✅ **Produces anomaly signals for rounds or projects** - The detector generates structured anomaly signals for both round-level and project-level anomalies.

✅ **Stores detection rationale** - Each anomaly signal includes detailed detection rationale explaining why the anomaly was flagged, along with metric values and thresholds used.

✅ **Supports threshold tuning for testnet** - All detection thresholds are configurable via environment variables, with automatic testnet adjustments (20% more lenient by default).

✅ **Avoids blocking the base pipeline** - The round analyzer runs as a non-blocking background job using threading, integrated into the scheduler without affecting core pipeline performance.

## Key Components Created

### 1. Round Anomaly Detector (`src/round_anomaly_detector.py`)

**Core Detection Methods:**

- **Concentration Risk Detection**: Identifies when top 10% of contributors control too much of the total contributions using concentration ratio and Gini coefficient analysis.

- **High Single Contribution Detection**: Flags rounds where a single contributor dominates (>50% by default).

- **Low Participation Detection**: Identifies projects with suspiciously low unique contributor counts (<3 by default).

- **Unusual Timing Detection**: Detects contributions clustered in short time windows (80% within 1 hour by default), indicating potential bot activity.

- **Sybil Suspicion Detection**: Heuristic detection of potential sybil attacks by identifying identical contribution amounts across many contributors.

- **Disproportionate Allocation Detection**: Compares match-to-contribution ratios across projects to flag unfair matching distributions (>5x median ratio).

**Data Structures:**

```python
@dataclass
class RoundAnomalySignal:
    id: Optional[int]
    round_id: int
    project_id: Optional[int]
    anomaly_type: AnomalyType
    severity_score: float  # 0.0 - 1.0
    detection_rationale: str
    metric_values: Dict[str, Any]
    threshold_used: float
    timestamp: datetime
    reviewed: bool
    review_notes: Optional[str]
```

```python
@dataclass
class RoundMetrics:
    round_id: int
    total_pool: float
    total_contributions: float
    unique_contributors: int
    unique_projects: int
    contributor_distribution: Dict[str, float]
    project_contributions: Dict[int, float]
    project_contributor_counts: Dict[int, int]
    contribution_timestamps: List[datetime]
    
    @property
    def gini_coefficient(self) -> float
    
    @property
    def concentration_ratio(self) -> float
```

### 2. Database Storage (`src/db/models.py`)

**New Table: `round_anomaly_signals`**

Stores detected anomalies with full context for maintainer review:

- `round_id`: The round being analyzed
- `project_id`: Optional project ID for project-level anomalies
- `anomaly_type`: Type of anomaly (concentration_risk, sybil_suspicion, etc.)
- `severity_score`: 0.0-1.0 severity rating
- `detection_rationale`: Human-readable explanation
- `metric_values`: JSON field with detailed metrics
- `threshold_used`: Threshold that triggered the anomaly
- `reviewed`: Boolean flag for review status
- `review_notes`: Optional maintainer notes
- `reviewed_at` / `reviewed_by`: Audit trail for reviews

**Indexes for efficient querying:**
- `idx_round_anomaly_signals_round_id`
- `idx_round_anomaly_signals_project_id`
- `idx_round_anomaly_signals_anomaly_type`
- `idx_round_anomaly_signals_severity`
- `idx_round_anomaly_signals_reviewed`
- `idx_round_anomaly_signals_timestamp`
- `idx_round_anomaly_signals_round_type` (composite)

### 3. Database Service Methods (`src/db/postgres_service.py`)

Added comprehensive CRUD operations for anomaly signals:

- `save_round_anomaly_signal()`: Save a single signal
- `save_round_anomaly_signals()`: Batch save multiple signals
- `get_round_anomaly_signals()`: Query with filters (round_id, project_id, type, severity, reviewed)
- `get_unreviewed_anomaly_signals()`: Get signals pending review
- `mark_anomaly_signal_reviewed()`: Mark signal as reviewed with notes
- `get_anomaly_statistics()`: Aggregate statistics over time window

### 4. Round Analyzer (`src/round_analyzer.py`)

**Non-Blocking Pipeline Integration:**

- Runs as background thread to avoid blocking base pipeline
- Scheduled job runs every 6 hours
- Supports manual triggering via API
- Configurable via environment variables

**Key Methods:**

- `analyze_round(round_id)`: Analyze specific round
- `analyze_recent_rounds(hours)`: Analyze rounds in time window
- `run_analysis_async()`: Run in background thread

### 5. Scheduler Integration (`src/scheduler.py`)

Added scheduled job for round anomaly detection:

```python
# ── Round Anomaly Detection: every 6 hours (#874) ───────────
self.scheduler.add_job(
    func=_round_analyzer_job,
    trigger=IntervalTrigger(hours=6),
    id="round_anomaly_detection",
    name="Round Anomaly Detection",
    replace_existing=True,
)
```

### 6. Configuration (`.env.example`)

Added environment variables for threshold tuning:

```bash
# Network Configuration (mainnet or testnet)
NETWORK=mainnet

# Round Anomaly Detection Configuration
ROUND_CONCENTRATION_THRESHOLD=  # Default: 0.7 (mainnet), 0.84 (testnet)
ROUND_GINI_THRESHOLD=           # Default: 0.6 (mainnet), 0.72 (testnet)
ROUND_SINGLE_CONTRIBUTION_THRESHOLD=  # Default: 0.5 (mainnet), 0.6 (testnet)
ROUND_MIN_CONTRIBUTORS=         # Default: 3 (mainnet), 2 (testnet)
ROUND_TIMING_WINDOW_HOURS=1     # Time window for timing analysis
ROUND_TIMING_THRESHOLD=         # Default: 0.8 (mainnet), 0.96 (testnet)
```

**Testnet Adjustments:**
- All thresholds automatically 20% more lenient on testnet
- Minimum contributors reduced by 1
- Prevents false positives during testing

### 7. Database Migration (`alembic/versions/004_add_round_anomaly_signals.py`)

Alembic migration to create the `round_anomaly_signals` table with all indexes.

### 8. Unit Tests (`tests/test_round_anomaly_detector.py`)

Comprehensive test suite covering:

- Detector initialization (default, testnet, custom thresholds)
- Concentration risk detection
- High single contribution detection
- Low participation detection
- Unusual timing detection
- Sybil suspicion detection
- Disproportionate allocation detection
- Full round analysis with multiple anomalies
- Gini coefficient calculation
- Concentration ratio calculation
- Signal serialization
- Factory function

## Anomaly Types Detected

### 1. Concentration Risk
**Description**: Too many contributions from few addresses  
**Metrics**: Concentration ratio, Gini coefficient  
**Threshold**: Top 10% > 70% (mainnet), > 84% (testnet)  
**Severity**: Based on deviation from threshold

### 2. High Single Contribution
**Description**: Single contributor dominates the round  
**Metrics**: Single contributor ratio  
**Threshold**: > 50% (mainnet), > 60% (testnet)  
**Severity**: Based on excess over threshold

### 3. Low Participation
**Description**: Projects with suspiciously low contributor counts  
**Metrics**: Unique contributors per project  
**Threshold**: < 3 (mainnet), < 2 (testnet)  
**Severity**: Based on deficit from threshold

### 4. Unusual Timing
**Description**: Contributions clustered in short time windows  
**Metrics**: Ratio in time window  
**Threshold**: > 80% in 1-hour window (mainnet), > 96% (testnet)  
**Severity**: Based on clustering ratio

### 5. Sybil Suspicion
**Description**: Identical contribution amounts across many contributors  
**Metrics**: Same-amount ratio  
**Threshold**: > 30% with identical amounts  
**Severity**: Based on same-amount ratio

### 6. Disproportionate Allocation
**Description**: Unfair match allocation relative to contributions  
**Metrics**: Match-to-contribution ratio vs median  
**Threshold**: > 5x median ratio  
**Severity**: Based on ratio excess

## Severity Scoring

All anomalies produce severity scores from 0.0 to 1.0:

- **0.0 - 0.3**: Low severity (informational)
- **0.3 - 0.6**: Medium severity (review recommended)
- **0.6 - 0.8**: High severity (review required)
- **0.8 - 1.0**: Critical severity (immediate attention)

Severity is calculated based on how far the metric exceeds the threshold, normalized to the 0-1 range.

## Integration Points

### Pipeline Integration
The round analyzer integrates as a non-blocking component:

1. **Scheduled Job**: Runs every 6 hours via APScheduler
2. **Background Thread**: Uses threading to avoid blocking
3. **Error Isolation**: Failures don't affect base pipeline
4. **Metrics Tracking**: Uses Prometheus metrics for monitoring

### API Integration (Future)
The system supports manual triggering:

```python
from src.round_analyzer import run_manual_analysis

# Analyze specific round
result = run_manual_analysis(round_id=123)

# Analyze recent rounds
result = run_manual_analysis()
```

### Database Integration
- Signals persisted to `round_anomaly_signals` table
- Queryable via PostgresService methods
- Supports filtering by round, project, type, severity, review status

## Testing Strategy

### Unit Tests
- 20+ test cases covering all detection methods
- Edge cases (empty data, normal distributions)
- Threshold boundary testing
- Testnet vs mainnet configuration

### Integration Testing (Future)
- End-to-end pipeline testing
- Database migration testing
- Scheduler integration testing

### Manual Testing
Use the demo script to test with synthetic data:

```python
from src.round_anomaly_detector import create_detector, RoundMetrics

detector = create_detector(is_testnet=False)

# Create test metrics
metrics = RoundMetrics(
    round_id=1,
    total_pool=10000.0,
    total_contributions=5000.0,
    unique_contributors=10,
    unique_projects=5,
    contributor_distribution={"whale": 3000.0, **{f"addr{i}": 222.2 for i in range(9)}},
    project_contributions={1: 3000.0, 2: 2000.0},
    project_contributor_counts={1: 5, 2: 5},
)

signals = detector.analyze_round(metrics)
for signal in signals:
    print(f"{signal.anomaly_type}: {signal.severity_score:.2f}")
    print(f"Rationale: {signal.detection_rationale}")
```

## Performance Characteristics

- **Time Complexity**: O(n log n) for sorting-based calculations (Gini, concentration)
- **Space Complexity**: O(n) where n = number of contributors
- **Database Impact**: Minimal - inserts are batched and indexed
- **Pipeline Impact**: Zero - runs in background thread

## Monitoring

### Prometheus Metrics
- `anomalies_detected_total`: Counter by anomaly type
- `jobs_run_total`: Counter for job executions

### Logging
- Info: Round analysis start/completion
- Warning: Anomaly detection events
- Error: Failures in analysis pipeline

### Database Queries
Monitor query performance on:
- `get_round_anomaly_signals()`: Should use indexes
- `save_round_anomaly_signals()`: Batch inserts

## Security Considerations

- **No Blocking**: Detector cannot halt base pipeline
- **Read-Only Analysis**: Only analyzes existing data
- **No Automated Actions**: Signals require manual review
- **Audit Trail**: All reviews tracked with reviewer identity

## Future Enhancements

### Potential Improvements
1. **Machine Learning Integration**: Add ML-based pattern recognition
2. **Historical Baselines**: Compare rounds against historical patterns
3. **Real-Time Alerts**: WebSocket-based notifications for high-severity anomalies
4. **Contributor Graph Analysis**: Detect sybil networks via graph analysis
5. **Cross-Round Analysis**: Track contributor behavior across multiple rounds
6. **Automated Triage**: Auto-dismiss low-severity known patterns

### Scalability Considerations
- Distributed processing for large rounds (1000+ contributors)
- Database partitioning by round_id for large datasets
- Caching of frequently accessed round metrics
- Async database operations for better performance

## Maintenance

### Threshold Tuning
Adjust thresholds based on production data:

1. Monitor false positive/negative rates
2. Adjust environment variables
3. Restart scheduler to apply changes
4. Review impact on subsequent rounds

### Database Maintenance
- Archive reviewed signals older than 90 days
- Rebuild indexes if performance degrades
- Monitor table growth and storage usage

### Review Process
Maintainers should:
1. Review unreviewed signals daily
2. Add review notes for context
3. Mark false positives for future tuning
4. Escalate critical severity signals

## Conclusion

The round anomaly detection system successfully meets all acceptance criteria:

✅ Produces anomaly signals for rounds and projects  
✅ Stores detailed detection rationale with metrics and thresholds  
✅ Supports threshold tuning for testnet with automatic adjustments  
✅ Runs as non-blocking pipeline component using background threads  

The implementation provides a robust foundation for detecting suspicious allocation patterns in quadratic funding rounds while maintaining pipeline reliability and supporting maintainer review workflows.
