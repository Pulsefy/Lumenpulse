"use client";

import { useEffect, useRef, useState } from "react";
import { textChangeAnimation, fadeInAnimation } from "@/lib/text-animations";

export interface WelcomeMessage {
  text: string;
  lang: string;
}

interface MultilingualWelcomeProps {
  messages?: WelcomeMessage[];
  interval?: number;
  className?: string;
  textClassName?: string;
}

export function MultilingualWelcome({
  messages = [
    { text: "Welcome", lang: "English" },
    { text: "Bienvenue", lang: "French" },
    { text: "Bienvenido", lang: "Spanish" },
    { text: "Willkommen", lang: "German" },
    { text: "欢迎", lang: "Chinese" },
    { text: "ようこそ", lang: "Japanese" },
    { text: "환영합니다", lang: "Korean" },
    { text: "Bem-vindo", lang: "Portuguese" },
    { text: "Добро пожаловать", lang: "Russian" },
    { text: "مرحباً", lang: "Arabic" },
  ],
  interval = 3000,
  className = "text-5xl md:text-6xl font-bold text-white mb-6 font-raleway min-h-[80px] flex items-center",
  textClassName = "text-white",
}: MultilingualWelcomeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const textRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Animation for text change
    const changeText = () => {
      if (textRef.current) {
        textChangeAnimation(textRef.current, () => {
          setCurrentIndex((prevIndex) => (prevIndex + 1) % messages.length);
        });
      }
    };

    // Set interval for changing text
    const intervalId = setInterval(changeText, interval);

    // Initial animation
    if (textRef.current) {
      fadeInAnimation(textRef.current);
    }

    // Clean up interval on component unmount
    return () => clearInterval(intervalId);
  }, [messages.length, interval]);

  return (
    <h1 ref={textRef} className={className}>
      <span className={textClassName}>{messages[currentIndex].text}</span>
    </h1>
  );
}

