import { StellarProvider } from "./providers";
import { StarsAnimation } from "@/components/stars-animation";
import { PWAInstaller } from "@/components/pwa-installer";
import "./globals.css";
import type { Metadata } from "next";
import {
  Inter,
  Orbitron,
  Space_Mono,
  Chakra_Petch,
  Poppins,
} from "next/font/google";

// Font definitions
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
  display: "swap",
});

const chakraPetch = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-chakra",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

// Enhanced PWA Metadata
export const metadata: Metadata = {
  title: "Lumenpulse - Decentralized Crypto News Platform",
  description: "Your trusted source for crypto news, trends, and insights powered by Stellar.",
  keywords: ["crypto", "blockchain", "Stellar", "DeFi", "news", "cryptocurrency", "Web3"],
  authors: [{ name: "Lumenpulse Team" }],
  creator: "Lumenpulse",
  publisher: "Lumenpulse",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  // PWA Configuration
  manifest: "/manifest.json",
  // Favicon and Icons
  icons: {
    icon: [
      { url: "/assets/lumenpulse-03.png", sizes: "71x71", type: "image/png" },
      { url: "/assets/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/assets/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [
      { url: "/assets/lumenpulse-03.png", sizes: "71x71", type: "image/png" }
    ],
    apple: [
      { url: "/assets/lumenpulse-03.png", sizes: "71x71", type: "image/png" },
      { url: "/assets/icons/icon-152x152.png", sizes: "152x152", type: "image/png" },
      { url: "/assets/icons/icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  // Open Graph
  openGraph: {
    title: "Lumenpulse - Decentralized Crypto News Platform",
    description: "Your trusted source for crypto news, trends, and insights powered by Stellar.",
    url: "https://Lumenpulse.app",
    siteName: "Lumenpulse",
    images: [
      {
        url: "/assets/lumenpulse-03.png",
        width: 71,
        height: 71,
        alt: "Lumenpulse Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  // Twitter
  twitter: {
    card: "summary_large_image",
    title: "Lumenpulse - Decentralized Crypto News Platform",
    description: "Your trusted source for crypto news, trends, and insights powered by Stellar.",
    images: ["/assets/lumenpulse-03.png"],
    creator: "@Lumenpulse",
  },
  // PWA specific
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lumenpulse",
    startupImage: [
      {
        url: "/assets/lumenpulse-03.png",
        media: "(device-width: 768px) and (device-height: 1024px)",
      },
    ],
  },
  // Verification
  verification: {
    google: "your-google-verification-code",
    yandex: "your-yandex-verification-code",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* PWA Meta Tags */}
        <meta name="application-name" content="Lumenpulse" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Lumenpulse" />
        <meta name="description" content="Your trusted source for crypto news, trends, and insights powered by Stellar." />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="msapplication-tap-highlight" content="no" />
        <meta name="theme-color" content="#db74cf" />
        
        {/* Favicon */}
        <link rel="icon" type="image/png" sizes="71x71" href="/assets/lumenpulse-03.png" />
        <link rel="shortcut icon" href="/assets/lumenpulse-03.png" />
        
        {/* Apple Touch Icons */}
        <link rel="apple-touch-icon" href="/assets/lumenpulse-03.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/assets/icons/icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/icon-180x180.png" />
        
        {/* Manifest */}
        <link rel="manifest" href="/manifest.json" />
        
        {/* Splash Screens */}
        <link rel="apple-touch-startup-image" href="/assets/lumenpulse-03.png" />
        
        {/* Microsoft */}
        <meta name="msapplication-TileImage" content="/assets/lumenpulse-03.png" />
      </head>
      <body
        className={`${inter.variable} ${orbitron.variable} ${spaceMono.variable} ${chakraPetch.variable} ${poppins.variable} font-inter bg-background text-foreground`}
      >
        <StellarProvider>
          <StarsAnimation />
          {children}
          <PWAInstaller />
        </StellarProvider>
      </body>
    </html>
  );
}



