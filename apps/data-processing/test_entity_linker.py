#!/usr/bin/env python3
"""
Test script for the Entity Linker functionality
"""

import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Add src to path
sys.path.insert(0, 'src')

from src.analytics.entity_linker import EntityLinker, measure_precision


def test_entity_linker():
    """Test the entity linker functionality"""
    logger.info("=" * 60)
    logger.info("Testing Entity Linker")
    logger.info("=" * 60)
    
    # Test entity linking directly
    entity_linker = EntityLinker()
    
    test_text = "Stellar Development Foundation (SDF) announces new Soroban upgrade. XLM price surges."
    linked_entities = entity_linker.link_text(test_text)
    
    logger.info(f"\nTest text: {test_text}")
    logger.info(f"Linked entities:")
    for entity in linked_entities:
        logger.info(f"  - {entity.name} ({entity.entity_type}), stable ID: {entity.stable_id}")
    
    # Test precision measurement
    logger.info("\n" + "=" * 60)
    logger.info("Measuring Entity Linker Precision")
    logger.info("=" * 60)
    
    metrics = measure_precision(entity_linker)
    logger.info(f"Precision: {metrics['precision']:.4f}")
    logger.info(f"Recall: {metrics['recall']:.4f}")
    logger.info(f"F1 Score: {metrics['f1']:.4f}")
    logger.info(f"True Positives: {metrics['true_positives']}")
    logger.info(f"False Positives: {metrics['false_positives']}")
    logger.info(f"Total Expected: {metrics['total_expected']}")


if __name__ == "__main__":
    test_entity_linker()
