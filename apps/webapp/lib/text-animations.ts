import gsap from "gsap";

export const textChangeAnimation = (
  element: HTMLElement,
  onComplete?: () => void,
  duration = 0.5
) => {
  gsap.to(element, {
    opacity: 0,
    y: -20,
    duration,
    onComplete: () => {
      if (onComplete) onComplete();
      gsap.to(element, {
        opacity: 1,
        y: 0,
        duration,
      });
    },
  });
};

export const fadeInAnimation = (
  element: HTMLElement,
  startY = 30,
  duration = 0.8
) => {
  gsap.fromTo(
    element,
    { opacity: 0, y: startY },
    { opacity: 1, y: 0, duration }
  );
};

export const containerFadeIn = (
  element: HTMLElement,
  duration = 0.8,
  ease = "power2.out"
) => {
  gsap.fromTo(
    element,
    { opacity: 0 },
    { opacity: 1, duration, ease }
  );
};
