"use client";

import { Clock, User, ExternalLink, Wifi, WifiOff } from "lucide-react";
import Image from "next/image";
import { NewsCarousel } from "@/components/news-carousel";
import { Web3NewsFallback } from "@/components/web3-news-fallback";
import { useState, useEffect } from "react";
import { NewsApiService, transformNewsData } from "@/lib/api-services";

interface NewsData {
  id: number;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  date: string;
  imageUrl: string;
  url?: string;
}

interface NewsSectionProps {
  newsData?: NewsData[];
  isLoading?: boolean;
  error?: string | null;
}

export function NewsSection({ newsData: propNewsData, isLoading: propIsLoading, error: propError }: NewsSectionProps) {
  const [newsData, setNewsData] = useState<NewsData[]>(propNewsData || []);
  const [isLoading, setIsLoading] = useState<boolean>(propIsLoading ?? true);
  const [error, setError] = useState<string | null>(propError || null);
  const [isUsingFallback, setIsUsingFallback] = useState<boolean>(false);

  // Fetch real news data
  useEffect(() => {
    // If props are provided, use them instead of fetching
    if (propNewsData) {
      setNewsData(propNewsData);
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
        const apiData = await NewsApiService.getCryptoNews(10);
        
        if (apiData.length === 0) {
          // Use Web3 fallback instead of mock data
          console.log('Using Web3 fallback news generator');
          setIsUsingFallback(true);
          setNewsData([]);
        } else {
          const transformedData = apiData.map(transformNewsData);
          setNewsData(transformedData);
          setIsUsingFallback(false);
        }
      } catch (err) {
        console.error('Error fetching news data:', err);
        setError('Using AI-generated Web3 news');
        setIsUsingFallback(true);
        setNewsData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNewsData();
    
    // Refresh data every 10 minutes
    const interval = setInterval(fetchNewsData, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [propNewsData, propIsLoading, propError]);

  // Handle news item click
  const handleNewsClick = (news: NewsData) => {
    if (news.url && news.url !== '#') {
      window.open(news.url, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback: search for the news title on Google
      const searchQuery = encodeURIComponent(`${news.title} cryptocurrency news`);
      window.open(`https://www.google.com/search?q=${searchQuery}`, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-4">
      <h2
        className="text-2xl font-bold mb-4 font-poppins text-white relative z-10 isolation-isolate flex items-center gap-2"
        style={{ opacity: 1, filter: "none" }}
      >
        <span className="w-2 h-6 bg-blue-500 rounded-sm inline-block"></span>
        Latest News
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

      {isLoading ? (
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
      ) : isUsingFallback ? (
        <Web3NewsFallback />
      ) : (
        <NewsCarousel itemsPerView={3}>
          {newsData.map((news) => (
            <div key={news.id} className="h-full">
              <div 
                className="bg-black/50 border border-white/10 rounded-lg overflow-hidden h-full flex flex-col hover:bg-black/60 transition-all duration-300 cursor-pointer group"
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
                  <div className="absolute top-2 right-2 bg-primary/90 text-white text-xs px-2 py-1 rounded">
                    {news.category}
                  </div>
                  <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <ExternalLink className="w-4 h-4 text-white bg-black/50 rounded p-0.5" />
                  </div>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-lg font-bold mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
                    {news.title}
                  </h3>
                  <p className="text-gray-300 text-sm mb-4 flex-1 line-clamp-3">
                    {news.excerpt}
                  </p>
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
                </div>
              </div>
            </div>
          ))}
        </NewsCarousel>
      )}
    </div>
  );
}

