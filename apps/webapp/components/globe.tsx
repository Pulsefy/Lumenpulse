"use client";

import { useRef, useState, useEffect } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Sphere, OrbitControls as DreiOrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ArrowRight, LogIn } from "lucide-react";

function RotatingGlobe() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const texture = useLoader(THREE.TextureLoader, "/assets/globe-texture.jpg");

  // Set texture properties for better appearance
  useEffect(() => {
    if (texture) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 16;
    }
  }, [texture]);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.002;
    }
  });

  return (
    <Sphere ref={meshRef} args={[1, 64, 64]}>
      <meshPhysicalMaterial
        map={texture}
        color="#ffffff" // Use white to preserve texture colors
        emissive="#000000"
        clearcoat={0.4}
        clearcoatRoughness={0.1}
        metalness={0.2}
        roughness={0.6} // Increased roughness for texture
        bumpMap={texture}
        bumpScale={0.05} // Subtle bump effect
        displacementMap={texture}
        displacementScale={0.03} // Very subtle displacement
      />
    </Sphere>
  );
}

function Stars() {
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

  const starGeometry = {
    attributes: {
      position: new THREE.BufferAttribute(positions, 3),
      size: new THREE.BufferAttribute(sizes, 1),
      color: new THREE.BufferAttribute(colors, 3),
    },
  };

  // Space objects data - more varied celestial objects
  const spaceObjectCount = 8;
  const spaceObjects = useRef(
    Array(spaceObjectCount)
      .fill(0)
      .map((_, index) => {
        // Determine object type
        const objectType = index % 4; // 0: asteroid, 1: satellite, 2: comet, 3: small planet

        return {
          position: new THREE.Vector3(
            -12 - Math.random() * 8, // Start from further left
            (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 6
          ),
          velocity: new THREE.Vector3(
            0.005 + Math.random() * 0.015, // Slower movement
            (Math.random() - 0.5) * 0.003,
            (Math.random() - 0.5) * 0.003
          ),
          acceleration: new THREE.Vector3(
            0,
            (Math.random() - 0.5) * 0.0001,
            (Math.random() - 0.5) * 0.0001
          ),
          rotation: new THREE.Euler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
          ),
          rotationSpeed: {
            x: (Math.random() - 0.5) * 0.01,
            y: (Math.random() - 0.5) * 0.01,
            z: (Math.random() - 0.5) * 0.01,
          },
          scale:
            objectType === 3
              ? 0.08 + Math.random() * 0.04
              : 0.04 + Math.random() * 0.03,
          type: objectType,
          active: true,
          resetTimer: Math.random() * 400,
          color:
            objectType === 0
              ? 0x887766 // asteroid: brownish
              : objectType === 1
                ? 0x99aacc // satellite: bluish-silver
                : objectType === 2
                  ? 0xaaddff // comet: light blue
                  : 0xaa7755, // small planet: reddish-brown,
        };
      })
  );

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

    // Update space objects
    if (spaceObjectsRef.current) {
      spaceObjects.current.forEach((obj, index) => {
        const group = spaceObjectsRef.current.children[index] as THREE.Group;

        if (obj.resetTimer > 0) {
          obj.resetTimer -= 1;
          group.visible = false;
          return;
        }

        if (!obj.active) {
          // Reset object position
          obj.position.set(
            -12 - Math.random() * 8,
            (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 6
          );
          obj.velocity.set(
            0.005 + Math.random() * 0.015,
            (Math.random() - 0.5) * 0.003,
            (Math.random() - 0.5) * 0.003
          );
          obj.acceleration.set(
            0,
            (Math.random() - 0.5) * 0.0001,
            (Math.random() - 0.5) * 0.0001
          );
          obj.active = true;
          obj.resetTimer = Math.random() * 400;
          group.visible = false;
          return;
        }

        // Update velocity with acceleration (creates curved paths)
        obj.velocity.add(obj.acceleration);

        // Update position
        obj.position.add(obj.velocity);

        // Update rotation
        obj.rotation.x += obj.rotationSpeed.x;
        obj.rotation.y += obj.rotationSpeed.y;
        obj.rotation.z += obj.rotationSpeed.z;

        // Update group
        group.visible = true;
        group.position.copy(obj.position);
        group.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);

        // Add comet tail if it's a comet
        if (obj.type === 2 && group.children.length > 1) {
          const tail = group.children[1] as THREE.Mesh;
          // Point tail away from direction of travel
          const tailDirection = new THREE.Vector3(
            -obj.velocity.x,
            -obj.velocity.y,
            -obj.velocity.z
          ).normalize();
          tail.position.copy(tailDirection.multiplyScalar(0.4));
          tail.lookAt(tailDirection.add(tail.position));
        }

        // Check if out of bounds
        if (obj.position.x > 12) {
          obj.active = false;
        }
      });
    }
  });

  return (
    <>
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

      <group ref={spaceObjectsRef}>
        {spaceObjects.current.map((obj, i) => (
          <group key={i} scale={obj.scale}>
            {/* Main body - different geometry based on type */}
            {obj.type === 0 && (
              // Asteroid - irregular shape
              <mesh>
                <dodecahedronGeometry args={[0.5, 0]} />
                <meshStandardMaterial
                  color={new THREE.Color(obj.color)}
                  roughness={0.8}
                />
              </mesh>
            )}

            {obj.type === 1 && (
              // Satellite - composite shape
              <>
                <mesh>
                  <boxGeometry args={[0.7, 0.2, 0.2]} />
                  <meshStandardMaterial
                    color={new THREE.Color(obj.color)}
                    metalness={0.8}
                    roughness={0.2}
                  />
                </mesh>
                <mesh position={[0, 0.4, 0]}>
                  <cylinderGeometry args={[0.05, 0.05, 0.8, 8]} />
                  <meshStandardMaterial
                    color="#aaaaaa"
                    metalness={0.8}
                    roughness={0.2}
                  />
                </mesh>
                <mesh position={[0, 0.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.3, 16]} />
                  <meshStandardMaterial
                    color="#3377aa"
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </>
            )}

            {obj.type === 2 && (
              // Comet - with tail
              <>
                <mesh>
                  <sphereGeometry args={[0.3, 16, 16]} />
                  <meshStandardMaterial
                    color={new THREE.Color(obj.color)}
                    emissive="#335577"
                    emissiveIntensity={0.5}
                  />
                </mesh>
                <mesh position={[0.4, 0, 0]}>
                  <coneGeometry args={[0.2, 1.2, 16, 1, true]} />
                  <meshBasicMaterial
                    color="#aaddff"
                    transparent
                    opacity={0.6}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </>
            )}

            {obj.type === 3 && (
              // Small planet
              <mesh>
                <sphereGeometry args={[0.5, 24, 24]} />
                <meshStandardMaterial color={new THREE.Color(obj.color)} />
              </mesh>
            )}
          </group>
        ))}
      </group>
    </>
  );
}

// Clean grid lines without diagonal artifacts at intersections
function GridLines() {
  const linesMaterial = new THREE.LineBasicMaterial({
    color: "#e8787d",
    transparent: true,
    opacity: 0.15,
  });

  // Create latitude lines (horizontal circles)
  const latitudeLines = [];
  const latitudeCount = 12;

  for (let i = 0; i < latitudeCount; i++) {
    const phi = (Math.PI * i) / (latitudeCount - 1);
    const radius = 1.01;

    const points = [];
    const segments = 48;

    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);

      points.push(new THREE.Vector3(x, y, z));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, linesMaterial);
    latitudeLines.push(<primitive key={`lat-${i}`} object={line} />);
  }

  // Create longitude lines (vertical half-circles)
  const longitudeLines = [];
  const longitudeCount = 24;

  for (let i = 0; i < longitudeCount; i++) {
    const theta = (i / longitudeCount) * Math.PI * 2;
    const radius = 1.01;

    const points = [];
    const segments = 48;

    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * Math.PI;
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);

      points.push(new THREE.Vector3(x, y, z));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, linesMaterial);
    longitudeLines.push(<primitive key={`lon-${i}`} object={line} />);
  }

  return (
    <group>
      {latitudeLines}
      {longitudeLines}
    </group>
  );
}

// Simplified atmosphere with more subtle effect
function Atmosphere() {
  return (
    <Sphere args={[1.03, 32, 32]}>
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.05}
        side={THREE.BackSide}
      />
    </Sphere>
  );
}

// Add the main Globe component export
export function Globe() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.5], fov: 45 }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.2} />
      <directionalLight position={[5, 3, 5]} intensity={0.5} />
      <RotatingGlobe />
      <GridLines />
      <Atmosphere />
      <Stars />
      <DreiOrbitControls
        enableZoom={false}
        enablePan={false}
        rotateSpeed={0.4}
        autoRotate
        autoRotateSpeed={0.5}
      />
    </Canvas>
  );
}

