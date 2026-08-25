# KPI Computation Guide

## Overview

This guide covers the Protocol KPI computation system for Crowdfund Vault events. The system computes TVL (Total Value Locked) and cumulative volume from contract events, with support for event replays, corrections, and safe incremental updates.

## Architecture

The KPI computation system consists of:

1. **KPIComputer**: Core computation engine
2. **KPI API Routes**: REST endpoints for accessing KPI data
3. **Database Models**: `DailyOnchainKPISnapshot`, `ContractEvent`, `RawSorobanEvent`

## Key Concepts

### KPI Events

Events are normalized from `ContractEvent` or `RawSorobanEvent` tables:

- **Operation Types**: deposit, withdraw, contribution, milestone
- **Amount**: Stored as Decimal with proper scaling (10^7 decimals)
- **Project ID**: Linked to specific funding round/project
- **Contributor**: Wallet address of the contributor

### KPI State

State tracking includes:
- **TVL**: Sum of all project contributions
- **Cumulative Volume**: Total deposits/contributions over time
- **Contribution Count**: Number of individual contributions
- **Unique Contributors**: Distinct wallet addresses
- **Active Rounds**: Projects with TVL > 0
- **Project States**: Per-project contribution totals

### Correction Handling

Events can be marked as corrections:
- `is_correction: True`
- `correction_event_id`: References the original event being corrected
- Corrections reverse the effect of the original event

## Usage

### Basic Usage

```python
from src.kpi_computer import KPIComputer, compute_protocol_kpis

# Compute KPIs
computer = KPIComputer()
final_state, series = computer.compute_kpis(force_recompute=True)

# Get latest KPIs
kpis = computer.get_latest_kpis()
print(f"TVL: {kpis['tvl']}, Volume: {kpis['volume']}")

# Get historical series
history = computer.get_kpi_series(start_date="2024-01-01")