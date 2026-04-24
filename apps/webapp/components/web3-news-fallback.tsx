import { Clock, User, Zap, TrendingUp, Shield, Coins, Globe, Rocket, TrendingDown, Minus, DollarSign } from "lucide-react";
import Image from "next/image";
import { useState, useEffect, useMemo } from "react";

interface Web3NewsItem {
  id: number;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  date: string;
  imageUrl: string;
  url: string;
  icon: React.ReactNode;
  gradient: string;
  sentiment: "Bullish" | "Bearish" | "Neutral";
  fundingStatus: "Funded" | "Seeking Funding" | "Closed";
  timestamp: number;
}

const WEB3_NEWS_TEMPLATES = [
  {
    titleTemplates: [
      "Stellar Ecosystem Reaches New Milestone with {metric} Growth",
      "Layer 2 Solutions See {metric} Increase in Adoption",
      "Zero-Knowledge Proofs Drive {metric} Efficiency Gains",
      "DeFi Protocols on Stellar Report {metric} TVL Growth",
      "Cross-Chain Bridges Facilitate {metric} in Transaction Volume"
    ],
    excerptTemplates: [
      "The latest developments in Layer 2 scaling solutions continue to push the boundaries of blockchain efficiency and user experience.",
      "Zero-knowledge technology is revolutionizing how we think about privacy and scalability in decentralized applications.",
      "The growing ecosystem of DeFi protocols is creating new opportunities for yield generation and liquidity provision.",
      "Institutional adoption of blockchain technology is accelerating with improved infrastructure and regulatory clarity.",
      "Cross-chain interoperability solutions are breaking down silos between different blockchain networks."
    ],
    categories: [
      { name: "Layer 2", icon: <Zap className="w-3 h-3" />, gradient: "from-blue-500 to-cyan-500" },
      { name: "DeFi", icon: <TrendingUp className="w-3 h-3" />, gradient: "from-green-500 to-emerald-500" },
      { name: "Security", icon: <Shield className="w-3 h-3" />, gradient: "from-purple-500 to-violet-500" },
      { name: "Tokens", icon: <Coins className="w-3 h-3" />, gradient: "from-yellow-500 to-orange-500" },
      { name: "Infrastructure", icon: <Globe className="w-3 h-3" />, gradient: "from-indigo-500 to-blue-500" },
      { name: "Innovation", icon: <Rocket className="w-3 h-3" />, gradient: "from-pink-500 to-rose-500" }
    ],
    authors: [
      "Stellar Research Team",
      "Blockchain Analytics",
      "DeFi Protocol Labs",
      "Zero-Knowledge Institute",
      "Layer 2 Foundation",
      "Crypto Innovation Hub"
    ],
    metrics: [
      "300%", "250%", "180%", "420%", "150%", "200%", "350%", "275%"
    ]
  }
];

function generateRandomNews(): Web3NewsItem[] {
  const template = WEB3_NEWS_TEMPLATES[0];
  const news: Web3NewsItem[] = [];
  
  for (let i = 0; i < 20; i++) { // Generate more for filtering
    const category = template.categories[Math.floor(Math.random() * template.categories.length)];
    const titleTemplate = template.titleTemplates[Math.floor(Math.random() * template.titleTemplates.length)];
    const metric = template.metrics[Math.floor(Math.random() * template.metrics.length)];
    const title = titleTemplate.replace('{metric}', metric);
    const excerpt = template.excerptTemplates[Math.floor(Math.random() * template.excerptTemplates.length)];
    const author = template.authors[Math.floor(Math.random() * template.authors.length)];
    
    // Generate timestamp
    const hoursAgo = Math.floor(Math.random() * 48) + 1;
    const timestamp = Date.now() - (hoursAgo * 60 * 60 * 1000);
    const timeAgo = hoursAgo === 1 ? '1 hour ago' : 
                   hoursAgo < 24 ? `${hoursAgo} hours ago` : 
                   hoursAgo === 24 ? '1 day ago' : 
                   `${Math.floor(hoursAgo / 24)} days ago`;
    
    const sentiments: ("Bullish" | "Bearish" | "Neutral")[] = ["Bullish", "Bearish", "Neutral"];
    const fundingStatuses: ("Funded" | "Seeking Funding" | "Closed")[] = ["Funded", "Seeking Funding", "Closed"];

    news.push({
      id: i + 1,
      title,
      excerpt,
      category: category.name,
      author,
      date: timeAgo,
      imageUrl: `https://picsum.photos/seed/web3-${i}/800/450`,
      url: `https://www.google.com/search?q=${encodeURIComponent(title + ' blockchain news')}`,
      icon: category.icon,
      gradient: category.gradient,
      sentiment: sentiments[Math.floor(Math.random() * sentiments.length)],
      fundingStatus: fundingStatuses[Math.floor(Math.random() * fundingStatuses.length)],
      timestamp
    });
  }
  
  return news;
}

interface Web3NewsFallbackProps {
  filters?: { category: string; sentiment: string; funding: string };
  sortOrder?: string;
}

export function Web3NewsFallback({ filters, sortOrder }: Web3NewsFallbackProps) {
  const [newsItems, setNewsItems] = useState<Web3NewsItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(true);
  
  useEffect(() => {
    const generateNews = () => {
      setIsGenerating(true);
      setTimeout(() => {
        setNewsItems(generateRandomNews());
        setIsGenerating(false);
      }, 1000);
    };
    
    generateNews();
    const interval = setInterval(generateNews, 60000); // Regenerate less frequently
    return () => clearInterval(interval);
  }, []);

  const filteredAndSortedNews = useMemo(() => {
    let result = [...newsItems];

    if (filters) {
      if (filters.category !== "All") {
        result = result.filter(item => item.category === filters.category);
      }
      if (filters.sentiment !== "All") {
        result = result.filter(item => item.sentiment === filters.sentiment);
      }
      if (filters.funding !== "All") {
        result = result.filter(item => item.fundingStatus === filters.funding);
      }
    }

    if (sortOrder) {
      result.sort((a, b) => {
        if (sortOrder === "newest") return b.timestamp - a.timestamp;
        if (sortOrder === "oldest") return a.timestamp - b.timestamp;
        if (sortOrder === "trending") return b.id - a.id;
        return 0;
      });
    }

    return result;
  }, [newsItems, filters, sortOrder]);

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case "Bullish": return <TrendingUp className="w-3 h-3 text-green-400" />;
      case "Bearish": return <TrendingDown className="w-3 h-3 text-red-400" />;
      default: return <Minus className="w-3 h-3 text-gray-400" />;
    }
  };
  
  if (isGenerating) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-black/50 border border-white/10 rounded-lg p-4 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 animate-pulse"></div>
            <div className="relative z-10">
              <div className="h-32 bg-gradient-to-r from-white/5 to-white/10 rounded-lg mb-2 animate-pulse"></div>
              <div className="h-4 bg-gradient-to-r from-white/5 to-white/10 rounded w-3/4 mb-2 animate-pulse"></div>
              <div className="h-3 bg-gradient-to-r from-white/5 to-white/10 rounded w-full mb-2 animate-pulse"></div>
              <div className="h-3 bg-gradient-to-r from-white/5 to-white/10 rounded w-5/6 animate-pulse"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredAndSortedNews.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-400 text-lg">No AI-generated results found for the selected filters.</p>
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filteredAndSortedNews.map((news) => (
        <div key={news.id} className="h-full">
          <div 
            className="bg-black/50 border border-white/10 rounded-xl overflow-hidden h-full flex flex-col hover:bg-black/60 transition-all duration-300 cursor-pointer group relative"
            onClick={() => window.open(news.url, '_blank', 'noopener,noreferrer')}
          >
            <div className={`absolute inset-0 bg-gradient-to-r ${news.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`}></div>
            
            <div className="relative h-48">
              <Image
                src={news.imageUrl}
                alt={news.title}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className={`absolute inset-0 bg-gradient-to-t ${news.gradient} opacity-20`}></div>
              
              <div className={`absolute top-2 right-2 bg-gradient-to-r ${news.gradient} text-white text-[10px] uppercase font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-lg`}>
                {news.icon}
                {news.category}
              </div>

              <div className="absolute bottom-2 left-2 flex gap-2">
                <div className="bg-black/60 text-white text-[10px] px-2 py-1 rounded-md backdrop-blur-md flex items-center gap-1 border border-white/10">
                  {getSentimentIcon(news.sentiment)}
                  {news.sentiment}
                </div>
                <div className="bg-purple-500/80 text-white text-[10px] px-2 py-1 rounded-md backdrop-blur-md flex items-center gap-1 border border-white/10">
                  <DollarSign className="w-3 h-3" />
                  {news.fundingStatus}
                </div>
              </div>
            </div>
            
            <div className="p-4 flex-1 flex flex-col relative z-10">
              <h3 className="text-lg font-bold mb-2 line-clamp-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-blue-400 group-hover:to-purple-400 transition-all duration-300">
                {news.title}
              </h3>
              <p className="text-gray-400 text-sm mb-4 flex-1 line-clamp-3 leading-relaxed">
                {news.excerpt}
              </p>
              
              <div className="flex justify-between items-center text-xs text-gray-500 border-t border-white/5 pt-3">
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span className="truncate max-w-[100px]">{news.author}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {news.date}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
