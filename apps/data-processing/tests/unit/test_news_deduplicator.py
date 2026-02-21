"""
Unit tests for the NewsDeduplicator module
"""

import unittest
import tempfile
import os
from datetime import datetime, timedelta
from src.ingestion.news_deduplicator import NewsDeduplicator


class TestNewsDeduplicator(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures before each test method."""
        # Use a temporary file for testing
        self.temp_dir = tempfile.mkdtemp()
        self.storage_path = os.path.join(self.temp_dir, "test_dedup.json")
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

    def test_compute_hash_different_articles(self):
        """Test that different articles produce different hashes."""
        article1 = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        article2 = {
            'title': 'Ethereum Falls',
            'content': 'Ethereum price decreases today',
            'url': 'https://example.com/ethereum-fall',
            'source': 'CryptoNews'
        }
        
        hash1 = self.deduplicator._compute_hash(article1)
        hash2 = self.deduplicator._compute_hash(article2)
        
        self.assertNotEqual(hash1, hash2)

    def test_compute_hash_similar_articles(self):
        """Test that very similar articles produce different hashes."""
        article1 = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        # Slightly different content
        article2 = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today!',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        hash1 = self.deduplicator._compute_hash(article1)
        hash2 = self.deduplicator._compute_hash(article2)
        
        self.assertNotEqual(hash1, hash2)

    def test_compute_hash_identical_articles(self):
        """Test that identical articles produce the same hash."""
        article1 = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        article2 = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        hash1 = self.deduplicator._compute_hash(article1)
        hash2 = self.deduplicator._compute_hash(article2)
        
        self.assertEqual(hash1, hash2)

    def test_is_duplicate_new_article(self):
        """Test that new articles are not marked as duplicates."""
        article = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        # Initially should not be a duplicate
        self.assertFalse(self.deduplicator.is_duplicate(article))

    def test_is_duplicate_marked_seen(self):
        """Test that articles marked as seen become duplicates."""
        article = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        # Initially not a duplicate
        self.assertFalse(self.deduplicator.is_duplicate(article))
        
        # Mark as seen
        self.deduplicator.mark_seen(article)
        
        # Now should be a duplicate
        self.assertTrue(self.deduplicator.is_duplicate(article))

    def test_filter_duplicates_no_duplicates(self):
        """Test filtering with no duplicates."""
        articles = [
            {
                'title': 'Bitcoin Rises',
                'content': 'Bitcoin price increases today',
                'url': 'https://example.com/bitcoin-rise',
                'source': 'CryptoNews'
            },
            {
                'title': 'Ethereum Falls',
                'content': 'Ethereum price decreases today',
                'url': 'https://example.com/ethereum-fall',
                'source': 'CryptoNews'
            }
        ]
        
        result = self.deduplicator.filter_duplicates(articles)
        
        self.assertEqual(len(result), 2)
        self.assertEqual(len(self.deduplicator.seen_hashes), 2)

    def test_filter_duplicates_with_duplicates(self):
        """Test filtering with duplicates."""
        original_article = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        duplicate_article = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        articles = [original_article, duplicate_article]
        
        result = self.deduplicator.filter_duplicates(articles)
        
        self.assertEqual(len(result), 1)  # Only one unique article
        self.assertEqual(len(self.deduplicator.seen_hashes), 1)  # Only one hash stored

    def test_filter_duplicates_multiple_duplicates(self):
        """Test filtering with multiple duplicates."""
        original_article = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        articles = [original_article] * 5  # Five identical articles
        
        result = self.deduplicator.filter_duplicates(articles)
        
        self.assertEqual(len(result), 1)  # Only one unique article
        self.assertEqual(len(self.deduplicator.seen_hashes), 1)  # Only one hash stored

    def test_normalization_case_insensitive(self):
        """Test that normalization is case insensitive."""
        article1 = {
            'title': 'BITCOIN RISES',
            'content': 'BITCOIN PRICE INCREASES TODAY',
            'url': 'HTTPS://EXAMPLE.COM/BITCOIN-RISE',
            'source': 'CRYPTONEWS'
        }
        
        article2 = {
            'title': 'bitcoin rises',
            'content': 'bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'cryptonews'
        }
        
        hash1 = self.deduplicator._compute_hash(article1)
        hash2 = self.deduplicator._compute_hash(article2)
        
        self.assertEqual(hash1, hash2)

    def test_get_statistics(self):
        """Test getting deduplication statistics."""
        stats = self.deduplicator.get_statistics()
        
        self.assertIn('seen_hashes_count', stats)
        self.assertIn('deduplication_window_days', stats)
        self.assertIn('cutoff_time', stats)
        self.assertIn('storage_path', stats)
        self.assertEqual(stats['deduplication_window_days'], 7)
        self.assertEqual(stats['seen_hashes_count'], 0)

    def test_storage_persistence(self):
        """Test that seen hashes are persisted to storage."""
        article = {
            'title': 'Bitcoin Rises',
            'content': 'Bitcoin price increases today',
            'url': 'https://example.com/bitcoin-rise',
            'source': 'CryptoNews'
        }
        
        # Mark as seen
        self.deduplicator.mark_seen(article)
        self.deduplicator._save_seen_hashes()
        
        # Create a new deduplicator with the same storage
        new_deduplicator = NewsDeduplicator(
            deduplication_window_days=7,
            storage_path=self.storage_path
        )
        
        # The same article should be detected as duplicate
        self.assertTrue(new_deduplicator.is_duplicate(article))


if __name__ == '__main__':
    unittest.main()