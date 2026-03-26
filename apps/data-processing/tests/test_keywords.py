"""Unit tests for the KeywordExtractor class."""

from src.analytics.keywords import KeywordExtractor


def test_extract_xlm_from_stellar_headline():
    """Test extracting XLM and Stellar from a Stellar-related headline."""
    extractor = KeywordExtractor()
    text = "Stellar (XLM) surges after partnership announcement"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "XLM" in result
    assert "Stellar" in result


def test_extract_bitcoin_from_headline():
    """Test extracting BTC and Bitcoin from a Bitcoin-related headline."""
    extractor = KeywordExtractor()
    text = "Bitcoin reaches new all-time high above $100K"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "BTC" in result
    assert "Bitcoin" in result


def test_extract_ethereum_from_headline():
    """Test extracting ETH and Ethereum from an Ethereum-related headline."""
    extractor = KeywordExtractor()
    text = "Ethereum network upgrade boosts transaction speeds"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "ETH" in result
    assert "Ethereum" in result


def test_extract_solana_from_headline():
    """Test extracting SOL from a Solana-related headline."""
    extractor = KeywordExtractor()
    text = "Solana DeFi TVL hits record high"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "SOL" in result
    assert "Solana" in result


def test_extract_usdc_from_headline():
    """Test extracting USDC from a USDC-related headline."""
    extractor = KeywordExtractor()
    text = "USDC circulation grows amid stablecoin adoption"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "USDC" in result


def test_extract_multiple_cryptos():
    """Test extracting multiple cryptocurrencies from a single headline."""
    extractor = KeywordExtractor()
    text = "Bitcoin and Ethereum lead market rally as XLM gains momentum"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "BTC" in result
    assert "Bitcoin" in result
    assert "ETH" in result
    assert "Ethereum" in result
    assert "XLM" in result
    assert "Stellar" in result


def test_extract_soroban():
    """Test extracting Soroban-related keywords."""
    extractor = KeywordExtractor()
    text = "Soroban smart contract platform launches on Stellar"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "XLM" in result
    assert "Soroban" in result
    assert "Stellar" in result


def test_extract_empty_string():
    """Test that empty string returns empty list."""
    extractor = KeywordExtractor()
    result = extractor.extract("")

    assert isinstance(result, list)
    assert len(result) == 0


def test_extract_none_input():
    """Test that None input returns empty list."""
    extractor = KeywordExtractor()
    result = extractor.extract(None)

    assert isinstance(result, list)
    assert len(result) == 0


def test_extract_no_keywords():
    """Test text with no known keywords returns empty list."""
    extractor = KeywordExtractor()
    text = "The weather is nice today"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert len(result) == 0


def test_extract_duplicate_keywords():
    """Test that duplicate keywords are not returned multiple times."""
    extractor = KeywordExtractor()
    text = "Bitcoin Bitcoin BTC BTC"
    result = extractor.extract(text)

    assert isinstance(result, list)
    # Should have only unique keywords
    assert result.count("BTC") == 1
    assert result.count("Bitcoin") == 1


def test_extract_tickers_only():
    """Test extracting only tickers."""
    extractor = KeywordExtractor()
    text = "Stellar (XLM) and Bitcoin (BTC) show growth"
    result = extractor.extract_tickers_only(text)

    assert isinstance(result, list)
    assert "XLM" in result
    assert "BTC" in result
    assert "Stellar" not in result
    assert "Bitcoin" not in result


def test_extract_projects_only():
    """Test extracting only project names."""
    extractor = KeywordExtractor()
    text = "Stellar (XLM) and Bitcoin (BTC) show growth"
    result = extractor.extract_projects_only(text)

    assert isinstance(result, list)
    assert "Stellar" in result
    assert "Bitcoin" in result
    assert "XLM" not in result
    assert "BTC" not in result


def test_extract_case_insensitive_project_names():
    """Test that project name extraction is case insensitive."""
    extractor = KeywordExtractor()
    text = "STELLAR and BITCOIN showing growth"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "Stellar" in result
    assert "Bitcoin" in result


def test_extract_with_punctuation():
    """Test extraction works with various punctuation."""
    extractor = KeywordExtractor()
    text = "XLM, BTC, ETH and SOL: Top performers today!"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "XLM" in result
    assert "BTC" in result
    assert "ETH" in result
    assert "SOL" in result


def test_extract_ripple_xrp():
    """Test extracting Ripple/XRP keywords."""
    extractor = KeywordExtractor()
    text = "Ripple partners with major bank for cross-border payments"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "XRP" in result
    assert "Ripple" in result


def test_extract_chainlink():
    """Test extracting Chainlink/LINK keywords."""
    extractor = KeywordExtractor()
    text = "Chainlink oracle network expands to new blockchains"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "LINK" in result
    assert "Chainlink" in result


def test_extract_defi():
    """Test extracting DeFi-related keywords."""
    extractor = KeywordExtractor()
    text = "DeFi protocols see surge in total value locked"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "DeFi" in result


def test_extract_nft():
    """Test extracting NFT-related keywords."""
    extractor = KeywordExtractor()
    text = "NFT marketplace trading volume hits new records"
    result = extractor.extract(text)

    assert isinstance(result, list)
    assert "NFT" in result


def test_extract_excludes_common_words():
    """Test that common English words are excluded from ticker matching."""
    extractor = KeywordExtractor()
    text = "THE AND FOR ARE BUT NOT YOU ALL CAN"
    result = extractor.extract(text)

    # Common words should not be extracted as tickers
    assert isinstance(result, list)
    assert len(result) == 0


def test_real_headline_extraction():
    """Test extraction from realistic news headlines."""
    extractor = KeywordExtractor()

    # Realistic headlines
    headlines = [
        "Stellar Network Launches Soroban Smart Contracts",
        "Bitcoin ETF Sees Record Inflows as ETH Eyes $5K",
        "XLM Price Surges 20% After Major Partnership",
        "USDC Stablecoin Launches on Multiple Blockchains",
        "Solana DeFi TVL Reaches $10 Billion",
    ]

    for headline in headlines:
        result = extractor.extract(headline)
        assert isinstance(result, list)
        # Each headline should have at least one keyword
        assert len(result) > 0, f"No keywords extracted from: {headline}"
