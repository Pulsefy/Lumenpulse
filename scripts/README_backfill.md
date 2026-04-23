# Historical Backfill Script

## Overview

The `backfill.py` script populates historical data for the LumenPulse analytics pipeline, ensuring fresh deployments have populated charts and analytics data.

## Features

- **Flexible Time Range**: Backfill last N days of historical data
- **Dry Run Mode**: Test operations without executing data fetching
- **Existing Integration**: Reuses current fetchers and analyzers
- **Comprehensive Processing**: Handles both news and on-chain data
- **Progress Tracking**: Detailed logging and success rate reporting

## Usage

### Basic Usage

```bash
# Backfill last 7 days
python scripts/backfill.py --days 7

# Backfill last 30 days
python scripts/backfill.py --days 30
```

### Dry Run Mode

```bash
# Test what would be processed without actual API calls
python scripts/backfill.py --days 7 --dry-run
```

### Verbose Output

```bash
# Enable detailed logging
python scripts/backfill.py --days 3 --verbose
```

## Command Line Options

- `--days DAYS`: **Required**. Number of days to backfill (e.g., 7 for last week)
- `--dry-run`: Optional. Print planned operations without executing them
- `--verbose, -v`: Optional. Enable verbose logging output
- `--help, -h`: Show help message

## Output

The script processes data in 24-hour windows for each day and provides:

### Real-time Progress
- Current day being processed
- News articles found
- XLM volume data
- Market analysis results

### Final Summary
- Total periods processed
- Success/failure counts
- Success rate percentage
- Total news articles processed
- Total XLM volume
- Average volume per day

## Data Sources

The script integrates with existing pipeline components:

### News Data
- Uses `src.ingestion.news_fetcher.fetch_news()`
- Fetches from CoinGecko API and mock market feeds
- Filters articles by date range for each 24-hour window

### On-chain Data
- Uses `src.ingestion.stellar_fetcher.get_asset_volume()`
- Fetches XLM trading volume from Stellar Horizon API
- Gets network statistics and transaction data

### Market Analysis
- Uses `src.analytics.market_analyzer.MarketAnalyzer`
- Calculates trend analysis and health scores
- Generates market explanations

## Environment Setup

### Required Environment Variables
```bash
# For news fetching (CoinGecko API)
CRYPTOCOMPARE_API_KEY=your_api_key_here

# Optional: Stellar Horizon endpoint (defaults to mainnet)
STELLAR_HORIZON_URL=https://horizon.stellar.org
```

### Python Dependencies
The script uses existing pipeline dependencies:
- `requests` - HTTP client for API calls
- `stellar-sdk` - Stellar blockchain integration
- `python-dotenv` - Environment variable management

## Examples

### Fresh Deployment Backfill
```bash
# After deploying to new environment, backfill last week
python scripts/backfill.py --days 7 --verbose
```

### Testing Configuration
```bash
# Test script configuration without API calls
python scripts/backfill.py --days 3 --dry-run --verbose
```

### Large Historical Backfill
```bash
# Backfill last month (may take significant time)
python scripts/backfill.py --days 30
```

## Error Handling

The script includes comprehensive error handling:

- **API Failures**: Graceful degradation with logging
- **Missing Dependencies**: Clear error messages for setup issues
- **Rate Limiting**: Built-in delays to respect API limits
- **Data Validation**: Filters invalid or incomplete data

## Integration with Pipeline

The backfill script is designed to complement the existing analytics pipeline:

1. **Data Sources**: Reuses existing fetchers (`news_fetcher`, `stellar_fetcher`)
2. **Processing**: Uses same analyzers (`market_analyzer`)
3. **Output Format**: Compatible with existing data structures
4. **Logging**: Follows pipeline logging patterns

## Performance Considerations

- **API Rate Limits**: Built-in delays between requests
- **Memory Usage**: Processes one day at a time
- **Network Calls**: Minimizes redundant requests
- **Error Recovery**: Retry logic for transient failures

## Troubleshooting

### Common Issues

1. **Missing API Key**
   ```
   Error: CRYPTOCOMPARE_API_KEY environment variable not set
   ```
   Solution: Set the environment variable or use --dry-run

2. **Network Connectivity**
   ```
   Error: Connection timeout during news fetching
   ```
   Solution: Check internet connection and API status

3. **Import Errors**
   ```
   ModuleNotFoundError: No module named 'stellar_sdk'
   ```
   Solution: Install dependencies: `pip install -r requirements.txt`

### Debug Mode

Use `--verbose` flag for detailed debugging information:
- API request/response details
- Data processing steps
- Error stack traces
- Performance timing

## File Structure

```
scripts/
├── backfill.py              # Main backfill script
├── README_backfill.md       # This documentation
└── .env.example            # Environment variable template
```

The script integrates with the existing data processing pipeline:
```
apps/data-processing/src/
├── ingestion/
│   ├── news_fetcher.py      # News data sources
│   └── stellar_fetcher.py  # On-chain data
└── analytics/
    └── market_analyzer.py    # Market analysis
```
