"use client";

import { useState } from "react";
import { Rocket, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function ButtonGroup() {
  const [hoverJoin, setHoverJoin] = useState(false);
  const [hoverExplore, setHoverExplore] = useState(false);
  const router = useRouter();

  return (
    <div className="flex justify-center gap-4">
      <button
        className={`relative overflow-hidden rounded-lg px-6 py-2.5 text-base font-medium transition-all duration-300 ease-out 
          ${hoverJoin ? "text-[var(--text-button-gradient)]" : "bg-transparent text-white"}`}
        onMouseEnter={() => setHoverJoin(true)}
        onMouseLeave={() => setHoverJoin(false)}
        onClick={() => router.push("/auth/login")}
        style={{
          boxShadow: hoverJoin
            ? "0 0 15px rgba(219, 116, 207, 0.5), 0 0 30px rgba(219, 116, 207, 0.3)"
            : "0 0 0 2px rgba(255, 255, 255, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.2) inset",
          backdropFilter: "blur(4px)",
        }}
      >
        <span className="relative z-10 flex items-center gap-2">
          Join Community{" "}
          <Users
            className={`h-4 w-4 transition-transform duration-300 ${hoverJoin ? "translate-x-1" : ""}`}
          />
        </span>
        <div
          className="absolute inset-0 z-0 opacity-0 transition-opacity duration-300"
          style={{
            opacity: hoverJoin ? 1 : 0,
            background:
              "linear-gradient(270deg, var(--surface-button-gradient-default-a) 0%, var(--surface-button-gradient-default-b) 51%, var(--surface-button-gradient-default-c) 100%)",
          }}
        />
      </button>

      <button
        className={`relative overflow-hidden rounded-lg px-6 py-2.5 text-base font-medium transition-all duration-300 ease-out 
          ${hoverExplore ? "text-[var(--text-button-gradient)]" : "bg-transparent text-white"}`}
        onMouseEnter={() => setHoverExplore(true)}
        onMouseLeave={() => setHoverExplore(false)}
        onClick={() => router.push("/news")}
        style={{
          boxShadow: hoverExplore
            ? "0 0 15px rgba(219, 116, 207, 0.5), 0 0 30px rgba(219, 116, 207, 0.3)"
            : "0 0 0 2px rgba(255, 255, 255, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.2) inset",
          backdropFilter: "blur(4px)",
        }}
      >
        <span className="relative z-10 flex items-center gap-2">
          Explore Platform{" "}
          <Rocket
            className={`h-4 w-4 transition-transform duration-300 ${hoverExplore ? "translate-x-1" : ""}`}
          />
        </span>
        <div
          className="absolute inset-0 z-0 opacity-0 transition-opacity duration-300"
          style={{
            opacity: hoverExplore ? 1 : 0,
            background:
              "linear-gradient(270deg, var(--surface-button-gradient-default-a) 0%, var(--surface-button-gradient-default-b) 51%, var(--surface-button-gradient-default-c) 100%)",
          }}
        />
      </button>
    </div>
  );
}

