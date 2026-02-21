"""
Integration test for the NewsDeduplicator module to simulate repeated API responses
"""

import unittest
import tempfile
import os
from datetime import datetime
from src.ingestion.news_fetcher import NewsFetcher
from src.ingestion.news_deduplicator import NewsDeduplicator


class TestNewsDeduplicationIntegration(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures before each test method."""
        # Use a temporary file for testing
        self.temp_dir = tempfile.mkdtemp()
        self.storage_path = os.path.join(self.temp_dir, "test_dedup_integration.json")
        self.deduplicator = NewsDeduplicator(
            deduplication_window_days=7, 
            storage_path=self.storage_path
        )

    def tearDown(self):
        """Clean up after each test method."""
        # Remove temporary files
        if os.path.exists(self.storage_path):
            os.remove(self.storage_path)
        os.rmdir(self.temp_dir)

    def test_simulate_repeated_api_responses(self):
        """
        Simulate repeated API responses and ensure downstream is only called once per unique article.
        """
        # Create identical articles that would simulate repeated API responses
        repeated_articles_batch_1 = [
            {
                'title': 'Bitcoin Surges Past $50,000',
                'content': 'Major rally in Bitcoin as institutional adoption continues',
                'url': 'https://example.com/bitcoin-surges',
                'source': 'CryptoNews',
                'published_at': datetime.now().isoformat()
            },
            {
                'title': 'Ethereum Network Upgrade Completed',
                'content': 'The latest Ethereum upgrade has been successfully completed',
                'url': 'https://example.com/eth-upgrade',
                'source': 'CryptoNews',
                'published_at': datetime.now().isoformat()
            },
            {
                'title': 'DeFi Sector Shows Strong Growth',
                'content': 'Decentralized finance continues to expand rapidly',
                'url': 'https://example.com/defi-growth',
                'source': 'CryptoNews',
                'published_at': datetime.now().isoformat()
            }
        ]

        repeated_articles_batch_2 = [
            {
                'title': 'Bitcoin Surges Past $50,000',  # Same as batch 1
                'content': 'Major rally in Bitcoin as institutional adoption continues',  # Same as batch 1
                'url': 'https://example.com/bitcoin-surges',  # Same as batch 1
                'source': 'CryptoNews',  # Same as batch 1
                'published_at': datetime.now().isoformat()
            },
            {
                'title': 'New Exchange Launches Spot Trading',
                'content': 'Major new exchange begins offering spot trading services',
                'url': 'https://example.com/exchange-launch',
                'source': 'CryptoNews',
                'published_at': datetime.now().isoformat()
            },
            {
                'title': 'Ethereum Network Upgrade Completed',  # Same as batch 1
                'content': 'The latest Ethereum upgrade has been successfully completed',  # Same as batch 1
                'url': 'https://example.com/eth-upgrade',  # Same as batch 1
                'source': 'CryptoNews',  # Same as batch 1
                'published_at': datetime.now().isoformat()
            }
        ]

        # Process first batch
        filtered_batch_1 = self.deduplicator.filter_duplicates(repeated_articles_batch_1)
        
        # Process second batch (should filter out duplicates)
        filtered_batch_2 = self.deduplicator.filter_duplicates(repeated_articles_batch_2)
        
        # Verify that duplicates were filtered out
        self.assertEqual(len(filtered_batch_1), 3)  # All 3 articles from batch 1 should pass through
        self.assertEqual(len(filtered_batch_2), 1)  # Only 1 new article from batch 2 should pass through
        
        # Verify that the unique articles made it through
        batch_1_titles = {article['title'] for article in filtered_batch_1}
        batch_2_titles = {article['title'] for article in filtered_batch_2}
        
        expected_batch_1 = {
            'Bitcoin Surges Past $50,000',
            'Ethereum Network Upgrade Completed',
            'DeFi Sector Shows Strong Growth'
        }
        
        expected_batch_2 = {
            'New Exchange Launches Spot Trading'  # Only the new article
        }
        
        self.assertEqual(batch_1_titles, expected_batch_1)
        self.assertEqual(batch_2_titles, expected_batch_2)
        
        # Total unique articles seen should be 4 (3 from batch 1 + 1 from batch 2)
        self.assertEqual(len(self.deduplicator.seen_hashes), 4)

    def test_deduplication_with_variations(self):
        """
        Test deduplication with slight variations in articles that should still be recognized as duplicates.
        """
        # Article with normal formatting
        original_article = {
            'title': 'Bitcoin Reaches New High',
            'content': 'Bitcoin has reached a new all-time high price.',
            'url': 'https://example.com/bitcoin-high',
            'source': 'CryptoNews',
            'published_at': datetime.now().isoformat()
        }
        
        # Same article with variations that shouldn't matter for deduplication
        variation_1 = {
            'title': 'BITCOIN REACHES NEW HIGH',  # Uppercase
            'content': 'BITCOIN HAS REACHED A NEW ALL-TIME HIGH PRICE.',  # Uppercase
            'url': 'HTTPS://EXAMPLE.COM/BITCOIN-HIGH',  # Uppercase URL
            'source': 'CRYPTONEWS',  # Uppercase
            'published_at': datetime.now().isoformat()
        }
        
        # Slightly different content (should be treated as different)
        different_article = {
            'title': 'Bitcoin Reaches New High',
            'content': 'Bitcoin has reached a new all-time high price! Investors excited.',
            'url': 'https://example.com/bitcoin-high',
            'source': 'CryptoNews',
            'published_at': datetime.now().isoformat()
        }
        
        # Process original
        result_1 = self.deduplicator.filter_duplicates([original_article])
        self.assertEqual(len(result_1), 1)
        
        # Process variation (should be filtered as duplicate)
        result_2 = self.deduplicator.filter_duplicates([variation_1])
        self.assertEqual(len(result_2), 0)  # Should be filtered out as duplicate
        
        # Process different article (should pass through)
        result_3 = self.deduplicator.filter_duplicates([different_article])
        self.assertEqual(len(result_3), 1)  # Should pass through as unique
        
        # Total unique articles should be 2
        self.assertEqual(len(self.deduplicator.seen_hashes), 2)

    def test_deduplication_window_boundary(self):
        """
        Test that the deduplication window properly manages old entries.
        """
        # Create an article
        article = {
            'title': 'Old Bitcoin News',
            'content': 'Old news about Bitcoin',
            'url': 'https://example.com/old-bitcoin',
            'source': 'OldNews',
            'published_at': datetime.now().isoformat()
        }
        
        # Add the article
        result_1 = self.deduplicator.filter_duplicates([article])
        self.assertEqual(len(result_1), 1)
        
        # Verify it's in the seen hashes
        self.assertEqual(len(self.deduplicator.seen_hashes), 1)
        
        # Try to add the same article again (should be filtered)
        result_2 = self.deduplicator.filter_duplicates([article])
        self.assertEqual(len(result_2), 0)
        
        # Verify statistics
        stats = self.deduplicator.get_statistics()
        self.assertEqual(stats['deduplication_window_days'], 7)


if __name__ == '__main__':
    unittest.main()