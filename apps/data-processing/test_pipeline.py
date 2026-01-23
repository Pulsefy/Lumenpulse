"""
Test and example script for the data processing service
Run this to verify all components are working correctly
"""
import sys
import os
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / 'src'))

from fetchers import NewsFetcher
from sentiment import SentimentAnalyzer
from trends import TrendCalculator
from database import DatabaseService, AnalyticsRecord
from datetime import datetime


def test_fetcher():
    """Test news fetching"""
    print("\n" + "="*60)
    print("TEST 1: News Fetcher")
    print("="*60)
    
    fetcher = NewsFetcher()
    print("Fetching news from multiple sources...")
    
    news = fetcher.fetch_all_news()
    print(f"✓ Successfully fetched {len(news)} news items")
    
    if news:
        print(f"\nSample news item:")
        print(f"  Title: {news[0].title[:60]}...")
        print(f"  Source: {news[0].source}")
        print(f"  Fetched at: {news[0].fetched_at}")
    
    return news


def test_sentiment(news_items):
    """Test sentiment analysis"""
    print("\n" + "="*60)
    print("TEST 2: Sentiment Analyzer")
    print("="*60)
    
    analyzer = SentimentAnalyzer()
    
    # Prepare texts for analysis
    texts = [f"{item.title} {item.content}" for item in news_items[:5]]
    print(f"Analyzing sentiment for {len(texts)} texts...")
    
    results = analyzer.analyze_batch(texts)
    summary = analyzer.get_sentiment_summary(results)
    
    print(f"✓ Sentiment analysis complete")
    print(f"\nSummary Statistics:")
    print(f"  Total items: {summary['total_items']}")
    print(f"  Average compound score: {summary['average_compound_score']:.4f}")
    print(f"  Positive sentiment: {summary['sentiment_distribution']['positive']:.1%}")
    print(f"  Negative sentiment: {summary['sentiment_distribution']['negative']:.1%}")
    print(f"  Neutral sentiment: {summary['sentiment_distribution']['neutral']:.1%}")
    
    return summary


def test_trends(sentiment_summary):
    """Test trend calculation"""
    print("\n" + "="*60)
    print("TEST 3: Trend Calculator")
    print("="*60)
    
    calculator = TrendCalculator()
    print("Calculating trends...")
    
    trends = calculator.calculate_all_trends(sentiment_summary)
    
    print(f"✓ Calculated {len(trends)} trends")
    for trend in trends:
        print(f"\n  Metric: {trend.metric_name}")
        print(f"    Current value: {trend.current_value}")
        print(f"    Change: {trend.change_percentage:+.2f}%")
        print(f"    Direction: {trend.trend_direction}")
    
    return trends


def test_database(news_items, sentiment_summary, trends):
    """Test database storage"""
    print("\n" + "="*60)
    print("TEST 4: Database Service")
    print("="*60)
    
    db = DatabaseService()
    print("Saving analytics to database...")
    
    record = AnalyticsRecord(
        timestamp=datetime.utcnow(),
        news_count=len(news_items),
        sentiment_data=sentiment_summary,
        trends=[trend.to_dict() for trend in trends]
    )
    
    success = db.save_analytics(record)
    
    if success:
        print("✓ Analytics saved successfully")
        
        # Verify we can read it back
        latest = db.get_latest_analytics()
        print(f"\nVerifying stored data:")
        print(f"  News count: {latest.get('news_count')}")
        print(f"  Timestamp: {latest.get('timestamp')}")
        print(f"  Trends stored: {len(latest.get('trends', []))}")
    else:
        print("✗ Failed to save analytics")
    
    return success


def run_full_pipeline():
    """Run the complete pipeline"""
    print("\n" + "="*70)
    print("FULL PIPELINE TEST: Fetch → Analyze → Calculate → Store")
    print("="*70)
    
    try:
        # Step 1: Fetch News
        news = test_fetcher()
        if not news:
            print("✗ No news items fetched, skipping remaining tests")
            return False
        
        # Step 2: Analyze Sentiment
        sentiment_summary = test_sentiment(news)
        
        # Step 3: Calculate Trends
        trends = test_trends(sentiment_summary)
        
        # Step 4: Store in Database
        success = test_database(news, sentiment_summary, trends)
        
        if success:
            print("\n" + "="*70)
            print("✓ ALL TESTS PASSED - Data processing pipeline is working!")
            print("="*70)
            print("\nNext steps:")
            print("1. Run: python src/main.py")
            print("2. Check: data/latest.json for output")
            print("3. Check: logs/data_processor.log for detailed logs")
            return True
        else:
            return False
    
    except Exception as e:
        print(f"\n✗ ERROR during pipeline test: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("\n" + "#"*70)
    print("# LumenPulse Data Processing - Component Test Suite")
    print("#"*70)
    
    # Ensure logs directory exists
    os.makedirs('./logs', exist_ok=True)
    os.makedirs('./data', exist_ok=True)
    
    success = run_full_pipeline()
    sys.exit(0 if success else 1)
