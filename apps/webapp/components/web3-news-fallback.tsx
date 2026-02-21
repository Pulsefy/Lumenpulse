"use client";

import { useState, useEffect } from "react";
import { Clock, User, Zap, TrendingUp, Shield, Coins, Globe, Rocket } from "lucide-react";
import Image from "next/image";

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
  
  for (let i = 0; i < 8; i++) {
    const category = template.categories[Math.floor(Math.random() * template.categories.length)];
    const titleTemplate = template.titleTemplates[Math.floor(Math.random() * template.titleTemplates.length)];
    const metric = template.metrics[Math.floor(Math.random() * template.metrics.length)];
    const title = titleTemplate.replace('{metric}', metric);
    const excerpt = template.excerptTemplates[Math.floor(Math.random() * template.excerptTemplates.length)];
    const author = template.authors[Math.floor(Math.random() * template.authors.length)];
    
    // Generate time ago (1-48 hours)
    const hoursAgo = Math.floor(Math.random() * 48) + 1;
    const timeAgo = hoursAgo === 1 ? '1 hour ago' : 
                   hoursAgo < 24 ? `${hoursAgo} hours ago` : 
                   hoursAgo === 24 ? '1 day ago' : 
                   `${Math.floor(hoursAgo / 24)} days ago`;
    
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
      gradient: category.gradient
    });
  }
  
  return news.sort(() => Math.random() - 0.5); // Shuffle
}

export function Web3NewsFallback() {
  const [newsItems, setNewsItems] = useState<Web3NewsItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(true);
  
  useEffect(() => {
    const generateNews = () => {
      setIsGenerating(true);
      // Simulate generation time
      setTimeout(() => {
        setNewsItems(generateRandomNews());
        setIsGenerating(false);
      }, 1000);
    };
    
    generateNews();
    
    // Regenerate news every 30 seconds for dynamic feel
    const interval = setInterval(generateNews, 30000);
    return () => clearInterval(interval);
  }, []);
  
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
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {newsItems.slice(0, 6).map((news) => (
        <div key={news.id} className="h-full">
          <div 
            className="bg-black/50 border border-white/10 rounded-lg overflow-hidden h-full flex flex-col hover:bg-black/60 transition-all duration-300 cursor-pointer group relative"
            onClick={() => window.open(news.url, '_blank', 'noopener,noreferrer')}
          >
            {/* Animated background gradient */}
            <div className={`absolute inset-0 bg-gradient-to-r ${news.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`}></div>
            
            <div className="relative h-48">
              <Image
                src={news.imageUrl}
                alt={news.title}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
              {/* Overlay gradient */}
              <div className={`absolute inset-0 bg-gradient-to-t ${news.gradient} opacity-20`}></div>
              
              {/* Category badge with icon */}
              <div className={`absolute top-2 right-2 bg-gradient-to-r ${news.gradient} text-white text-xs px-2 py-1 rounded-full flex items-center gap-1`}>
                {news.icon}
                {news.category}
              </div>
              
              {/* Blockchain-themed decorative elements */}
              <div className="absolute top-2 left-2 opacity-30 group-hover:opacity-60 transition-opacity duration-300">
                <div className="w-8 h-8 border border-white/30 rounded transform rotate-45">
                  <div className="w-2 h-2 bg-white/50 rounded-full absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
                </div>
              </div>
            </div>
            
            <div className="p-4 flex-1 flex flex-col relative z-10">
              <h3 className="text-lg font-bold mb-2 line-clamp-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-blue-400 group-hover:to-purple-400 transition-all duration-300">
                {news.title}
              </h3>
              <p className="text-gray-300 text-sm mb-4 flex-1 line-clamp-3">
                {news.excerpt}
              </p>
              
              {/* Web3-themed footer */}
              <div className="flex justify-between items-center text-xs text-gray-400">
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span className="truncate max-w-[100px]">{news.author}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {news.date}
                </div>
              </div>
              
              {/* Blockchain network indicator */}
              <div className="absolute bottom-2 right-2 opacity-20 group-hover:opacity-40 transition-opacity duration-300">
                <div className="flex space-x-1">
                  <div className="w-1 h-1 bg-blue-400 rounded-full animate-pulse"></div>
                  <div className="w-1 h-1 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1 h-1 bg-pink-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

