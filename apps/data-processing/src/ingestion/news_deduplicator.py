import hashlib
import json
import logging
import re
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class NewsDeduplicator:
    """
    Handles deduplication of news articles and social posts.
    Uses SHA-256 for exact matches and MinHash/LSH for fuzzy matching (near-duplicates).
    """

    def __init__(
        self,
        deduplication_window_days: int = 7,
        storage_path: str = "./data/deduplication.json",
        similarity_threshold: float = 0.85,
        num_hashes: int = 128,
        num_bands: int = 16,
    ):
        """
        Initialize the deduplicator

        Args:
            deduplication_window_days: How many days back to check for duplicates
            storage_path: Path to store seen hashes and signatures
            similarity_threshold: Jaccard similarity threshold for fuzzy matching
            num_hashes: Number of hash functions for MinHash
            num_bands: Number of bands for LSH
        """
        self.deduplication_window_days = deduplication_window_days
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)

        self.similarity_threshold = similarity_threshold
        self.num_hashes = num_hashes
        self.num_bands = num_bands
        self.rows_per_band = num_hashes // num_bands

        # Storage for exact hashes and MinHash signatures
        # {exact_hash: {"timestamp": dt, "signature": [ints], "id": str}}
        self.seen_data: Dict[str, Dict] = {}
        
        # LSH index: {band_idx: {band_hash: set(exact_hashes)}}
        self.lsh_index: List[Dict[int, Set[str]]] = [{} for _ in range(num_bands)]

        # Fixed seeds for consistent hashing across restarts
        self.hash_seeds = np.arange(num_hashes, dtype=np.uint64)

        self._load_data()

        # Calculate cutoff time for old data
        self.cutoff_time = datetime.now(timezone.utc) - timedelta(
            days=self.deduplication_window_days
        )

        # Clean up old data
        self._cleanup_old_data()

        logger.info(
            f"Initialized NewsDeduplicator with window of {deduplication_window_days} days. "
            f"Fuzzy threshold: {similarity_threshold}"
        )

    def _normalize_text(self, text: str) -> str:
        """Normalize text for consistent comparison"""
        if not text:
            return ""
        text = text.lower()
        # Remove URLs from text to focus on content
        text = re.sub(r"http\S+|www\S+|https\S+", "", text, flags=re.MULTILINE)
        # Remove mentions and hashtags for social posts
        text = re.sub(r"@\w+|#\w+", "", text)
        # Keep only alphanumeric and spaces
        text = re.sub(r"[^\w\s]", "", text)
        # Collapse whitespace
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _normalize_url(self, url: str) -> str:
        """Normalize URL by removing tracking parameters and fragments"""
        if not url:
            return ""
        try:
            parsed = urllib.parse.urlparse(url)
            # Remove tracking params
            query = urllib.parse.parse_qs(parsed.query)
            clean_query = {
                k: v
                for k, v in query.items()
                if not (k.startswith("utm_") or k in ["ref", "source", "medium"])
            }
            new_query = urllib.parse.urlencode(clean_query, doseq=True)

            # Rebuild URL without fragment and with normalized path
            return urllib.parse.urlunparse(
                (
                    parsed.scheme.lower(),
                    parsed.netloc.lower(),
                    parsed.path.rstrip("/"),
                    parsed.params,
                    new_query,
                    "",  # Remove fragment
                )
            )
        except Exception:
            return url.strip().lower()

    def _get_shingles(self, text: str, k: int = 5) -> Set[str]:
        """Convert text into k-shingles (character n-grams)"""
        if len(text) < k:
            return {text} if text else set()
        return {text[i : i + k] for i in range(len(text) - k + 1)}

    def _compute_minhash(self, shingles: Set[str]) -> np.ndarray:
        """Compute MinHash signature for a set of shingles"""
        if not shingles:
            return np.full(self.num_hashes, 2**32 - 1, dtype=np.uint64)

        # Hash shingles once
        shingle_hashes = np.array(
            [
                int(hashlib.md5(s.encode("utf-8")).hexdigest()[:8], 16)
                for s in shingles
            ],
            dtype=np.uint64,
        )

        # Generate signature using XOR with seeds as a simple family of hash functions
        # For a more robust implementation, we could use (a*x + b) % p
        signature = np.full(self.num_hashes, 2**64 - 1, dtype=np.uint64)
        
        for i in range(self.num_hashes):
            # XOR shingle hashes with a seed and take the minimum
            xor_hashes = np.bitwise_xor(shingle_hashes, self.hash_seeds[i])
            signature[i] = np.min(xor_hashes)

        return signature

    def _get_band_hashes(self, signature: np.ndarray) -> List[int]:
        """Compute hashes for each band in the signature"""
        band_hashes = []
        for b in range(self.num_bands):
            band = signature[b * self.rows_per_band : (b + 1) * self.rows_per_band]
            # Hash the band to an integer
            band_hash = hash(tuple(band))
            band_hashes.append(band_hash)
        return band_hashes

    def _load_data(self):
        """Load previously seen data from storage"""
        if self.storage_path.exists():
            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                for exact_hash, entry in data.items():
                    try:
                        timestamp_str = entry["timestamp"]
                        if timestamp_str.endswith("+00:00"):
                            timestamp = datetime.fromisoformat(timestamp_str)
                        else:
                            timestamp = datetime.fromisoformat(
                                timestamp_str.replace("Z", "+00:00")
                            )
                        
                        entry["timestamp"] = timestamp
                        # Signature is stored as list of ints, convert to numpy array
                        if "signature" in entry:
                            signature = np.array(entry["signature"], dtype=np.uint64)
                            entry["signature"] = signature
                            # Re-index into LSH
                            band_hashes = self._get_band_hashes(signature)
                            for i, bh in enumerate(band_hashes):
                                if bh not in self.lsh_index[i]:
                                    self.lsh_index[i][bh] = set()
                                self.lsh_index[i][bh].add(exact_hash)
                        
                        self.seen_data[exact_hash] = entry
                    except (ValueError, KeyError) as e:
                        logger.warning(f"Invalid entry format for hash {exact_hash}: {e}")

                logger.info(f"Loaded {len(self.seen_data)} previously seen entries")
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Error loading seen data from {self.storage_path}: {e}")
                self.seen_data = {}

    def _save_data(self):
        """Save seen data to storage"""
        try:
            serializable_data = {}
            for exact_hash, entry in self.seen_data.items():
                serializable_entry = entry.copy()
                serializable_entry["timestamp"] = entry["timestamp"].isoformat()
                if "signature" in entry:
                    serializable_entry["signature"] = entry["signature"].tolist()
                serializable_data[exact_hash] = serializable_entry

            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump(serializable_data, f, indent=2)

        except IOError as e:
            logger.error(f"Error saving seen data to {self.storage_path}: {e}")

    def _cleanup_old_data(self):
        """Remove data older than the deduplication window"""
        old_count = len(self.seen_data)
        self.seen_data = {
            exact_hash: entry
            for exact_hash, entry in self.seen_data.items()
            if entry["timestamp"] > self.cutoff_time
        }
        removed_count = old_count - len(self.seen_data)

        if removed_count > 0:
            # Rebuild LSH index after cleanup
            self.lsh_index = [{} for _ in range(self.num_bands)]
            for exact_hash, entry in self.seen_data.items():
                if "signature" in entry:
                    band_hashes = self._get_band_hashes(entry["signature"])
                    for i, bh in enumerate(band_hashes):
                        if bh not in self.lsh_index[i]:
                            self.lsh_index[i][bh] = set()
                        self.lsh_index[i][bh].add(exact_hash)
            
            logger.info(
                f"Removed {removed_count} old entries outside the {self.deduplication_window_days}-day window"
            )

    def _jaccard_similarity(self, sig1: np.ndarray, sig2: np.ndarray) -> float:
        """Estimate Jaccard similarity between two MinHash signatures"""
        return np.mean(sig1 == sig2)

    def is_duplicate(self, article: Dict) -> Tuple[bool, Optional[str]]:
        """
        Check if an article is a duplicate (exact or near-duplicate)

        Args:
            article: Article to check

        Returns:
            Tuple (is_duplicate, duplicate_id)
        """
        # 1. Exact match check (URL or exact content hash)
        url = self._normalize_url(article.get("url", ""))
        content = self._normalize_text(article.get("content") or article.get("title") or "")
        
        # We'll use a combined hash for exact matching
        exact_hash_data = f"{url}|{content}"
        exact_hash = hashlib.sha256(exact_hash_data.encode("utf-8")).hexdigest()

        if exact_hash in self.seen_data:
            return True, self.seen_data[exact_hash].get("id")

        # 2. Fuzzy match check using LSH
        shingles = self._get_shingles(content)
        if not shingles:
            return False, None
            
        signature = self._compute_minhash(shingles)
        band_hashes = self._get_band_hashes(signature)
        
        candidates = set()
        for i, bh in enumerate(band_hashes):
            if bh in self.lsh_index[i]:
                candidates.update(self.lsh_index[i][bh])
        
        for cand_hash in candidates:
            cand_entry = self.seen_data.get(cand_hash)
            if cand_entry and "signature" in cand_entry:
                similarity = self._jaccard_similarity(signature, cand_entry["signature"])
                if similarity >= self.similarity_threshold:
                    logger.info(f"Fuzzy match detected! Similarity: {similarity:.2f}")
                    return True, cand_entry.get("id")

        return False, None

    def mark_seen(self, article: Dict):
        """Mark an article as seen"""
        url = self._normalize_url(article.get("url", ""))
        content = self._normalize_text(article.get("content") or article.get("title") or "")
        
        exact_hash_data = f"{url}|{content}"
        exact_hash = hashlib.sha256(exact_hash_data.encode("utf-8")).hexdigest()
        
        shingles = self._get_shingles(content)
        signature = self._compute_minhash(shingles)
        
        self.seen_data[exact_hash] = {
            "timestamp": datetime.now(timezone.utc),
            "signature": signature,
            "id": article.get("id"),
            "url": url
        }
        
        # Update LSH index
        band_hashes = self._get_band_hashes(signature)
        for i, bh in enumerate(band_hashes):
            if bh not in self.lsh_index[i]:
                self.lsh_index[i][bh] = set()
            self.lsh_index[i][bh].add(exact_hash)

    def filter_duplicates(self, articles: List[Dict]) -> List[Dict]:
        """Filter out duplicate articles from a list"""
        filtered_articles = []
        duplicates_found = 0

        for article in articles:
            is_dup, _ = self.is_duplicate(article)
            if not is_dup:
                self.mark_seen(article)
                filtered_articles.append(article)
            else:
                duplicates_found += 1

        if duplicates_found > 0:
            logger.info(f"Filtered out {duplicates_found} duplicate articles/posts")

        # Save updated data to storage
        self._save_data()

        return filtered_articles

    def get_statistics(self) -> Dict:
        """Get statistics about the deduplication process"""
        return {
            "seen_entries_count": len(self.seen_data),
            "deduplication_window_days": self.deduplication_window_days,
            "fuzzy_threshold": self.similarity_threshold,
            "storage_path": str(self.storage_path),
        }