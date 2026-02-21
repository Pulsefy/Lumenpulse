import { gsap } from "gsap";

export const initFooterAnimations = (
  logoRef: React.RefObject<HTMLDivElement>,
  linksRef: React.MutableRefObject<(HTMLAnchorElement | null)[]>,
  dotsRef: React.MutableRefObject<(HTMLSpanElement | null)[]>,
  socialRef: React.MutableRefObject<(HTMLAnchorElement | null)[]>
) => {
  // Reset refs array to avoid duplicates
  linksRef.current = linksRef.current.filter(Boolean);
  dotsRef.current = dotsRef.current.filter(Boolean);
  socialRef.current = socialRef.current.filter(Boolean);

  // GSAP animations
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

  // Animate logo with higher z-index and isolation
  if (logoRef.current) {
    tl.from(logoRef.current, {
      y: 20,
      opacity: 0,
      duration: 0.8,
    });
  }

  // Animate links
  if (linksRef.current.length > 0) {
    tl.from(
      linksRef.current,
      {
        y: 15,
        opacity: 0,
        stagger: 0.05,
        duration: 0.6,
      },
      "-=0.4"
    );
  }

  // Animate dots
  if (dotsRef.current.length > 0) {
    tl.from(
      dotsRef.current,
      {
        scale: 0,
        opacity: 0,
        stagger: 0.03,
        duration: 0.4,
      },
      "-=0.6"
    );
  }

  // Animate social icons
  if (socialRef.current.length > 0) {
    tl.from(
      socialRef.current,
      {
        scale: 0.8,
        opacity: 0,
        stagger: 0.1,
        duration: 0.5,
      },
      "-=0.4"
    );
  }

  // Continuous subtle animation for the background elements
  gsap.to(".footer-hexagon", {
    rotation: "+=360",
    duration: 120,
    repeat: -1,
    ease: "none",
  });

  // Pulse animation for connection lines
  gsap.to(".connection-line", {
    strokeOpacity: 0.4,
    duration: 2,
    repeat: -1,
    yoyo: true,
    stagger: 0.3,
  });
};

