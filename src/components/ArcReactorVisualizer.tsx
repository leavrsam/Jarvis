import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { audioEngine, JarvisAudioState } from '../services/audioEngine';

interface ArcReactorVisualizerProps {
  state: JarvisAudioState;
  onReactorClick?: () => void;
}

export const ArcReactorVisualizer: React.FC<ArcReactorVisualizerProps> = ({
  state,
  onReactorClick,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 24;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 0.6);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00f0ff, 3, 50);
    pointLight.position.set(0, 0, 5);
    scene.add(pointLight);

    const innerLight = new THREE.PointLight(0xffffff, 4, 20);
    scene.add(innerLight);

    // 3. Reactor Objects Group
    const reactorGroup = new THREE.Group();
    scene.add(reactorGroup);

    // Colors
    const cyanColor = new THREE.Color(0x00f0ff);
    const darkCyanColor = new THREE.Color(0x005577);
    const amberColor = new THREE.Color(0xf59e0b);
    const whiteCyan = new THREE.Color(0xe0ffff);

    // A. Center Core Mesh (Wireframe Icosahedron + Inner Glowing Sphere)
    const coreGeom = new THREE.IcosahedronGeometry(2.2, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      wireframe: true,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9,
    });
    const coreMesh = new THREE.Mesh(coreGeom, coreMat);
    reactorGroup.add(coreMesh);

    // Inner Solid Glowing Orb
    const orbGeom = new THREE.SphereGeometry(1.4, 32, 32);
    const orbMat = new THREE.MeshBasicMaterial({
      color: 0xe0ffff,
      transparent: true,
      opacity: 0.85,
    });
    const orbMesh = new THREE.Mesh(orbGeom, orbMat);
    reactorGroup.add(orbMesh);

    // B. Concentric Ring 1: Inner Segmented Torus
    const ring1Geom = new THREE.TorusGeometry(3.6, 0.08, 16, 100);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00aacc,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.9,
    });
    const ring1 = new THREE.Mesh(ring1Geom, ring1Mat);
    reactorGroup.add(ring1);

    // C. Concentric Ring 2: Segmented Arc Ring (Tick Marks & Teeth)
    const ring2Group = new THREE.Group();
    const tickCount = 36;
    for (let i = 0; i < tickCount; i++) {
      const angle = (i / tickCount) * Math.PI * 2;
      const isMajor = i % 4 === 0;
      const tickGeom = new THREE.BoxGeometry(
        isMajor ? 0.35 : 0.18,
        0.05,
        isMajor ? 0.4 : 0.2
      );
      const tickMat = new THREE.MeshBasicMaterial({
        color: isMajor ? 0xe0ffff : 0x00c8e6,
        transparent: true,
        opacity: isMajor ? 0.95 : 0.65,
      });
      const tick = new THREE.Mesh(tickGeom, tickMat);
      const radius = 5.0;
      tick.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      tick.rotation.z = angle;
      ring2Group.add(tick);
    }
    reactorGroup.add(ring2Group);

    // D. Concentric Ring 3: Middle Counter-Rotating Gear Ring
    const ring3Geom = new THREE.RingGeometry(5.8, 6.2, 64);
    const ring3Mat = new THREE.MeshBasicMaterial({
      color: 0x007799,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
      wireframe: true,
    });
    const ring3 = new THREE.Mesh(ring3Geom, ring3Mat);
    reactorGroup.add(ring3);

    // E. Dynamic Waveform Reactive Ring (LineLoop with audio frequency vertices)
    const waveSegments = 128;
    const waveGeom = new THREE.BufferGeometry();
    const wavePositions = new Float32Array(waveSegments * 3);
    const baseWaveRadius = 7.4;

    for (let i = 0; i < waveSegments; i++) {
      const theta = (i / waveSegments) * Math.PI * 2;
      wavePositions[i * 3] = Math.cos(theta) * baseWaveRadius;
      wavePositions[i * 3 + 1] = Math.sin(theta) * baseWaveRadius;
      wavePositions[i * 3 + 2] = 0;
    }
    waveGeom.setAttribute('position', new THREE.BufferAttribute(wavePositions, 3));

    const waveMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      linewidth: 2,
      transparent: true,
      opacity: 0.85,
    });
    const waveRing = new THREE.LineLoop(waveGeom, waveMat);
    reactorGroup.add(waveRing);

    // F. Outer Horizon Ring with Circular Orbit Nodes
    const ring4Geom = new THREE.TorusGeometry(9.2, 0.04, 8, 120);
    const ring4Mat = new THREE.MeshBasicMaterial({
      color: 0x005577,
      transparent: true,
      opacity: 0.5,
    });
    const ring4 = new THREE.Mesh(ring4Geom, ring4Mat);
    reactorGroup.add(ring4);

    // Satellite nodes orbiting outer ring
    const satellitesGroup = new THREE.Group();
    const satCount = 6;
    for (let i = 0; i < satCount; i++) {
      const satGeom = new THREE.OctahedronGeometry(0.25, 0);
      const satMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
      });
      const sat = new THREE.Mesh(satGeom, satMat);
      sat.userData = { angle: (i / satCount) * Math.PI * 2, speed: 0.008 + (i % 2) * 0.004 };
      satellitesGroup.add(sat);
    }
    reactorGroup.add(satellitesGroup);

    // G. Arc Reactor Shroud / Stator Brackets (3-blade Stark style)
    const statorGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const bladeGeom = new THREE.BoxGeometry(0.8, 2.8, 0.15);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x021526,
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x004466,
        emissiveIntensity: 0.4,
      });
      const blade = new THREE.Mesh(bladeGeom, bladeMat);
      blade.position.set(Math.cos(angle) * 4.4, Math.sin(angle) * 4.4, 0.1);
      blade.rotation.z = angle + Math.PI / 2;
      statorGroup.add(blade);
    }
    reactorGroup.add(statorGroup);

    // H. Particle Cloud (Quantum dust orbiting reactor)
    const particleCount = 1200;
    const particleGeom = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleVelocities: { x: number; y: number; z: number; r: number; theta: number; speed: number }[] = [];

    for (let i = 0; i < particleCount; i++) {
      const radius = 2.5 + Math.random() * 9.5;
      const theta = Math.random() * Math.PI * 2;
      const z = (Math.random() - 0.5) * 4.0;

      particlePositions[i * 3] = Math.cos(theta) * radius;
      particlePositions[i * 3 + 1] = Math.sin(theta) * radius;
      particlePositions[i * 3 + 2] = z;

      particleVelocities.push({
        x: 0,
        y: 0,
        z,
        r: radius,
        theta,
        speed: (0.002 + Math.random() * 0.006) * (Math.random() > 0.5 ? 1 : -1),
      });
    }

    particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x00f0ff,
      size: 0.12,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    const particleCloud = new THREE.Points(particleGeom, particleMat);
    reactorGroup.add(particleCloud);

    // 4. Mouse Interactive Parallax
    let targetRotX = 0;
    let targetRotY = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.35;
      targetRotX = -y * 0.35;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // 5. Animation Loop with Audio Reactivity
    let animFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();

      // Read Web Audio API Analyser telemetry
      const audioTelemetry = audioEngine.getAudioTelemetry();
      const volume = audioTelemetry.volume; // 0.0 - 1.0
      const freqArray = audioTelemetry.frequencyData;
      const timeArray = audioTelemetry.timeDomainData;

      // Reactivity Multipliers based on Jarvis state
      let pulseMod = 1.0;
      let targetColor = cyanColor;
      let targetEmissive = cyanColor;

      if (state === 'listening') {
        // High reactivity to microphone
        pulseMod = 1.0 + volume * 2.8;
        targetColor = whiteCyan;
        targetEmissive = cyanColor;
      } else if (state === 'speaking') {
        // Voice modulation
        pulseMod = 1.0 + volume * 2.5;
        targetColor = cyanColor;
        targetEmissive = whiteCyan;
      } else if (state === 'processing') {
        // Quantum processing amber-cyan oscillation
        pulseMod = 1.2 + Math.sin(time * 8) * 0.3;
        targetColor = Math.sin(time * 5) > 0 ? amberColor : cyanColor;
        targetEmissive = amberColor;
      } else {
        // Idle breathing
        pulseMod = 1.0 + Math.sin(time * 2.0) * 0.08;
        targetColor = cyanColor;
        targetEmissive = darkCyanColor;
      }

      // Parallax smooth interpolation
      reactorGroup.rotation.y += (targetRotY - reactorGroup.rotation.y) * 0.05;
      reactorGroup.rotation.x += (targetRotX - reactorGroup.rotation.x) * 0.05;

      // Rotate Concentric Rings
      const baseSpeed = state === 'processing' ? 3.5 : 1.0;
      ring1.rotation.z += (0.012 * baseSpeed + volume * 0.05);
      ring2Group.rotation.z -= (0.008 * baseSpeed + volume * 0.04);
      ring3.rotation.z += (0.005 * baseSpeed + volume * 0.03);
      statorGroup.rotation.z += (0.003 * baseSpeed);
      ring4.rotation.z -= (0.004 * baseSpeed);

      // Core Mesh Rotation & Audio Pulsation
      coreMesh.rotation.x += 0.015 * pulseMod;
      coreMesh.rotation.y += 0.02 * pulseMod;
      const coreScale = (1.0 + volume * 0.85) * (0.95 + Math.sin(time * 3) * 0.05);
      coreMesh.scale.set(coreScale, coreScale, coreScale);

      // Inner Orb Glow
      const orbScale = (1.0 + volume * 1.1) * (1.0 + Math.sin(time * 4) * 0.06);
      orbMesh.scale.set(orbScale, orbScale, orbScale);
      orbMat.opacity = Math.min(1.0, 0.65 + volume * 0.6);

      // Material Emissive Intensity
      coreMat.emissiveIntensity = 0.5 + volume * 2.0;
      coreMat.color.lerp(targetColor, 0.1);
      coreMat.emissive.lerp(targetEmissive, 0.1);
      pointLight.intensity = 2.0 + volume * 6.0;
      pointLight.color.lerp(targetColor, 0.1);

      // Modulate Dynamic Waveform Ring Vertices
      const posAttr = waveGeom.attributes.position as THREE.BufferAttribute;
      const posArray = posAttr.array as Float32Array;

      for (let i = 0; i < waveSegments; i++) {
        const theta = (i / waveSegments) * Math.PI * 2;
        let waveOffset = 0;

        if (freqArray && freqArray.length > 0) {
          // Map segment to frequency bins
          const freqIndex = Math.floor((i / waveSegments) * (freqArray.length / 2));
          const freqVal = freqArray[freqIndex] || 0;
          waveOffset += (freqVal / 255) * 1.8;
        }

        if (timeArray && timeArray.length > 0) {
          const timeIndex = Math.floor((i / waveSegments) * timeArray.length);
          const timeVal = (timeArray[timeIndex] - 128) / 128; // -1 to 1
          waveOffset += timeVal * 0.9;
        }

        const r = baseWaveRadius + waveOffset * (state === 'idle' ? 0.2 : 1.0);
        posArray[i * 3] = Math.cos(theta) * r;
        posArray[i * 3 + 1] = Math.sin(theta) * r;
        posArray[i * 3 + 2] = Math.sin(theta * 4 + time * 3) * (volume * 0.5);
      }
      posAttr.needsUpdate = true;
      waveMat.color.lerp(targetColor, 0.1);
      waveMat.opacity = 0.6 + volume * 0.4;

      // Orbiting Satellites
      satellitesGroup.children.forEach((child) => {
        const sat = child as THREE.Mesh;
        sat.userData.angle += sat.userData.speed * (1 + volume * 3);
        const radius = 9.2;
        sat.position.set(
          Math.cos(sat.userData.angle) * radius,
          Math.sin(sat.userData.angle) * radius,
          Math.sin(sat.userData.angle * 2) * 0.8
        );
        sat.rotation.x += 0.05;
        sat.rotation.y += 0.05;
      });

      // Update Particle Cloud
      const partPosAttr = particleGeom.attributes.position as THREE.BufferAttribute;
      const partPosArray = partPosAttr.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const p = particleVelocities[i];
        p.theta += p.speed * (1.0 + volume * 4.0);
        const currentR = p.r + (volume > 0.1 ? Math.sin(time * 10 + i) * volume * 1.2 : 0);

        partPosArray[i * 3] = Math.cos(p.theta) * currentR;
        partPosArray[i * 3 + 1] = Math.sin(p.theta) * currentR;
        partPosArray[i * 3 + 2] = p.z + Math.sin(time * 2 + p.theta) * 0.4;
      }
      partPosAttr.needsUpdate = true;
      particleMat.color.lerp(targetColor, 0.1);

      renderer.render(scene, camera);
    };

    animate();

    // 6. Handle Window Resize
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      scene.clear();
    };
  }, [state]);

  return (
    <div
      ref={mountRef}
      onClick={onReactorClick}
      className="relative w-full h-full flex items-center justify-center cursor-pointer select-none group"
      title="Click Arc-Reactor to activate / toggle push-to-talk"
    >
      {/* Sci-fi Overlay HUD Reticle */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        {/* Circular Targeting Overlay */}
        <div className="w-[420px] h-[420px] rounded-full border border-cyan-500/15 animate-[spin_60s_linear_infinite]" />
        <div className="absolute w-[540px] h-[540px] rounded-full border border-dashed border-cyan-400/10 animate-[spin_90s_linear_infinite_reverse]" />
        
        {/* Radial crosshair lines */}
        <div className="absolute w-[680px] h-[1px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
        <div className="absolute h-[680px] w-[1px] bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent" />

        {/* Center prompt on hover */}
        <div className="absolute bottom-12 flex flex-col items-center opacity-70 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] tracking-[0.3em] font-orbitron uppercase text-cyan-300 text-glow-cyan">
            {state === 'listening' ? 'SYSTEM RECEIVING AUDIO INPUT' :
             state === 'speaking' ? 'VOCAL SYNTHESIZER ACTIVE' :
             state === 'processing' ? 'NEURAL ENGINE PROCESSING' :
             'CLICK OR HOLD SPACEBAR TO ENGAGE'}
          </span>
          <span className="text-[9px] font-mono-tech text-cyan-600/80 mt-1">
            ARC-REACTOR MK-VII // COUPLING: OPTIMAL
          </span>
        </div>
      </div>
    </div>
  );
};
