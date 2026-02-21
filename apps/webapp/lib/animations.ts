import gsap from "gsap";

// Optimized animation functions
export const animateFormElements = (
  elements: Element[] | NodeListOf<Element>,
  options = {}
) => {
  return gsap.fromTo(
    elements,
    { y: 20, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      stagger: 0.05,
      duration: 0.4,
      ease: "power2.out",
      ...options,
    }
  );
};

export const animateNodes = (nodes: any[], options = {}) => {
  return gsap.fromTo(
    nodes,
    { scale: 0, opacity: 0 },
    {
      scale: 1,
      opacity: 1,
      stagger: 0.1,
      duration: 0.6,
      ease: "back.out(1.7)",
      ...options,
    }
  );
};

export const animateLines = (selector: string, options = {}) => {
  return gsap.fromTo(
    selector,
    { scaleX: 0, opacity: 0 },
    {
      scaleX: 1,
      opacity: 0.5,
      stagger: 0.1,
      duration: 0.8,
      ease: "power2.inOut",
      ...options,
    }
  );
};

// Create a timeline for grouped animations
export const createAnimationTimeline = (defaults = {}) => {
  return gsap.timeline({ defaults: { ease: "power2.out", ...defaults } });
};

