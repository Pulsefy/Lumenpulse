import os
import logging
from typing import Optional
from stellar_sdk import Keypair, Server
from stellar_sdk.exceptions import NotFoundError

logger = logging.getLogger(__name__)

class KeeperIdentity:
    """
    Manages the identity and signing capabilities of the pipeline's 'Keeper' account.
    """
    
    MIN_BALANCE_THRESHOLD = 5.0  # Minimum XLM balance required
    
    def __init__(self, secret_key: Optional[str] = None, horizon_url: str = "https://horizon.stellar.org"):
        self.secret_key = secret_key or os.getenv("KEEPER_SECRET")
        self.horizon_url = horizon_url
        self.keypair: Optional[Keypair] = None
        self.account_id: Optional[str] = None
        
    def load_identity(self) -> bool:
        """
        Loads the signing keypair from environment variables.
        """
        if not self.secret_key:
            logger.error("KEEPER_SECRET environment variable is not set.")
            return False
            
        try:
            self.keypair = Keypair.from_secret(self.secret_key)
            self.account_id = self.keypair.public_key
            logger.info(f"Loaded Keeper identity: {self.account_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to load Keeper identity from secret: {e}")
            return False

    def validate_on_chain(self) -> bool:
        """
        Validates that the account exists on-chain and has sufficient balance.
        """
        if not self.account_id:
            logger.error("Identity not loaded. Call load_identity() first.")
            return False
            
        server = Server(self.horizon_url)
        try:
            account = server.accounts().account_id(self.account_id).call()
            
            # Check XLM balance
            xlm_balance = 0.0
            for balance in account.get("balances", []):
                if balance.get("asset_type") == "native":
                    xlm_balance = float(balance.get("balance", "0"))
                    break
            
            logger.info(f"Keeper account balance: {xlm_balance} XLM")
            
            if xlm_balance < self.MIN_BALANCE_THRESHOLD:
                logger.warning(
                    f"Keeper balance ({xlm_balance} XLM) is below threshold ({self.MIN_BALANCE_THRESHOLD} XLM)."
                )
                return False
                
            return True
            
        except NotFoundError:
            logger.error(f"Keeper account {self.account_id} not found on-chain.")
            return False
        except Exception as e:
            logger.error(f"Error validating Keeper account on-chain: {e}")
            return False

    @property
    def public_key(self) -> Optional[str]:
        return self.account_id
