export interface CryptoData {
  id: number;
  name: string;
  symbol: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  circulatingSupply: number;
}

export interface NewsData {
  id: number;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  date: string;
  imageUrl: string;
}

// Mock data for crypto market
export const mockCryptoData: CryptoData[] = [
  {
    id: 1,
    name: "Bitcoin",
    symbol: "BTC",
    price: 68432.51,
    change24h: 2.34,
    marketCap: 1345678901234,
    volume24h: 28765432109,
    circulatingSupply: 19568421,
  },
  {
    id: 2,
    name: "Ethereum",
    symbol: "ETH",
    price: 3521.78,
    change24h: -1.23,
    marketCap: 423456789012,
    volume24h: 15432109876,
    circulatingSupply: 120345678,
  },
  {
    id: 3,
    name: "Stellar",
    symbol: "XLM",
    price: 1.85,
    change24h: 15.67,
    marketCap: 1850000000,
    volume24h: 543210987,
    circulatingSupply: 1000000000,
  },
];

// Mock data for news
export const mockNewsData: NewsData[] = [
  {
    id: 1,
    title: "Stellar Ecosystem Sees 200% Growth in Q2",
    excerpt:
      "The Stellar ecosystem has experienced unprecedented growth in the second quarter, with total value locked increasing by over 200%.",
    category: "Ecosystem",
    author: "Alex Johnson",
    date: "2 hours ago",
    imageUrl: "https://picsum.photos/seed/stellar1/800/450",
  },
  {
    id: 2,
    title: "New DeFi Protocol Launches on Stellar",
    excerpt:
      "A new decentralized finance protocol has launched on Stellar, promising lower fees and higher throughput for users.",
    category: "DeFi",
    author: "Maria Chen",
    date: "5 hours ago",
    imageUrl: "https://picsum.photos/seed/stellar2/800/450",
  },
  {
    id: 3,
    title: "Stellar Announces Major Protocol Upgrade",
    excerpt:
      "The Stellar team has announced a major protocol upgrade that will significantly improve scalability and reduce transaction costs.",
    category: "Development",
    author: "John Smith",
    date: "1 day ago",
    imageUrl: "https://picsum.photos/seed/stellar3/800/450",
  },
  {
    id: 4,
    title: "Stellar-Based NFT Marketplace Hits $10M in Volume",
    excerpt:
      "A new NFT marketplace built on Stellar has reached $10 million in trading volume within its first month of operation.",
    category: "NFTs",
    author: "Emma Wilson",
    date: "2 days ago",
    imageUrl: "https://picsum.photos/seed/stellar4/800/450",
  },
  {
    id: 5,
    title: "Stellar Foundation Announces Developer Grants Program",
    excerpt:
      "The Stellar Foundation has launched a $10 million grants program to support developers building on the platform.",
    category: "Funding",
    author: "David Chang",
    date: "3 days ago",
    imageUrl: "https://picsum.photos/seed/stellar5/800/450",
  },
  {
    id: 6,
    title: "Major Exchange Adds Support for Stellar Token",
    excerpt:
      "One of the world's largest cryptocurrency exchanges has announced support for the Stellar token, boosting liquidity.",
    category: "Exchange",
    author: "Sarah Miller",
    date: "4 days ago",
    imageUrl: "https://picsum.photos/seed/stellar6/800/450",
  },
  {
    id: 7,
    title: "Stellar Integrates with Leading Web3 Identity Solution",
    excerpt:
      "Stellar has integrated with a leading Web3 identity solution, enabling seamless authentication across dApps.",
    category: "Identity",
    author: "Michael Brown",
    date: "5 days ago",
    imageUrl: "https://picsum.photos/seed/stellar7/800/450",
  },
];


