"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

export function BlockchainGrid() {
  const blockchainGridRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<(HTMLDivElement | null)[]>([]);
  const particlesRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (blockchainGridRef.current) {
      // Animate blockchain grid blocks
      gsap.fromTo(
        blocksRef.current,
        {
          opacity: 0,
          scale: 0,
        },
        {
          opacity: 1,
          scale: 1,
          stagger: 0.02,
          duration: 0.5,
          ease: "back.out(1.7)",
          delay: 0.3,
        }
      );

      // Create data flow animation with continuous flow
      const dataFlows =
        blockchainGridRef.current.querySelectorAll(".data-flow");
      dataFlows.forEach((flow, index) => {
        // Create continuous animation without stopping
        gsap.set(flow, { scaleX: 0, opacity: 0 });

        // Create timeline for continuous animation
        const tl = gsap.timeline({
          repeat: -1,
          repeatDelay: 0.2,
        });

        tl.to(flow, {
          scaleX: 1,
          opacity: 0.7,
          duration: 2,
          ease: "power1.inOut",
        });

        tl.to(flow, {
          opacity: 0,
          duration: 1,
          ease: "power1.in",
        });

        // Stagger the start times
        tl.delay(index * 0.3);
      });

      // Create pulsing animation for some blocks
      blocksRef.current.forEach((block, index) => {
        if (index % 5 === 0 && block) {
          gsap.to(block, {
            boxShadow: "0 0 15px rgba(59, 130, 246, 0.7)",
            backgroundColor: "rgba(59, 130, 246, 0.3)",
            duration: 1.5,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            delay: index * 0.1,
          });
        }
        if (index % 7 === 0 && block) {
          gsap.to(block, {
            boxShadow: "0 0 15px rgba(219, 116, 207, 0.7)",
            backgroundColor: "rgba(219, 116, 207, 0.3)",
            duration: 2,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            delay: index * 0.1,
          });
        }
      });

      // Animate particles with continuous movement
      particlesRef.current.forEach((particle, index) => {
        if (particle) {
          // Create random movement animation
          gsap.to(particle, {
            x: `random(-50, 50)`,
            y: `random(-50, 50)`,
            duration: 3 + Math.random() * 2,
            ease: "sine.inOut",
            repeat: -1,
            yoyo: true,
            delay: index * 0.2,
          });

          // Create pulsing effect
          gsap.to(particle, {
            scale: 1.5,
            opacity: 0.8,
            duration: 1.5 + Math.random(),
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            delay: index * 0.3,
          });
        }
      });
    }
  }, []);

  return (
    <div
      ref={blockchainGridRef}
      className="relative h-full w-full overflow-hidden"
    >
      {/* Grid of blocks */}
      <div className="grid grid-cols-10 grid-rows-6 gap-2 absolute inset-0">
        {Array.from({ length: 60 }).map((_, i) => (
          <div
            key={i}
            ref={(el) => (blocksRef.current[i] = el)}
            className="bg-black/50 border border-blue-500/20 rounded-md flex items-center justify-center backdrop-blur-sm"
          >
            {i % 10 === 3 && i % 10 !== 3 && (
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
            )}
            {i % 10 === 6 && i % 10 !== 6 && (
              <div className="w-1.5 h-1.5 rounded-full bg-[#db74cf]"></div>
            )}
          </div>
        ))}
      </div>

      {/* Data flow lines */}
      <div className="data-flow absolute top-[16%] left-0 h-[2px] w-full bg-gradient-to-r from-blue-500/0 via-blue-500 to-blue-500/0 transform origin-left"></div>
      <div className="data-flow absolute top-[32%] left-0 h-[2px] w-full bg-gradient-to-r from-[#db74cf]/0 via-[#db74cf] to-[#db74cf]/0 transform origin-left"></div>
      <div className="data-flow absolute top-[48%] left-0 h-[2px] w-full bg-gradient-to-r from-blue-500/0 via-blue-500 to-blue-500/0 transform origin-left"></div>
      <div className="data-flow absolute top-[64%] left-0 h-[2px] w-full bg-gradient-to-r from-[#db74cf]/0 via-[#db74cf] to-[#db74cf]/0 transform origin-left"></div>
      <div className="data-flow absolute top-[80%] left-0 h-[2px] w-full bg-gradient-to-r from-blue-500/0 via-blue-500 to-blue-500/0 transform origin-left"></div>

      {/* Vertical data flows */}
      <div className="data-flow absolute top-0 left-[20%] w-[2px] h-full bg-gradient-to-b from-blue-500/0 via-blue-500 to-blue-500/0 transform origin-top"></div>
      <div className="data-flow absolute top-0 left-[40%] w-[2px] h-full bg-gradient-to-b from-[#db74cf]/0 via-[#db74cf] to-[#db74cf]/0 transform origin-top"></div>
      <div className="data-flow absolute top-0 left-[60%] w-[2px] h-full bg-gradient-to-b from-blue-500/0 via-blue-500 to-blue-500/0 transform origin-top"></div>
      <div className="data-flow absolute top-0 left-[80%] w-[2px] h-full bg-gradient-to-b from-[#db74cf]/0 via-[#db74cf] to-[#db74cf]/0 transform origin-top"></div>

      {/* Floating particle nodes */}
      <div
        ref={(el) => (particlesRef.current[0] = el)}
        className="absolute top-1/4 left-1/4 w-3 h-3 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50"
      ></div>
      <div
        ref={(el) => (particlesRef.current[1] = el)}
        className="absolute top-3/4 left-2/3 w-3 h-3 rounded-full bg-[#db74cf] shadow-lg shadow-[#db74cf]/50"
      ></div>
      <div
        ref={(el) => (particlesRef.current[2] = el)}
        className="absolute top-1/2 left-3/4 w-3 h-3 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50"
      ></div>
      <div
        ref={(el) => (particlesRef.current[3] = el)}
        className="absolute top-1/3 left-1/2 w-3 h-3 rounded-full bg-[#db74cf] shadow-lg shadow-[#db74cf]/50"
      ></div>
      <div
        ref={(el) => (particlesRef.current[4] = el)}
        className="absolute top-2/3 left-1/3 w-3 h-3 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50"
      ></div>
    </div>
  );
}

