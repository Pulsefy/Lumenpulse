"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface NewsCarouselProps {
  children: React.ReactNode[];
  itemsPerView?: number;
}

export function NewsCarousel({
  children,
  itemsPerView = 3,
}: NewsCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);

  // Check viewport size on mount and resize
  useEffect(() => {
    const checkSize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);

  // Calculate actual items per view based on screen size
  const actualItemsPerView = isMobile ? 1 : itemsPerView > 3 ? 3 : itemsPerView;

  const nextSlide = () => {
    setCurrentIndex((prevIndex) =>
      prevIndex + 1 >= children.length ? 0 : prevIndex + 1
    );
  };

  const prevSlide = () => {
    setCurrentIndex((prevIndex) =>
      prevIndex - 1 < 0 ? children.length - 1 : prevIndex - 1
    );
  };

  // Calculate which items to show
  const getVisibleItems = () => {
    const items = [];
    for (let i = 0; i < actualItemsPerView; i++) {
      const index = (currentIndex + i) % children.length;
      items.push({ index, item: children[index] });
    }
    return items;
  };

  return (
    <div className="relative w-full">
      <div ref={carouselRef} className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {getVisibleItems().map(({ index, item }) => (
            <div
              key={index}
              className="transition-all duration-500 ease-in-out"
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation buttons */}
      <button
        onClick={prevSlide}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 bg-black/60 hover:bg-[#db74cf]/80 text-white p-3 rounded-full z-10 shadow-lg border border-[#db74cf]/50 transition-all duration-300"
        aria-label="Previous slide"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>

      <button
        onClick={nextSlide}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 bg-black/60 hover:bg-[#db74cf]/80 text-white p-3 rounded-full z-10 shadow-lg border border-[#db74cf]/50 transition-all duration-300"
        aria-label="Next slide"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      {/* Pagination indicators */}
      <div className="flex justify-center mt-6 gap-2">
        {children.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`h-2 rounded-full transition-all duration-300 ${
              index === currentIndex
                ? "w-8 bg-[#db74cf]"
                : "w-2 bg-white/20 hover:bg-[#db74cf]/40"
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

