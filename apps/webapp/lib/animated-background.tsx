"use client";

import { StarsBackground } from "@/components/stars-background";
import { useEffect, useRef } from "react";
import gsap from "gsap";

export function AnimatedBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create the animation for the stars
    const stars = containerRef.current.querySelectorAll(".star");

    stars.forEach((star) => {
      // Random starting position
      gsap.set(star, {
        x: `random(0, 100)%`,
        y: `random(0, 100)%`,
        scale: `random(0.1, 1)`,
        opacity: `random(0.1, 0.7)`,
      });

      // Create twinkling animation
      gsap.to(star, {
        opacity: `random(0.1, 0.7)`,
        scale: `random(0.1, 1)`,
        duration: `random(1, 3)`,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      // Create subtle movement
      gsap.to(star, {
        x: "+=10",
        y: "+=10",
        duration: `random(10, 20)`,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    });

    return () => {
      // Clean up animations when component unmounts
      gsap.killTweensOf(stars);
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 z-0 pointer-events-none">
      <StarsBackground />
    </div>
  );
}

