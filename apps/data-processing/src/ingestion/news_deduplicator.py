"""
News deduplication module - removes duplicate articles to prevent re-processing
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Set
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class NewsDeduplicator:
    """
    Handles deduplication of news articles to prevent re-processing of the same content.
    Uses SHA-256 hashing of normalized content to identify duplicates.
    """

    def __init__(self, deduplication_window_days: int = 7, storage_path: str = "./data/deduplication.json"):
        """
        Initialize the deduplicator
        
        Args:
            deduplication_window_days: How many days back to check for duplicates
            storage_path: Path to store seen hashes
        """
        self.deduplication_window_days = deduplication_window_days
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Load existing hashes
        self.seen_hashes: Dict[str, datetime] = {}
        self._load_seen_hashes()
        
        # Calculate cutoff time for old hashes
        self.cutoff_time = datetime.now(timezone.utc) - timedelta(days=self.deduplication_window_days)
        
        # Clean up old hashes periodically
        self._cleanup_old_hashes()
        
        logger.info(f"Initialized NewsDeduplicator with window of {deduplication_window_days} days")

    def _normalize_article(self, article: Dict) -> str:
        """
        Normalize article content for consistent hashing
        
        Args:
            article: Article dictionary to normalize
            
        Returns:
            Normalized string representation of the article
        """
        # Extract and normalize key fields
        title = (article.get('title') or '').strip().lower()
        content = (article.get('content') or '').strip().lower()
        url = (article.get('url') or '').strip().lower()
        
        # Create a canonical representation
        canonical_data = {
            'title': title,
            'content': content,
            'url': url,
            'source': (article.get('source') or '').strip().lower(),
        }
        
        # Convert to JSON string for consistent hashing
        return json.dumps(canonical_data, sort_keys=True, separators=(',', ':'))

    def _compute_hash(self, article: Dict) -> str:
        """
        Compute SHA-256 hash for an article
        
        Args:
            article: Article dictionary to hash
            
        Returns:
            SHA-256 hash as hex string
        """
        normalized_content = self._normalize_article(article)
        return hashlib.sha256(normalized_content.encode('utf-8')).hexdigest()

    def _load_seen_hashes(self):
        """Load previously seen hashes from storage"""
        if self.storage_path.exists():
            try:
                with open(self.storage_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                for hash_str, timestamp_str in data.items():
                    try:
                        if timestamp_str.endswith('+00:00'):
                            timestamp = datetime.fromisoformat(timestamp_str)
                        else:
                            # Handle naive datetime by assuming UTC
                            dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                            timestamp = dt
                        self.seen_hashes[hash_str] = timestamp
                    except ValueError:
                        logger.warning(f"Invalid timestamp format for hash {hash_str}: {timestamp_str}")
                        
                logger.info(f"Loaded {len(self.seen_hashes)} previously seen hashes")
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Error loading seen hashes from {self.storage_path}: {e}")
                self.seen_hashes = {}

    def _save_seen_hashes(self):
        """Save seen hashes to storage"""
        try:
            # Convert datetime objects to ISO format strings
            data = {
                hash_str: timestamp.isoformat()
                for hash_str, timestamp in self.seen_hashes.items()
            }
            
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
                
        except IOError as e:
            logger.error(f"Error saving seen hashes to {self.storage_path}: {e}")

    def _cleanup_old_hashes(self):
        """Remove hashes older than the deduplication window"""
        old_count = len(self.seen_hashes)
        self.seen_hashes = {
            hash_str: timestamp 
            for hash_str, timestamp in self.seen_hashes.items() 
            if timestamp > self.cutoff_time
        }
        removed_count = old_count - len(self.seen_hashes)
        
        if removed_count > 0:
            logger.info(f"Removed {removed_count} old hashes outside the {self.deduplication_window_days}-day window")

    def is_duplicate(self, article: Dict) -> bool:
        """
        Check if an article is a duplicate
        
        Args:
            article: Article to check
            
        Returns:
            True if the article is a duplicate, False otherwise
        """
        article_hash = self._compute_hash(article)
        return article_hash in self.seen_hashes

    def mark_seen(self, article: Dict):
        """
        Mark an article as seen (add its hash to the seen set)
        
        Args:
            article: Article to mark as seen
        """
        article_hash = self._compute_hash(article)
        self.seen_hashes[article_hash] = datetime.now(timezone.utc)

    def filter_duplicates(self, articles: List[Dict]) -> List[Dict]:
        """
        Filter out duplicate articles from a list
        
        Args:
            articles: List of articles to filter
            
        Returns:
            List of articles with duplicates removed
        """
        filtered_articles = []
        duplicates_found = 0
        
        for article in articles:
            if not self.is_duplicate(article):
                self.mark_seen(article)
                filtered_articles.append(article)
            else:
                duplicates_found += 1
                
        if duplicates_found > 0:
            logger.info(f"Filtered out {duplicates_found} duplicate articles")
            
        # Save updated hashes to storage
        self._save_seen_hashes()
        
        return filtered_articles

    def get_statistics(self) -> Dict:
        """
        Get statistics about the deduplication process
        
        Returns:
            Dictionary with deduplication statistics
        """
        return {
            'seen_hashes_count': len(self.seen_hashes),
            'deduplication_window_days': self.deduplication_window_days,
            'cutoff_time': self.cutoff_time.isoformat(),
            'storage_path': str(self.storage_path),
        }