import pytest
import os
from unittest.mock import MagicMock, patch
from src.utils.keeper import KeeperIdentity
from stellar_sdk import Keypair
from stellar_sdk.exceptions import NotFoundError

@pytest.fixture
def mock_keypair():
    return Keypair.random()

def test_load_identity_success(mock_keypair):
    secret = mock_keypair.secret
    keeper = KeeperIdentity(secret_key=secret)
    assert keeper.load_identity() is True
    assert keeper.account_id == mock_keypair.public_key

def test_load_identity_missing_secret():
    with patch.dict(os.environ, {}, clear=True):
        keeper = KeeperIdentity(secret_key=None)
        assert keeper.load_identity() is False

def test_validate_on_chain_success(mock_keypair):
    keeper = KeeperIdentity(secret_key=mock_keypair.secret)
    keeper.load_identity()
    
    with patch('src.utils.keeper.Server') as mock_server_class:
        mock_server = mock_server_class.return_value
        mock_accounts = mock_server.accounts.return_value
        mock_account_call = mock_accounts.account_id.return_value
        
        # Mock successful account call with sufficient balance
        mock_account_call.call.return_value = {
            "balances": [{"asset_type": "native", "balance": "10.5"}]
        }
        
        assert keeper.validate_on_chain() is True

def test_validate_on_chain_low_balance(mock_keypair):
    keeper = KeeperIdentity(secret_key=mock_keypair.secret)
    keeper.load_identity()
    
    with patch('src.utils.keeper.Server') as mock_server_class:
        mock_server = mock_server_class.return_value
        mock_account_call = mock_server.accounts.return_value.account_id.return_value
        
        # Mock low balance
        mock_account_call.call.return_value = {
            "balances": [{"asset_type": "native", "balance": "2.0"}]
        }
        
        assert keeper.validate_on_chain() is False

def test_validate_on_chain_not_found(mock_keypair):
    keeper = KeeperIdentity(secret_key=mock_keypair.secret)
    keeper.load_identity()
    
    with patch('src.utils.keeper.Server') as mock_server_class:
        mock_server = mock_server_class.return_value
        mock_account_call = mock_server.accounts.return_value.account_id.return_value
        
        # Mock account not found
        mock_account_call.call.side_effect = NotFoundError(MagicMock())
        
        assert keeper.validate_on_chain() is False
