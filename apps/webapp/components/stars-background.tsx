"use client";

import { useRef, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function StarsField() {
  const starsRef = useRef<THREE.Points>(null!);
  const spaceObjectsRef = useRef<THREE.Group>(null!);

  // Enhanced star system with varied sizes and colors
  const starCount = 4000;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const colors = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * 15;
    positions[i3 + 1] = (Math.random() - 0.5) * 15;
    positions[i3 + 2] = (Math.random() - 0.5) * 15;

    // Varied star sizes
    sizes[i] = Math.random() * 0.5 + 0.1;

    // Subtle color variations
    const colorChoice = Math.random();
    if (colorChoice > 0.95) {
      // Rare blue stars
      colors[i3] = 0.7 + Math.random() * 0.3; // R
      colors[i3 + 1] = 0.7 + Math.random() * 0.3; // G
      colors[i3 + 2] = 1.0; // B
    } else if (colorChoice > 0.9) {
      // Occasional yellow/orange stars
      colors[i3] = 1.0; // R
      colors[i3 + 1] = 0.7 + Math.random() * 0.3; // G
      colors[i3 + 2] = 0.5 * Math.random(); // B
    } else {
      // Mostly white/blue-white stars
      const shade = 0.8 + Math.random() * 0.2;
      colors[i3] = shade; // R
      colors[i3 + 1] = shade; // G
      colors[i3 + 2] = shade + Math.random() * 0.1; // B (slightly bluer)
    }
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)
  );
  starGeometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  // Subtle star twinkling effect
  const twinkleSpeed = useRef(
    Array(starCount)
      .fill(0)
      .map(() => 0.003 + Math.random() * 0.005)
  );
  const twinklePhase = useRef(
    Array(starCount)
      .fill(0)
      .map(() => Math.random() * Math.PI * 2)
  );

  useFrame(({ clock }) => {
    // Subtle twinkling effect for stars
    if (starsRef.current) {
      const sizes = starsRef.current.geometry.attributes.size
        .array as Float32Array;

      for (let i = 0; i < starCount; i++) {
        const phase = twinklePhase.current[i];
        const speed = twinkleSpeed.current[i];

        // Sine wave oscillation for size
        const oscillation = Math.sin(clock.elapsedTime * speed + phase);
        const baseSizeIndex = i;
        const originalSize = sizes[baseSizeIndex];

        // Apply subtle size variation (±15%)
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

export function StarsBackground() {
  // Generate stars with a class for animation
  const stars = Array.from({ length: 200 }).map((_, i) => (
    <div
      key={i}
      className="star absolute rounded-full bg-white"
      style={{
        width: Math.random() * 2 + 1 + "px",
        height: Math.random() * 2 + 1 + "px",
      }}
    />
  ));

  return <div className="w-full h-full relative overflow-hidden">{stars}</div>;
}

