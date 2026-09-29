"use client";

import { Clock, User, ExternalLink, Wifi, WifiOff, TrendingUp, TrendingDown, Minus, DollarSign, Newspaper } from "lucide-react";
import Image from "next/image";
import { NewsCarousel } from "@/components/news-carousel";
import { Web3NewsFallback } from "@/components/web3-news-fallback";
import { useState, useEffect, useMemo } from "react";
import { fetchCryptoNews } from "@/lib/news-client";
import { ExploreFilters } from "./explore-filters";
import { ReportButton } from "@/components/report/report-button";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface NewsData {
  id: number;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  date: string;
  imageUrl: string;
  url?: string;
  sentiment?: "Bullish" | "Bearish" | "Neutral";
  fundingStatus?: "Funded" | "Seeking Funding" | "Closed";
  timestamp?: number;
}

interface NewsSectionProps {
  newsData?: NewsData[];
  isLoading?: boolean;
  error?: string | null;
}

export function NewsSection({ newsData: propNewsData, isLoading: propIsLoading, error: propError }: NewsSectionProps) {
  const [allNewsData, setAllNewsData] = useState<NewsData[]>(propNewsData || []);
  const [isLoading, setIsLoading] = useState<boolean>(propIsLoading ?? true);
  const [error, setError] = useState<string | null>(propError || null);
  const [isUsingFallback, setIsUsingFallback] = useState<boolean>(false);
  
  // Filter and Sort state
  const [filters, setFilters] = useState({ category: "All", sentiment: "All", funding: "All" });
  const [sortOrder, setSortOrder] = useState("newest");

  // Fetch real news data
  useEffect(() => {
    // If props are provided, use them instead of fetching
    if (propNewsData) {
      setAllNewsData(propNewsData);
      setIsLoading(propIsLoading ?? false);
      setError(propError || null);
      setIsUsingFallback(false);
      return;
    }

    const fetchNewsData = async () => {
      setIsLoading(true);
      setError(null);
      setIsUsingFallback(false);
      
      try {
        const newsData = await fetchCryptoNews(20);
        
        if (newsData.length === 0) {
          console.log('Using Web3 fallback news generator');
          setIsUsingFallback(true);
          setAllNewsData([]);
        } else {
          setAllNewsData(newsData);
          setIsUsingFallback(false);
        }
      } catch (err) {
        console.error('Error fetching news data:', err);
        setError('Using AI-generated Web3 news');
        setIsUsingFallback(true);
        setAllNewsData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNewsData();
    
    // Refresh data every 10 minutes
    const interval = setInterval(fetchNewsData, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [propNewsData, propIsLoading, propError]);

  // Apply filters and sorting
  const filteredAndSortedNews = useMemo(() => {
    let result = [...allNewsData];

    // Apply Category Filter
    if (filters.category !== "All") {
      result = result.filter(item => item.category === filters.category);
    }

    // Apply Sentiment Filter
    if (filters.sentiment !== "All") {
      result = result.filter(item => item.sentiment === filters.sentiment);
    }

    // Apply Funding Filter
    if (filters.funding !== "All") {
      result = result.filter(item => item.fundingStatus === filters.funding);
    }

    // Apply Sorting
    result.sort((a, b) => {
      if (sortOrder === "newest") {
        return (b.timestamp || 0) - (a.timestamp || 0);
      } else if (sortOrder === "oldest") {
        return (a.timestamp || 0) - (b.timestamp || 0);
      } else if (sortOrder === "trending") {
        // Mock trending by random shuffle for now, or use ID
        return b.id - a.id;
      }
      return 0;
    });

    return result;
  }, [allNewsData, filters, sortOrder]);

  // Handle news item click
  const handleNewsClick = (news: NewsData) => {
    if (news.url && news.url !== '#') {
      window.open(news.url, '_blank', 'noopener,noreferrer');
    } else {
      const searchQuery = encodeURIComponent(`${news.title} cryptocurrency news`);
      window.open(`https://www.google.com/search?q=${searchQuery}`, '_blank', 'noopener,noreferrer');
    }
  };

  const getSentimentIcon = (sentiment?: string) => {
    switch (sentiment) {
      case "Bullish": return <TrendingUp className="w-3 h-3 text-green-400" />;
      case "Bearish": return <TrendingDown className="w-3 h-3 text-red-400" />;
      default: return <Minus className="w-3 h-3 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6">
      <ExploreFilters 
        onFilterChange={setFilters} 
        onSortChange={setSortOrder} 
      />

      <div className="bg-black/40 border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-2xl font-bold font-poppins text-white relative z-10 isolation-isolate flex items-center gap-2"
          >
            <span className="w-2 h-6 bg-blue-500 rounded-sm inline-block"></span>
            Explore Feed
            {isUsingFallback ? (
              <span className="text-sm text-purple-400 ml-2 font-normal flex items-center gap-1">
                <WifiOff className="w-3 h-3" />
                (AI Generated)
              </span>
            ) : !error ? (
              <span className="text-sm text-green-400 ml-2 font-normal flex items-center gap-1">
                <Wifi className="w-3 h-3" />
                (Live)
              </span>
            ) : (
              <span className="text-sm text-yellow-400 ml-2 font-normal">
                (Cached)
              </span>
            )}
          </h2>
          
          <div className="text-sm text-gray-400">
            Showing {filteredAndSortedNews.length} results
          </div>
        </div>

        {isLoading ? (
          <ListSkeleton count={6} variant="grid" gridCols={3} />
        ) : isUsingFallback ? (
          <Web3NewsFallback filters={filters} sortOrder={sortOrder} />
        ) : filteredAndSortedNews.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title="No results found"
            description="No articles match your current filters. Try adjusting your filter criteria."
            action={{
              label: "Clear all filters",
              onClick: () => setFilters({ category: "All", sentiment: "All", funding: "All" }),
            }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedNews.map((news) => (
              <div key={news.id} className="h-full">
                <div 
                  className="bg-black/50 border border-white/10 rounded-xl overflow-hidden h-full flex flex-col hover:bg-black/60 transition-all duration-300 cursor-pointer group"
                  onClick={() => handleNewsClick(news)}
                >
                  <div className="relative h-48">
                    <Image
                      src={news.imageUrl}
                      alt={news.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        e.currentTarget.src = 'https://picsum.photos/seed/crypto/800/450';
                      }}
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-2">
                      <div className="bg-primary/90 text-white text-[10px] uppercase font-bold px-2 py-1 rounded-md backdrop-blur-md">
                        {news.category}
                      </div>
                      <ReportButton
                        targetType="other"
                        targetId={String(news.id)}
                        targetLabel={`"${news.title}"`}
                        variant="icon"
                      />
                    </div>
                    <div className="absolute bottom-2 left-2 flex gap-2">
                      <div className="bg-black/60 text-white text-[10px] px-2 py-1 rounded-md backdrop-blur-md flex items-center gap-1 border border-white/10">
                        {getSentimentIcon(news.sentiment)}
                        {news.sentiment}
                      </div>
                      {news.fundingStatus && (
                        <div className="bg-purple-500/80 text-white text-[10px] px-2 py-1 rounded-md backdrop-blur-md flex items-center gap-1 border border-white/10">
                          <DollarSign className="w-3 h-3" />
                          {news.fundingStatus}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <h3 className="text-lg font-bold mb-2 line-clamp-2 group-hover:text-primary transition-colors">
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
        )}
      </div>
    </div>
  );
}

