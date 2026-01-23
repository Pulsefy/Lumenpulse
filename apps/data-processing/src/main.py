import os
import sys
import logging
import signal
from dotenv import load_dotenv
from scheduler import AnalyticsScheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('./logs/data_processor.log'),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler = None


def setup_signal_handlers():
    """Setup signal handlers for graceful shutdown"""
    def signal_handler(sig, frame):
        logger.info("Received shutdown signal, cleaning up...")
        if scheduler:
            scheduler.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)


def main():
    """Main entry point"""
    load_dotenv()
    
    # Create logs directory if it doesn't exist
    os.makedirs('./logs', exist_ok=True)
    
    logger.info("=" * 70)
    logger.info("LumenPulse Data Processing Service Starting")
    logger.info("=" * 70)
    
    global scheduler
    
    try:
        # Initialize and start the scheduler
        scheduler = AnalyticsScheduler()
        setup_signal_handlers()
        
        # Option to run immediately on startup (useful for testing)
        run_on_startup = os.getenv('RUN_IMMEDIATELY', 'false').lower() == 'true'
        
        if run_on_startup:
            logger.info("Running analyzer immediately on startup...")
            scheduler.run_immediately()
        
        # Start the scheduler
        scheduler.start()
        
        logger.info("Data processing service is running. Press Ctrl+C to stop.")
        logger.info("The Market Analyzer will run automatically every hour.")
        
        # Keep the application running
        import time
        while True:
            time.sleep(1)
    
    except Exception as e:
        logger.error(f"Fatal error in data processing service: {e}", exc_info=True)
        if scheduler:
            scheduler.stop()
        sys.exit(1)


if __name__ == "__main__":
    main()
