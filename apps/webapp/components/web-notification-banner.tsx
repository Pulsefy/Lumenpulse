"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Bell, ChevronRight } from "lucide-react";
import type { DeepLinkData } from "@/lib/web-push-service";
import { navigateToDeepLinkWeb } from "@/lib/web-push-service";

interface ForegroundNotification {
  title: string;
  body: string;
  deepLink: DeepLinkData | null;
  timestamp: number;
}

/**
 * WebForegroundNotificationBanner
 *
 * Displays a non-intrusive toast banner at the top-right of the screen
 * when a push notification arrives while the web app is in the foreground.
 * Tapping the banner navigates to the deep link target.
 * Auto-dismisses after 8 seconds.
 */
export function WebForegroundNotificationBanner() {
  const [banner, setBanner] = useState<ForegroundNotification | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const dismissBanner = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => setBanner(null), 300); // Wait for animation
  }, []);

  useEffect(() => {
    const handlePushNotification = (event: Event) => {
      const customEvent = event as CustomEvent<ForegroundNotification>;
      const { title, body, deepLink } = customEvent.detail;

      setBanner({ title, body, deepLink, timestamp: Date.now() });
      setIsVisible(true);

      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        dismissBanner();
      }, 8000);
    };

    window.addEventListener(
      "lumenpulse-push-notification",
      handlePushNotification as EventListener
    );

    return () => {
      window.removeEventListener(
        "lumenpulse-push-notification",
        handlePushNotification as EventListener
      );
    };
  }, [dismissBanner]);

  const handleBannerClick = () => {
    if (banner?.deepLink) {
      navigateToDeepLinkWeb(banner.deepLink);
    }
    dismissBanner();
  };

  if (!banner) return null;

  return (
    <div
      className={`fixed top-4 right-4 z-[9999] max-w-sm transition-all duration-300 ${
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
      }`}
      role="alert"
      aria-live="polite"
    >
      <div className="bg-black/90 border border-[#db74cf]/50 rounded-xl backdrop-blur-md shadow-2xl">
        <div className="flex items-start gap-3 p-4">
          {/* Icon */}
          <div className="flex-shrink-0 w-9 h-9 bg-gradient-to-r from-[#db74cf] to-blue-500 rounded-lg flex items-center justify-center">
            <Bell className="w-4 h-4 text-white" />
          </div>

          {/* Content */}
          <button
            onClick={handleBannerClick}
            className="flex-1 text-left focus:outline-none"
            aria-label={`Notification: ${banner.title}. Tap to view.`}
          >
            <h4 className="text-white font-semibold text-sm mb-0.5 truncate">
              {banner.title}
            </h4>
            <p className="text-gray-300 text-xs line-clamp-2">
              {banner.body}
            </p>
          </button>

          {/* Deep link arrow */}
          {banner.deepLink && (
            <button
              onClick={handleBannerClick}
              className="flex-shrink-0 mt-1"
              aria-label="Navigate to details"
            >
              <ChevronRight className="w-4 h-4 text-[#db74cf]" />
            </button>
          )}

          {/* Close button */}
          <button
            onClick={dismissBanner}
            className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
