"""
Keyword extraction module for analytics.

Extracts key entities (coins, protocols, people) from news content
to tag and filter analytics.
"""

import re
from typing import List, Set

# Static dictionary of known crypto projects and their tickers
CRYPTO_PROJECT_MAP: dict[str, List[str]] = {
    # Stellar ecosystem
    "stellar": ["XLM", "Stellar"],
    "xlm": ["XLM", "Stellar"],  # XLM ticker also maps to Stellar
    "soroban": ["XLM", "Soroban"],
    "stellar development foundation": ["SDF", "Stellar"],
    # Bitcoin
    "bitcoin": ["BTC", "Bitcoin"],
    "btc": ["BTC", "Bitcoin"],
    # Ethereum
    "ethereum": ["ETH", "Ethereum"],
    "eth": ["ETH", "Ethereum"],
    # Solana
    "solana": ["SOL", "Solana"],
    "sol": ["SOL", "Solana"],
    # USDC
    "usdc": ["USDC", "USDC"],
    "usd coin": ["USDC", "USDC"],
    # Ripple
    "ripple": ["XRP", "Ripple"],
    "xrp": ["XRP", "XRP"],
    # Cardano
    "cardano": ["ADA", "Cardano"],
    "ada": ["ADA", "ADA"],
    # Polkadot
    "polkadot": ["DOT", "Polkadot"],
    "dot": ["DOT", "DOT"],
    # Dogecoin
    "dogecoin": ["DOGE", "Dogecoin"],
    "doge": ["DOGE", "DOGE"],
    # Litecoin
    "litecoin": ["LTC", "Litecoin"],
    "ltc": ["LTC", "LTC"],
    # Chainlink
    "chainlink": ["LINK", "Chainlink"],
    "link": ["LINK", "LINK"],
    # Avalanche
    "avalanche": ["AVAX", "Avalanche"],
    "avax": ["AVAX", "AVAX"],
    # Polygon
    "polygon": ["MATIC", "Polygon"],
    "matic": ["MATIC", "MATIC"],
    # Algorand
    "algorand": ["ALGO", "Algorand"],
    "algo": ["ALGO", "ALGO"],
    # Cosmos
    "cosmos": ["ATOM", "Cosmos"],
    "atom": ["ATOM", "ATOM"],
    # Uniswap
    "univ3": ["UNI", "Uniswap"],
    "uniswap": ["UNI", "Uniswap"],
    # DeFi
    "defi": ["DeFi", "DeFi"],
    # NFTs
    "nft": ["NFT", "NFT"],
    "nfts": ["NFT", "NFT"],
}

# Set of all known tickers for regex matching
KNOWN_TICKERS: Set[str] = {
    "XLM",
    "BTC",
    "ETH",
    "SOL",
    "USDC",
    "XRP",
    "ADA",
    "DOT",
    "DOGE",
    "LTC",
    "LINK",
    "AVAX",
    "MATIC",
    "ALGO",
    "ATOM",
    "UNI",
    "USDT",
    "Tether",
    "BUSD",
    "BNB",
    "XLM",
    "SDF",
}

# Regex pattern for matching crypto tickers (2-5 uppercase letters)
TICKER_PATTERN = r"\b[A-Z]{2,5}\b"

# Reverse mapping from ticker to project names (for when ticker appears without project name)
TICKER_TO_PROJECT: dict[str, List[str]] = {
    "XLM": ["Stellar"],
    "BTC": ["Bitcoin"],
    "ETH": ["Ethereum"],
    "SOL": ["Solana"],
    "XRP": ["Ripple"],
    "ADA": ["Cardano"],
    "DOT": ["Polkadot"],
    "DOGE": ["Dogecoin"],
    "LTC": ["Litecoin"],
    "LINK": ["Chainlink"],
    "AVAX": ["Avalanche"],
    "MATIC": ["Polygon"],
    "ALGO": ["Algorand"],
    "ATOM": ["Cosmos"],
    "UNI": ["Uniswap"],
    "USDC": ["USDC"],
    "USDT": ["Tether"],
}

# Words to exclude from ticker matching (common English words)
TICKER_EXCLUSIONS: Set[str] = {
    "THE",
    "AND",
    "FOR",
    "ARE",
    "BUT",
    "NOT",
    "YOU",
    "ALL",
    "CAN",
    "HER",
    "WAS",
    "ONE",
    "OUR",
    "OUT",
    "DAY",
    "GET",
    "HAS",
    "HIM",
    "HIS",
    "HOW",
    "ITS",
    "LET",
    "MAY",
    "NEW",
    "NOW",
    "OLD",
    "SEE",
    "TWO",
    "WAY",
    "WHO",
    "BOY",
    "DID",
    "SAY",
    "SHE",
    "TOO",
    "USE",
    "FROM",
    "THIS",
    "THAT",
    "WITH",
    "HAVE",
    "WILL",
    "YOUR",
    "THEY",
    "BEEN",
    "HAVE",
    "WHAT",
    "WHEN",
    "WEVE",
    "MORE",
    "VERY",
    "JUST",
    "ONLY",
    "OVER",
    "SUCH",
    "THEN",
    "THEM",
    "THESE",
    "SOME",
    "INTO",
    "YEAR",
    "MADE",
    "MAKE",
    "ALSO",
    "MOST",
    "SOME",
    "EVEN",
    "BACK",
    "JUST",
    "LIKE",
    "TIME",
    "VERY",
    "AFTER",
    "USED",
    "TWITTER",
    "POST",
    "DATA",
    "COIN",
    "COINS",
    "NODE",
    "NODES",
}


class KeywordExtractor:
    """
    Extracts key entities (coins, protocols, people) from news content
    to tag and filter analytics.
    """

    def __init__(self):
        """Initialize the keyword extractor with regex patterns."""
        self.ticker_regex = re.compile(TICKER_PATTERN)
        # Create a sorted list of project names for longest-match-first matching
        self.project_names = sorted(CRYPTO_PROJECT_MAP.keys(), key=len, reverse=True)
        # Compile regex for project name matching (case insensitive)
        self._project_pattern = re.compile(
            r"\b(" + "|".join(re.escape(name) for name in self.project_names) + r")\b",
            re.IGNORECASE,
        )

    def extract(self, text: str) -> List[str]:
        """
        Extract key entities from the given text.

        Args:
            text: The text to extract keywords from.

        Returns:
            A list of unique extracted keywords (tickers and project names).
        """
        if not text or not isinstance(text, str):
            return []

        # Use a set to avoid duplicates
        keywords: Set[str] = set()

        # Extract project names (case insensitive matching)
        project_matches = self._project_pattern.findall(text)
        for match in project_matches:
            # Get the normalized (lowercase) project name
            normalized_match = match.lower()
            if normalized_match in CRYPTO_PROJECT_MAP:
                # Add all associated tickers and names
                keywords.update(CRYPTO_PROJECT_MAP[normalized_match])

        # Extract tickers using regex
        ticker_matches = self.ticker_regex.findall(text)
        for ticker in ticker_matches:
            # Filter out common English words that happen to be all caps
            if ticker not in TICKER_EXCLUSIONS:
                # Check if it's a known ticker
                if ticker in KNOWN_TICKERS:
                    keywords.add(ticker)
                    # Also add associated project name if available
                    if ticker in TICKER_TO_PROJECT:
                        keywords.update(TICKER_TO_PROJECT[ticker])

        # Return sorted list for consistent output
        return sorted(list(keywords))

    def extract_tickers_only(self, text: str) -> List[str]:
        """
        Extract only crypto tickers from the given text.

        Args:
            text: The text to extract tickers from.

        Returns:
            A list of unique extracted tickers.
        """
        if not text or not isinstance(text, str):
            return []

        tickers: Set[str] = set()

        # Extract tickers using regex
        ticker_matches = self.ticker_regex.findall(text)
        for ticker in ticker_matches:
            if ticker not in TICKER_EXCLUSIONS and ticker in KNOWN_TICKERS:
                tickers.add(ticker)

        return sorted(list(tickers))

    def extract_projects_only(self, text: str) -> List[str]:
        """
        Extract only project names from the given text.

        Args:
            text: The text to extract project names from.

        Returns:
            A list of unique extracted project names.
        """
        if not text or not isinstance(text, str):
            return []

        projects: Set[str] = set()

        # Extract project names
        project_matches = self._project_pattern.findall(text)
        for match in project_matches:
            normalized_match = match.lower()
            if normalized_match in CRYPTO_PROJECT_MAP:
                # Add project names (not tickers)
                projects.add(match.capitalize())

        return sorted(list(projects))
