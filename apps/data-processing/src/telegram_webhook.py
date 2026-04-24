"""
Telegram Webhook Service - Handles incoming updates and commands

This module provides the webhook polling service for receiving Telegram updates
and processing them through the InteractiveAlertBot.
"""

import os
import time
import logging
import threading
from typing import Optional, Dict, Any, Callable
from datetime import datetime, timezone

import requests
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel

from .interactive_alertbot import InteractiveAlertBot

logger = logging.getLogger(__name__)


class TelegramUpdate(BaseModel):
    """Pydantic model for Telegram update validation"""
    update_id: int
    message: Optional[Dict[str, Any]] = None
    callback_query: Optional[Dict[str, Any]] = None


class TelegramWebhookService:
    """
    Service for handling Telegram webhook updates and polling.
    
    Supports both webhook and polling modes for receiving updates.
    """

    def __init__(
        self,
        bot: InteractiveAlertBot,
        webhook_url: Optional[str] = None,
        polling_interval: int = 30,
        max_retries: int = 3,
    ):
        """
        Initialize Telegram webhook service.
        
        Args:
            bot: InteractiveAlertBot instance
            webhook_url: Optional webhook URL for FastAPI integration
            polling_interval: Polling interval in seconds (for polling mode)
            max_retries: Maximum retry attempts for API calls
        """
        self.bot = bot
        self.webhook_url = webhook_url
        self.polling_interval = polling_interval
        self.max_retries = max_retries
        self.polling_active = False
        self.polling_thread = None
        self.last_update_id = 0
        
        # Telegram API configuration
        self.api_base_url = f"https://api.telegram.org/bot{self.bot.bot_token}/"
        self.request_timeout = 30

    def setup_webhook(self, webhook_url: str) -> bool:
        """
        Set up Telegram webhook for receiving updates.
        
        Args:
            webhook_url: URL where Telegram will send updates
            
        Returns:
            True if webhook was set up successfully, False otherwise
        """
        try:
            payload = {
                "url": webhook_url,
                "allowed_updates": ["message", "callback_query"],
                "drop_pending_updates": True
            }
            
            response = self._make_api_request("setWebhook", payload)
            
            if response and response.get("ok"):
                logger.info(f"Webhook set up successfully: {webhook_url}")
                return True
            else:
                error_desc = response.get("description", "Unknown error") if response else "No response"
                logger.error(f"Failed to set webhook: {error_desc}")
                return False
                
        except Exception as e:
            logger.error(f"Error setting webhook: {e}")
            return False

    def delete_webhook(self) -> bool:
        """Delete Telegram webhook and switch back to polling."""
        try:
            response = self._make_api_request("deleteWebhook")
            
            if response and response.get("ok"):
                logger.info("Webhook deleted successfully")
                return True
            else:
                error_desc = response.get("description", "Unknown error") if response else "No response"
                logger.error(f"Failed to delete webhook: {error_desc}")
                return False
                
        except Exception as e:
            logger.error(f"Error deleting webhook: {e}")
            return False

    def start_polling(self) -> None:
        """Start polling for Telegram updates in a background thread."""
        if self.polling_active:
            logger.warning("Polling is already active")
            return

        # Delete any existing webhook
        self.delete_webhook()
        
        self.polling_active = True
        self.polling_thread = threading.Thread(target=self._polling_loop, daemon=True)
        self.polling_thread.start()
        
        logger.info(f"Started Telegram polling with {self.polling_interval}s interval")

    def stop_polling(self) -> None:
        """Stop polling for Telegram updates."""
        if not self.polling_active:
            return

        self.polling_active = False
        
        if self.polling_thread and self.polling_thread.is_alive():
            self.polling_thread.join(timeout=5)
        
        logger.info("Stopped Telegram polling")

    def _polling_loop(self) -> None:
        """Main polling loop that runs in background thread."""
        logger.info("Telegram polling loop started")
        
        while self.polling_active:
            try:
                # Get updates from Telegram
                updates = self._get_updates()
                
                if updates:
                    for update in updates:
                        try:
                            # Process update through bot
                            success = self.bot.process_update(update)
                            
                            if success:
                                self.last_update_id = update.get("update_id", 0)
                                logger.debug(f"Processed update {self.last_update_id}")
                            else:
                                logger.warning(f"Failed to process update {update.get('update_id')}")
                                
                        except Exception as e:
                            logger.error(f"Error processing update {update.get('update_id')}: {e}")
                
                # Sleep before next poll
                time.sleep(self.polling_interval)
                
            except Exception as e:
                logger.error(f"Error in polling loop: {e}")
                time.sleep(self.polling_interval)

        logger.info("Telegram polling loop ended")

    def _get_updates(self) -> Optional[list]:
        """Get updates from Telegram API."""
        try:
            payload = {
                "offset": self.last_update_id + 1,
                "limit": 100,  # Maximum number of updates to retrieve
                "timeout": 30,  # Long polling timeout
                "allowed_updates": ["message", "callback_query"]
            }
            
            response = self._make_api_request("getUpdates", payload)
            
            if response and response.get("ok"):
                updates = response.get("result", [])
                if updates:
                    logger.debug(f"Received {len(updates)} updates")
                return updates
            else:
                error_desc = response.get("description", "Unknown error") if response else "No response"
                logger.error(f"Failed to get updates: {error_desc}")
                return None
                
        except Exception as e:
            logger.error(f"Error getting updates: {e}")
            return None

    def _make_api_request(self, method: str, payload: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """Make request to Telegram Bot API with retry logic."""
        url = f"{self.api_base_url}{method}"
        
        for attempt in range(self.max_retries + 1):
            try:
                response = requests.post(
                    url, 
                    json=payload or {}, 
                    timeout=self.request_timeout
                )

                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 429:
                    # Rate limited
                    retry_after = response.json().get("parameters", {}).get("retry_after", 5)
                    logger.warning(f"Rate limited by Telegram, waiting {retry_after}s")
                    time.sleep(retry_after)
                    continue
                else:
                    error_desc = response.json().get("description", "Unknown error") if response.content else "HTTP error"
                    logger.error(f"Telegram API error ({response.status_code}): {error_desc}")
                    return None

            except requests.exceptions.RequestException as e:
                logger.error(f"Request error for {method}: {e}")
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                else:
                    return None

        return None

    def process_webhook_update(self, update: Dict[str, Any]) -> bool:
        """
        Process a webhook update (called by FastAPI endpoint).
        
        Args:
            update: Telegram update data
            
        Returns:
            True if update was processed successfully, False otherwise
        """
        try:
            return self.bot.process_update(update)
        except Exception as e:
            logger.error(f"Error processing webhook update: {e}")
            return False

    def get_webhook_info(self) -> Optional[Dict[str, Any]]:
        """Get current webhook information from Telegram."""
        try:
            response = self._make_api_request("getWebhookInfo")
            
            if response and response.get("ok"):
                return response.get("result", {})
            else:
                return None
                
        except Exception as e:
            logger.error(f"Error getting webhook info: {e}")
            return None

    def get_bot_info(self) -> Optional[Dict[str, Any]]:
        """Get bot information from Telegram."""
        try:
            response = self._make_api_request("getMe")
            
            if response and response.get("ok"):
                return response.get("result", {})
            else:
                return None
                
        except Exception as e:
            logger.error(f"Error getting bot info: {e}")
            return None


def create_fastapi_app(webhook_service: TelegramWebhookService) -> FastAPI:
    """
    Create FastAPI application for Telegram webhook handling.
    
    Args:
        webhook_service: TelegramWebhookService instance
        
    Returns:
        FastAPI application instance
    """
    app = FastAPI(title="LumenPulse Telegram Bot Webhook")

    @app.post("/webhook")
    async def webhook_endpoint(request: Request):
        """Handle incoming Telegram webhook updates."""
        try:
            # Get update data
            update_data = await request.json()
            
            # Process update
            success = webhook_service.process_webhook_update(update_data)
            
            if success:
                return {"status": "ok"}
            else:
                raise HTTPException(status_code=500, detail="Failed to process update")
                
        except Exception as e:
            logger.error(f"Webhook error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/webhook/status")
    async def webhook_status():
        """Get webhook status."""
        webhook_info = webhook_service.get_webhook_info()
        bot_info = webhook_service.get_bot_info()
        
        return {
            "webhook": webhook_info,
            "bot": bot_info,
            "polling_active": webhook_service.polling_active,
            "last_update_id": webhook_service.last_update_id,
        }

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

    return app


# Example usage and main function for standalone operation
def main():
    """Main function for running the webhook service standalone."""
    import uvicorn
    from .database import DatabaseService
    from .sentiment import MarketAnalyzer
    from .trends import TrendAnalyzer

    # Initialize services
    database_service = DatabaseService()
    market_analyzer = MarketAnalyzer()
    trend_analyzer = TrendAnalyzer()
    
    # Initialize bot
    bot = InteractiveAlertBot(
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
        database_service=database_service,
        market_analyzer=market_analyzer,
        trend_analyzer=trend_analyzer,
    )

    # Initialize webhook service
    webhook_service = TelegramWebhookService(
        bot=bot,
        webhook_url=os.getenv("TELEGRAM_WEBHOOK_URL"),
    )

    # Choose mode based on environment
    webhook_url = os.getenv("TELEGRAM_WEBHOOK_URL")
    
    if webhook_url:
        # Webhook mode
        app = create_fastapi_app(webhook_service)
        
        # Set up webhook
        if webhook_service.setup_webhook(webhook_url):
            logger.info(f"Starting webhook server on {webhook_url}")
            uvicorn.run(app, host="0.0.0.0", port=8000)
        else:
            logger.error("Failed to set up webhook")
    else:
        # Polling mode
        logger.info("Starting polling mode")
        webhook_service.start_polling()
        
        try:
            # Keep main thread alive
            while True:
                time.sleep(60)
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            webhook_service.stop_polling()


if __name__ == "__main__":
    main()
