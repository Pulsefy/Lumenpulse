"use client";

import { useState } from "react";
import { Filter, ChevronDown, Check } from "lucide-react";

interface ExploreFiltersProps {
  onFilterChange: (filters: { category: string; sentiment: string; funding: string }) => void;
  onSortChange: (sort: string) => void;
}

const CATEGORIES = ["All", "DeFi", "Layer 2", "Infrastructure", "Security", "AI", "Gaming"];
const SENTIMENTS = ["All", "Bullish", "Neutral", "Bearish"];
const FUNDING_STATUS = ["All", "Funded", "Seeking Funding", "Closed"];
const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "Trending", value: "trending" },
  { label: "Oldest", value: "oldest" },
];

export function ExploreFilters({ onFilterChange, onSortChange }: ExploreFiltersProps) {
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeSentiment, setActiveSentiment] = useState("All");
  const [activeFunding, setActiveFunding] = useState("All");
  const [activeSort, setActiveSort] = useState("newest");
  const [isSortOpen, setIsSortOpen] = useState(false);

  const handleCategoryClick = (category: string) => {
    setActiveCategory(category);
    onFilterChange({ category, sentiment: activeSentiment, funding: activeFunding });
  };

  const handleSentimentClick = (sentiment: string) => {
    setActiveSentiment(sentiment);
    onFilterChange({ category: activeCategory, sentiment, funding: activeFunding });
  };

  const handleFundingClick = (funding: string) => {
    setActiveFunding(funding);
    onFilterChange({ category: activeCategory, sentiment: activeSentiment, funding });
  };

  const handleSortClick = (sort: string) => {
    setActiveSort(sort);
    onSortChange(sort);
    setIsSortOpen(false);
  };

  return (
    <div className="flex flex-col gap-6 mb-8 p-6 bg-black/40 border border-white/10 rounded-2xl backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/20 rounded-lg">
            <Filter className="w-5 h-5 text-primary" />
          </div>
          <h3 className="text-xl font-bold text-white font-heading">Explore Feed</h3>
        </div>
        
        {/* Sort Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsSortOpen(!isSortOpen)}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm text-white transition-all duration-300 group"
          >
            <span className="text-gray-400 group-hover:text-gray-300">Sort by:</span>
            <span className="font-semibold">{SORT_OPTIONS.find(o => o.value === activeSort)?.label}</span>
            <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isSortOpen ? 'rotate-180' : ''}`} />
          </button>
          
          {isSortOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-black/90 border border-white/10 rounded-xl shadow-2xl z-20 overflow-hidden backdrop-blur-2xl animate-fadeIn">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleSortClick(option.value)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-white hover:bg-primary/20 transition-all duration-200"
                >
                  {option.label}
                  {activeSort === option.value && <Check className="w-4 h-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Categories - Spans more columns */}
        <div className="lg:col-span-12 flex flex-col gap-3">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">Categories</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryClick(cat)}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-300 transform active:scale-95 ${
                  activeCategory === cat
                    ? "bg-primary text-white shadow-lg shadow-primary/20 scale-105"
                    : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 flex flex-col gap-3">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">Sentiment</span>
          <div className="flex flex-wrap gap-2">
            {SENTIMENTS.map((sent) => (
              <button
                key={sent}
                onClick={() => handleSentimentClick(sent)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300 transform active:scale-95 ${
                  activeSentiment === sent
                    ? "bg-blue-500/80 text-white shadow-lg shadow-blue-500/20"
                    : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {sent}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 flex flex-col gap-3">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">Funding Status</span>
          <div className="flex flex-wrap gap-2">
            {FUNDING_STATUS.map((status) => (
              <button
                key={status}
                onClick={() => handleFundingClick(status)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300 transform active:scale-95 ${
                  activeFunding === status
                    ? "bg-purple-500/80 text-white shadow-lg shadow-purple-500/20"
                    : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
