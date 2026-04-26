// Example: Using On-Chain Analytics API
// This example demonstrates how to query and use the protocol analytics

use soroban_sdk::{Env, Address};

// Example 1: Basic Analytics Query
pub fn query_protocol_metrics(env: &Env, contract_address: &Address) {
    // Import the contract client
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    
    // Get complete protocol statistics
    let stats = client.get_protocol_stats();
    
    // Access individual metrics
    let tvl = stats.tvl;
    let volume = stats.cumulative_volume;
    
    // Log or use the metrics
    env.logs().add(format!("Protocol TVL: {}", tvl));
    env.logs().add(format!("Cumulative Volume: {}", volume));
}

// Example 2: Individual Metric Queries
pub fn query_individual_metrics(env: &Env, contract_address: &Address) {
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    
    // Query only TVL (more gas efficient if you only need one metric)
    let tvl = client.get_tvl();
    env.logs().add(format!("Current TVL: {}", tvl));
    
    // Query only cumulative volume
    let volume = client.get_cumulative_volume();
    env.logs().add(format!("All-time Volume: {}", volume));
}

// Example 3: Building a Dashboard
pub struct ProtocolDashboard {
    pub tvl: i128,
    pub volume: i128,
    pub utilization_rate: i128, // volume / tvl ratio
}

pub fn build_dashboard(env: &Env, contract_address: &Address) -> ProtocolDashboard {
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    let stats = client.get_protocol_stats();
    
    // Calculate derived metrics
    let utilization_rate = if stats.tvl > 0 {
        (stats.cumulative_volume * 100) / stats.tvl
    } else {
        0
    };
    
    ProtocolDashboard {
        tvl: stats.tvl,
        volume: stats.cumulative_volume,
        utilization_rate,
    }
}

// Example 4: Monitoring and Alerts
pub fn check_protocol_health(env: &Env, contract_address: &Address) -> bool {
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    let stats = client.get_protocol_stats();
    
    // Define health thresholds
    const MIN_TVL: i128 = 1_000_000; // Minimum healthy TVL
    const MIN_VOLUME: i128 = 5_000_000; // Minimum activity threshold
    
    let is_healthy = stats.tvl >= MIN_TVL && stats.cumulative_volume >= MIN_VOLUME;
    
    if !is_healthy {
        env.logs().add("⚠️ Protocol health check failed");
        env.logs().add(format!("TVL: {} (min: {})", stats.tvl, MIN_TVL));
        env.logs().add(format!("Volume: {} (min: {})", stats.cumulative_volume, MIN_VOLUME));
    }
    
    is_healthy
}

// Example 5: Growth Rate Calculation (requires historical data)
pub struct GrowthMetrics {
    pub tvl_growth_rate: i128,
    pub volume_growth_rate: i128,
}

pub fn calculate_growth(
    env: &Env,
    contract_address: &Address,
    previous_tvl: i128,
    previous_volume: i128,
) -> GrowthMetrics {
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    let current_stats = client.get_protocol_stats();
    
    // Calculate percentage growth
    let tvl_growth = if previous_tvl > 0 {
        ((current_stats.tvl - previous_tvl) * 100) / previous_tvl
    } else {
        0
    };
    
    let volume_growth = if previous_volume > 0 {
        ((current_stats.cumulative_volume - previous_volume) * 100) / previous_volume
    } else {
        0
    };
    
    GrowthMetrics {
        tvl_growth_rate: tvl_growth,
        volume_growth_rate: volume_growth,
    }
}

// Example 6: Integration with External Systems
pub fn export_metrics_for_api(env: &Env, contract_address: &Address) -> String {
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    let stats = client.get_protocol_stats();
    
    // Format as JSON-like string for API consumption
    format!(
        r#"{{
            "tvl": {},
            "cumulative_volume": {},
            "timestamp": {}
        }}"#,
        stats.tvl,
        stats.cumulative_volume,
        env.ledger().timestamp()
    )
}

// Example 7: Comparative Analysis
pub fn compare_with_target(
    env: &Env,
    contract_address: &Address,
    target_tvl: i128,
    target_volume: i128,
) {
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    let stats = client.get_protocol_stats();
    
    let tvl_progress = if target_tvl > 0 {
        (stats.tvl * 100) / target_tvl
    } else {
        0
    };
    
    let volume_progress = if target_volume > 0 {
        (stats.cumulative_volume * 100) / target_volume
    } else {
        0
    };
    
    env.logs().add(format!("TVL Progress: {}%", tvl_progress));
    env.logs().add(format!("Volume Progress: {}%", volume_progress));
}

// Example 8: Risk Assessment
pub fn assess_protocol_risk(env: &Env, contract_address: &Address) -> String {
    use crowdfund_vault::CrowdfundVaultContractClient;
    
    let client = CrowdfundVaultContractClient::new(env, contract_address);
    let stats = client.get_protocol_stats();
    
    // Simple risk scoring based on TVL
    let risk_level = if stats.tvl < 100_000 {
        "HIGH"
    } else if stats.tvl < 1_000_000 {
        "MEDIUM"
    } else {
        "LOW"
    };
    
    format!("Risk Level: {} (TVL: {})", risk_level, stats.tvl)
}
