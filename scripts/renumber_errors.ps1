$base_dir = "c:\Users\HP\drips\work\Lumenpulse\apps\onchain\contracts"

$schema = @{
    "contract_registry" = 1000
    "contributor_registry" = 1100
    "cross-contract-view" = 1200
    "crowdfund_vault" = 1300
    "feature_flags" = 1400
    "lumenpulse-curation" = 1500
    "matching_pool" = 1600
    "notification_broker" = 1700
    "pricing_adapter" = 1800
    "project_registry" = 1900
    "protocol_registry" = 2000
    "treasury" = 2100
    "upgradable-contract" = 2200
    "vesting-wallet" = 2300
    "yield_vault" = 2400
}

$reference = @{}

foreach ($contract in $schema.Keys) {
    $start_code = $schema[$contract]
    $errors_path = Join-Path -Path $base_dir -ChildPath "$contract\src\errors.rs"
    
    if (-not (Test-Path $errors_path)) {
        continue
    }
    
    $content = Get-Content $errors_path
    $new_content = @()
    $current_code = $start_code
    
    foreach ($line in $content) {
        if ($line -match "^(\s+)(\w+)\s*=\s*\d+,") {
            $indent = $matches[1]
            $name = $matches[2]
            $new_line = "$indent$name = $current_code,"
            $new_content += $new_line
            
            $reference[[string]$current_code] = @{
                "contract" = $contract
                "name" = $name
                "message" = "$($contract): $($name)"
            }
            
            $current_code++
        } else {
            $new_content += $line
        }
    }
    
    $new_content | Set-Content $errors_path
}

$backend_ref_path = "c:\Users\HP\drips\work\Lumenpulse\apps\backend\src\stellar\utils\error-reference.json"
$reference | ConvertTo-Json -Depth 3 | Set-Content $backend_ref_path

Write-Host "Renumbered errors and generated reference."
