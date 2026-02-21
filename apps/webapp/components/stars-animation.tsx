"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function AnimatedStars() {
  const starsRef = useRef<THREE.Points>(null!);

  // Memoize star geometry creation to prevent recreation on each render
  const { starGeometry, twinkleSpeed, twinklePhase, starCount } =
    useMemo(() => {
      const starCount = 3000;
      const positions = new Float32Array(starCount * 3);
      const sizes = new Float32Array(starCount);
      const colors = new Float32Array(starCount * 3);

      for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;
        positions[i3] = (Math.random() - 0.5) * 15;
        positions[i3 + 1] = (Math.random() - 0.5) * 15;
        positions[i3 + 2] = (Math.random() - 0.5) * 15;

        sizes[i] = Math.random() * 0.5 + 0.1;

        const colorChoice = Math.random();
        if (colorChoice > 0.95) {
          colors[i3] = 0.7 + Math.random() * 0.3;
          colors[i3 + 1] = 0.7 + Math.random() * 0.3;
          colors[i3 + 2] = 1.0;
        } else if (colorChoice > 0.9) {
          colors[i3] = 1.0;
          colors[i3 + 1] = 0.7 + Math.random() * 0.3;
          colors[i3 + 2] = 0.5 * Math.random();
        } else {
          const shade = 0.8 + Math.random() * 0.2;
          colors[i3] = shade;
          colors[i3 + 1] = shade;
          colors[i3 + 2] = shade + Math.random() * 0.1;
        }
      }

      const starGeometry = new THREE.BufferGeometry();
      starGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );
      starGeometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
      starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const twinkleSpeed = Array(starCount)
        .fill(0)
        .map(() => 0.003 + Math.random() * 0.005);

      const twinklePhase = Array(starCount)
        .fill(0)
        .map(() => Math.random() * Math.PI * 2);

      return { starGeometry, twinkleSpeed, twinklePhase, starCount };
    }, []);

  useFrame(({ clock }) => {
    if (starsRef.current && Math.floor(clock.elapsedTime * 30) % 2 === 0) {
      const sizes = starsRef.current.geometry.attributes.size
        .array as Float32Array;

      for (let i = 0; i < starCount; i++) {
        const phase = twinklePhase[i];
        const speed = twinkleSpeed[i];

        const oscillation = Math.sin(clock.elapsedTime * speed + phase);
        const baseSizeIndex = i;
        const originalSize = sizes[baseSizeIndex];

        sizes[baseSizeIndex] = originalSize * (0.85 + oscillation * 0.15);
      }

      starsRef.current.geometry.attributes.size.needsUpdate = true;
    }
  });

  return (
    <points ref={starsRef}>
      <bufferGeometry {...starGeometry} />
      <pointsMaterial
        size={0.015}
        vertexColors
        transparent
        opacity={0.8}
        sizeAttenuation={true}
      />
    </points>
  );
}

export function StarsAnimation() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <Canvas
        camera={{
          position: [0, 0, 5],
          fov: 60,
          near: 0.1,
          far: 1000,
        }}
        gl={{
          antialias: true,
          alpha: true,
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <color attach="background" args={["#000000"]} />
        <AnimatedStars />
      </Canvas>
    </div>
  );
}

