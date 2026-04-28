import unittest
from datetime import datetime, timezone
import numpy as np
import os
import shutil
import sys
from unittest.mock import MagicMock
import importlib.util

# Load NewsDeduplicator directly from file to bypass src.ingestion.__init__ dependencies
spec = importlib.util.spec_from_file_location(
    "news_deduplicator", 
    "src/ingestion/news_deduplicator.py"
)
news_deduplicator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news_deduplicator)
NewsDeduplicator = news_deduplicator.NewsDeduplicator

class TestRobustDeduplication(unittest.TestCase):
    def setUp(self):
        self.test_storage = "./data/test_deduplication.json"
        if os.path.exists("./data"):
            if os.path.exists(self.test_storage):
                os.remove(self.test_storage)
        else:
            os.makedirs("./data")
            
        self.deduplicator = NewsDeduplicator(
            storage_path=self.test_storage,
            similarity_threshold=0.85
        )

    def tearDown(self):
        if os.path.exists(self.test_storage):
            os.remove(self.test_storage)

    def test_exact_duplicate(self):
        article = {
            "id": "1",
            "title": "Bitcoin Hits $100k",
            "content": "Bitcoin has finally reached the milestone of $100,000 per coin.",
            "url": "https://crypto.com/news/1"
        }
        
        self.deduplicator.mark_seen(article)
        is_dup, dup_id = self.deduplicator.is_duplicate(article)
        
        self.assertTrue(is_dup)
        self.assertEqual(dup_id, "1")

    def test_near_duplicate(self):
        article1 = {
            "id": "1",
            "title": "Bitcoin Hits $100k",
            "content": "Bitcoin has finally reached the milestone of $100,000 per coin today in a historic move.",
            "url": "https://crypto.com/news/1"
        }
        
        # Slightly modified content
        article2 = {
            "id": "2",
            "title": "BTC at 100k",
            "content": "Bitcoin has finally reached the milestone of $100,000 per coin today in a historic move!",
            "url": "https://other-news.com/btc"
        }
        
        self.deduplicator.mark_seen(article1)
        is_dup, _ = self.deduplicator.is_duplicate(article2)
        
        self.assertTrue(is_dup, "Should detect near-duplicate content")

    def test_syndicated_content(self):
        article1 = {
            "id": "1",
            "title": "Stellar Network Update",
            "content": "The Stellar Development Foundation announced a major update to the network protocols.",
            "url": "https://sdf.org/update"
        }
        
        article2 = {
            "id": "2",
            "title": "Stellar Network Update",
            "content": "The Stellar Development Foundation announced a major update to the network protocols.",
            "url": "https://repost.com/stellar-update"
        }
        
        self.deduplicator.mark_seen(article1)
        is_dup, _ = self.deduplicator.is_duplicate(article2)
        
        self.assertTrue(is_dup, "Should detect syndicated content with same text but different URL")

    def test_social_post_near_duplicate(self):
        post1 = {
            "id": "tweet1",
            "content": "Wow, Stellar is pumping! #XLM #Stellar @StellarOrg",
            "url": "https://twitter.com/user1/status/1"
        }
        
        post2 = {
            "id": "tweet2",
            "content": "Wow, Stellar is pumping! #Crypto #Lumen @LumenPulse",
            "url": "https://twitter.com/user2/status/2"
        }
        
        self.deduplicator.mark_seen(post1)
        is_dup, _ = self.deduplicator.is_duplicate(post2)
        
        # Both should normalize to "wow stellar is pumping"
        self.assertTrue(is_dup, "Should detect social posts with same core message but different tags/mentions")

    def test_url_normalization(self):
        article1 = {
            "id": "1",
            "url": "https://news.com/article?utm_source=twitter&utm_medium=social"
        }
        
        article2 = {
            "id": "2",
            "url": "https://news.com/article/?ref=newsletter"
        }
        
        self.deduplicator.mark_seen(article1)
        is_dup, _ = self.deduplicator.is_duplicate(article2)
        
        self.assertTrue(is_dup, "Should detect same URL despite different tracking parameters")

    def test_persistence(self):
        article = {
            "id": "persist1",
            "title": "Persistence Test",
            "content": "This content should be saved and loaded correctly.",
            "url": "https://test.com/persist"
        }
        
        self.deduplicator.mark_seen(article)
        self.deduplicator._save_data()
        
        # Create new instance and load
        new_deduplicator = NewsDeduplicator(storage_path=self.test_storage)
        is_dup, _ = new_deduplicator.is_duplicate(article)
        
        self.assertTrue(is_dup, "Should persist data between instances")

if __name__ == "__main__":
    unittest.main()
