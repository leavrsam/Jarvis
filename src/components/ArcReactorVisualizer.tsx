import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { audioEngine, JarvisAudioState } from '../services/audioEngine';

interface ArcReactorVisualizerProps {
  state: JarvisAudioState;
  onReactorClick?: () => void;
}

// Procedural high-resolution radial glow texture for luminous energy blooms & particles
function createGlowTexture(
  size = 256,
  inner = 'rgba(255, 255, 255, 1)',
  mid = 'rgba(0, 240, 255, 0.85)',
  outer = 'rgba(0, 50, 160, 0)'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const center = size / 2;
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.2, mid);
    grad.addColorStop(0.55, 'rgba(0, 140, 255, 0.25)');
    grad.addColorStop(1, outer);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  return texture;
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
    camera.position.z = 25;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    container.appendChild(renderer.domElement);

    // 2. Lighting (Deep space holographic atmosphere)
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 0.8);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00f0ff, 4, 40);
    pointLight.position.set(0, 0, 4);
    scene.add(pointLight);

    const coreLight = new THREE.PointLight(0xffffff, 5, 20);
    coreLight.position.set(0, 0, 1);
    scene.add(coreLight);

    // Master Group with cinematic floating pivot
    const masterPivot = new THREE.Group();
    scene.add(masterPivot);

    const reactorGroup = new THREE.Group();
    masterPivot.add(reactorGroup);

    // Color definitions
    const cyanColor = new THREE.Color(0x00f0ff);
    const brightWhiteCyan = new THREE.Color(0xecfeff);
    const deepBlueColor = new THREE.Color(0x0066cc);
    const amberColor = new THREE.Color(0xf59e0b);

    // Procedural glow textures
    const coreGlowTex = createGlowTexture(512, 'rgba(255, 255, 255, 1)', 'rgba(0, 240, 255, 0.9)', 'rgba(0, 20, 80, 0)');
    const particleTex = createGlowTexture(128, 'rgba(255, 255, 255, 1)', 'rgba(0, 230, 255, 0.8)', 'rgba(0, 60, 180, 0)');

    // ==========================================
    // A. ULTRA-PREMIUM ARC REACTOR CORE (ENERGY SINGULARITY)
    // ==========================================
    const coreContainer = new THREE.Group();
    reactorGroup.add(coreContainer);

    // Layer 1: Core Radiant Volumetric Bloom Sprite
    const coreSpriteMat = new THREE.SpriteMaterial({
      map: coreGlowTex,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreSprite = new THREE.Sprite(coreSpriteMat);
    coreSprite.scale.set(7.5, 7.5, 1);
    coreContainer.add(coreSprite);

    // Layer 2: Inner Laser Fusion Singularity (Multi-layered Additive Sphere)
    const innerPlasmaGeom = new THREE.SphereGeometry(1.4, 32, 32);
    const innerPlasmaMat = new THREE.MeshBasicMaterial({
      color: 0xe0ffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerPlasma = new THREE.Mesh(innerPlasmaGeom, innerPlasmaMat);
    coreContainer.add(innerPlasma);

    // Layer 3: Nested Precision Gyroscopic Rings
    const gyroGroup = new THREE.Group();
    coreContainer.add(gyroGroup);

    const createGyroRing = (radius: number, tube: number, color: number) => {
      const geom = new THREE.TorusGeometry(radius, tube, 16, 90);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
      });
      return new THREE.Mesh(geom, mat);
    };

    const gyro1 = createGyroRing(2.1, 0.025, 0x00f0ff);
    const gyro2 = createGyroRing(2.5, 0.02, 0x38bdf8);
    const gyro3 = createGyroRing(2.9, 0.02, 0x0284c7);
    gyroGroup.add(gyro1);
    gyroGroup.add(gyro2);
    gyroGroup.add(gyro3);

    // Layer 4: Intricate Multi-Facet Collimator Cage (Fine Polyhedral Lattice)
    const cageGeom = new THREE.IcosahedronGeometry(2.35, 2);
    const cageMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    const cageMesh = new THREE.Mesh(cageGeom, cageMat);
    coreContainer.add(cageMesh);

    // ==========================================
    // B. PRECISION COLLIMATOR APERTURE (STARK MK-VII IRIS)
    // ==========================================
    // 12 precision collimator blades with micro-etched bevels instead of chunky blocks
    const collimatorGroup = new THREE.Group();
    reactorGroup.add(collimatorGroup);

    const bladeCount = 12;
    for (let i = 0; i < bladeCount; i++) {
      const angle = (i / bladeCount) * Math.PI * 2;
      const bladeGeom = new THREE.BoxGeometry(0.24, 1.4, 0.08);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x03182b,
        emissive: 0x00a8cc,
        emissiveIntensity: 0.5,
        metalness: 0.9,
        roughness: 0.1,
      });
      const blade = new THREE.Mesh(bladeGeom, bladeMat);
      const radius = 3.65;
      blade.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.05);
      blade.rotation.z = angle;
      collimatorGroup.add(blade);

      // Micro LED tip on each blade
      const tipGeom = new THREE.BoxGeometry(0.12, 0.18, 0.1);
      const tipMat = new THREE.MeshBasicMaterial({
        color: 0xe0ffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      const tip = new THREE.Mesh(tipGeom, tipMat);
      tip.position.set(0, 0.65, 0.02);
      blade.add(tip);
    }

    // ==========================================
    // C. CONCENTRIC HOLOGRAPHIC RETICLE & DIAL RINGS
    // ==========================================

    // Ring 1: High-Density Micro Chronograph Ticks (72 Fine Notches)
    const dialTicksGroup = new THREE.Group();
    reactorGroup.add(dialTicksGroup);

    const dialCount = 72;
    for (let i = 0; i < dialCount; i++) {
      const angle = (i / dialCount) * Math.PI * 2;
      const isMajor = i % 6 === 0;
      const tickGeom = new THREE.BoxGeometry(
        isMajor ? 0.35 : 0.14,
        isMajor ? 0.035 : 0.015,
        0.02
      );
      const tickMat = new THREE.MeshBasicMaterial({
        color: isMajor ? 0xe0ffff : 0x0284c7,
        transparent: true,
        opacity: isMajor ? 0.9 : 0.45,
        blending: THREE.AdditiveBlending,
      });
      const tick = new THREE.Mesh(tickGeom, tickMat);
      const radius = 5.2;
      tick.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      tick.rotation.z = angle;
      dialTicksGroup.add(tick);
    }

    // Ring 2: Sleek Segmented Optical Torus
    const innerTorusGeom = new THREE.TorusGeometry(4.35, 0.04, 16, 120);
    const innerTorusMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    });
    const innerTorus = new THREE.Mesh(innerTorusGeom, innerTorusMat);
    reactorGroup.add(innerTorus);

    // Ring 3: Segmented Compass Quadrant Arcs (4 Sleek Curved Horizons)
    const arcGroup = new THREE.Group();
    reactorGroup.add(arcGroup);

    for (let i = 0; i < 4; i++) {
      const startAngle = (i * Math.PI) / 2 + 0.15;
      const arcLength = Math.PI / 2 - 0.3;
      const arcCurve = new THREE.EllipseCurve(0, 0, 6.2, 6.2, startAngle, startAngle + arcLength, false, 0);
      const points = arcCurve.getPoints(50);
      const arcGeom = new THREE.BufferGeometry().setFromPoints(points);
      const arcMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        linewidth: 1.5,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
      });
      const arcLine = new THREE.Line(arcGeom, arcMat);
      arcGroup.add(arcLine);
    }

    // Ring 4: Luminous Reactive Audio Waveform Ribbon (Dynamic LineLoop)
    const waveSegments = 160;
    const waveGeom = new THREE.BufferGeometry();
    const wavePositions = new Float32Array(waveSegments * 3);
    const baseWaveRadius = 7.3;

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
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const waveRing = new THREE.LineLoop(waveGeom, waveMat);
    reactorGroup.add(waveRing);

    // Ring 5: Outer Celestial Horizon Ring with Micro Index Pips
    const outerHorizonGeom = new THREE.TorusGeometry(8.9, 0.025, 8, 140);
    const outerHorizonMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    const outerHorizon = new THREE.Mesh(outerHorizonGeom, outerHorizonMat);
    reactorGroup.add(outerHorizon);

    // 4 Corner Alignment Triangles orbiting outer perimeter
    const navPointersGroup = new THREE.Group();
    reactorGroup.add(navPointersGroup);

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const triGeom = new THREE.ConeGeometry(0.18, 0.45, 3);
      const triMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
      });
      const tri = new THREE.Mesh(triGeom, triMat);
      tri.position.set(Math.cos(angle) * 8.9, Math.sin(angle) * 8.9, 0);
      tri.rotation.z = angle - Math.PI / 2;
      navPointersGroup.add(tri);
    }

    // ==========================================
    // D. REFINED QUANTUM DUST ACCRETION BELT (SOFT VOLUMETRIC GLOW)
    // ==========================================
    const particleCount = 850;
    const particleGeom = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleData: { r: number; theta: number; speed: number; z: number; zSpeed: number }[] = [];

    for (let i = 0; i < particleCount; i++) {
      // Concentrated into an elegant accretion ring around the reactor
      const r = 3.2 + Math.random() * 6.5;
      const theta = Math.random() * Math.PI * 2;
      const z = (Math.random() - 0.5) * 1.8;

      particlePositions[i * 3] = Math.cos(theta) * r;
      particlePositions[i * 3 + 1] = Math.sin(theta) * r;
      particlePositions[i * 3 + 2] = z;

      particleData.push({
        r,
        theta,
        speed: (0.001 + Math.random() * 0.0025) * (Math.random() > 0.5 ? 1 : -1),
        z,
        zSpeed: 0.4 + Math.random() * 0.8,
      });
    }

    particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      map: particleTex,
      color: 0x00f0ff,
      size: 0.35,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particleCloud = new THREE.Points(particleGeom, particleMat);
    reactorGroup.add(particleCloud);

    // ==========================================
    // E. SUBTLE, CINEMATIC MOUSE PARALLAX (DAMPED & LUXURIOUS)
    // ==========================================
    // User requested: "moves too fast, so it is really distracting and demanding, maybe make it more subtle"
    // We restrict maximum tilt to 0.06 rad (~3.4 deg) with buttery-smooth 0.02 lerp inertia
    let targetTiltX = 0;
    let targetTiltY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      // Subtle, damped angular targets
      targetTiltY = nx * 0.065;
      targetTiltX = -ny * 0.065;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // ==========================================
    // F. MAIN ANIMATION & AUDIO REACTIVITY LOOP
    // ==========================================
    let animFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);

      // Conserve GPU & CPU battery if window is hidden in background
      if (document.hidden) {
        return;
      }

      const time = clock.getElapsedTime();

      // Read real-time Web Audio API telemetry
      const audioTelemetry = audioEngine.getAudioTelemetry();
      const volume = audioTelemetry.volume; // 0.0 to 1.0
      const freqArray = audioTelemetry.frequencyData;
      const timeArray = audioTelemetry.timeDomainData;

      // Color & Intensity morphing based on state
      let pulseMod = 1.0;
      let targetGlowColor = cyanColor;
      let targetCoreColor = brightWhiteCyan;

      if (state === 'listening') {
        pulseMod = 1.0 + volume * 2.2;
        targetGlowColor = brightWhiteCyan;
        targetCoreColor = cyanColor;
      } else if (state === 'speaking') {
        pulseMod = 1.0 + volume * 2.0;
        targetGlowColor = cyanColor;
        targetCoreColor = brightWhiteCyan;
      } else if (state === 'processing') {
        pulseMod = 1.2 + Math.sin(time * 6) * 0.25;
        targetGlowColor = Math.sin(time * 4) > 0 ? amberColor : cyanColor;
        targetCoreColor = amberColor;
      } else {
        // Idle gentle breathing
        pulseMod = 1.0 + Math.sin(time * 1.5) * 0.05;
        targetGlowColor = cyanColor;
        targetCoreColor = deepBlueColor;
      }

      // Buttery, weighted cinematic gimbal parallax (0.02 lerp for weightless luxury feel)
      const breathDriftY = Math.sin(time * 0.35) * 0.012;
      const breathDriftX = Math.cos(time * 0.28) * 0.012;
      reactorGroup.rotation.y += (targetTiltY + breathDriftY - reactorGroup.rotation.y) * 0.02;
      reactorGroup.rotation.x += (targetTiltX + breathDriftX - reactorGroup.rotation.x) * 0.02;

      // Gentle vertical hover
      reactorGroup.position.y = Math.sin(time * 0.7) * 0.15;

      // Smooth concentric ring rotations (calm & cinematic)
      const speedMult = state === 'processing' ? 2.5 : 1.0;
      collimatorGroup.rotation.z += (0.003 * speedMult + volume * 0.015);
      dialTicksGroup.rotation.z -= (0.0018 * speedMult + volume * 0.012);
      arcGroup.rotation.z += (0.0012 * speedMult + volume * 0.008);
      navPointersGroup.rotation.z -= (0.002 * speedMult);

      // Gyroscopic Core gimbal spin (independent 3-axis rotation)
      gyro1.rotation.x += 0.008 * pulseMod;
      gyro1.rotation.y += 0.006 * pulseMod;
      gyro2.rotation.y += 0.007 * pulseMod;
      gyro2.rotation.z += 0.009 * pulseMod;
      gyro3.rotation.x += 0.005 * pulseMod;
      gyro3.rotation.z += 0.006 * pulseMod;
      cageMesh.rotation.y -= 0.005 * pulseMod;

      // Dynamic Core Pulse & Luminous Scale
      const baseScale = 1.0 + Math.sin(time * 2) * 0.03;
      const audioScale = baseScale + volume * 0.65;
      coreContainer.scale.set(audioScale, audioScale, audioScale);

      // Luminous Core Bloom Sprite modulation
      const spriteScale = 7.0 + volume * 4.0 + Math.sin(time * 3) * 0.3;
      coreSprite.scale.set(spriteScale, spriteScale, 1);
      coreSpriteMat.opacity = Math.min(1.0, 0.7 + volume * 0.4);
      coreSpriteMat.color.lerp(targetGlowColor, 0.08);

      // Inner Singularity brightness
      innerPlasmaMat.opacity = 0.8 + volume * 0.25;
      innerPlasmaMat.color.lerp(targetCoreColor, 0.08);

      // Point light intensity
      coreLight.intensity = 3.5 + volume * 7.0;
      pointLight.intensity = 2.5 + volume * 4.5;
      pointLight.color.lerp(targetGlowColor, 0.08);

      // Audio Reactive Waveform Ring (Smooth ribbon deformation)
      const posAttr = waveGeom.attributes.position as THREE.BufferAttribute;
      const posArray = posAttr.array as Float32Array;

      for (let i = 0; i < waveSegments; i++) {
        const theta = (i / waveSegments) * Math.PI * 2;
        let offset = 0;

        if (freqArray && freqArray.length > 0) {
          const freqIndex = Math.floor((i / waveSegments) * (freqArray.length / 3));
          const freqVal = freqArray[freqIndex] || 0;
          offset += (freqVal / 255) * 1.35;
        }

        if (timeArray && timeArray.length > 0) {
          const timeIndex = Math.floor((i / waveSegments) * timeArray.length);
          const timeVal = (timeArray[timeIndex] - 128) / 128;
          offset += timeVal * 0.55;
        }

        const r = baseWaveRadius + offset * (state === 'idle' ? 0.15 : 1.0);
        posArray[i * 3] = Math.cos(theta) * r;
        posArray[i * 3 + 1] = Math.sin(theta) * r;
        posArray[i * 3 + 2] = Math.sin(theta * 3 + time * 2) * (volume * 0.35);
      }
      posAttr.needsUpdate = true;
      waveMat.color.lerp(targetGlowColor, 0.08);
      waveMat.opacity = 0.5 + volume * 0.5;

      // Update Accretion Dust Particles
      const partPosAttr = particleGeom.attributes.position as THREE.BufferAttribute;
      const partPosArray = partPosAttr.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const p = particleData[i];
        p.theta += p.speed * (1.0 + volume * 2.0);
        const currentR = p.r + (volume > 0.05 ? Math.sin(time * 4 + i) * volume * 0.6 : 0);

        partPosArray[i * 3] = Math.cos(p.theta) * currentR;
        partPosArray[i * 3 + 1] = Math.sin(p.theta) * currentR;
        partPosArray[i * 3 + 2] = p.z + Math.sin(time * p.zSpeed + p.theta) * 0.25;
      }
      partPosAttr.needsUpdate = true;
      particleMat.color.lerp(targetGlowColor, 0.08);

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
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
      coreGlowTex.dispose();
      particleTex.dispose();
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
      {/* Sci-Fi Holographic Reticle Overlays */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        {/* Subtle, luxury holographic targeting circles */}
        <div className="w-[430px] h-[430px] rounded-full border border-cyan-400/10 animate-[spin_140s_linear_infinite]" />
        <div className="absolute w-[530px] h-[530px] rounded-full border border-dashed border-cyan-500/10 animate-[spin_180s_linear_infinite_reverse]" />
        <div className="absolute w-[660px] h-[660px] rounded-full border border-cyan-400/5" />

        {/* Hairline Crosshair Radials */}
        <div className="absolute w-[720px] h-[1px] bg-gradient-to-r from-transparent via-cyan-500/15 to-transparent" />
        <div className="absolute h-[720px] w-[1px] bg-gradient-to-b from-transparent via-cyan-500/15 to-transparent" />

        {/* Center Prompt Banner */}
        <div className="absolute bottom-12 flex flex-col items-center opacity-60 group-hover:opacity-100 transition-opacity duration-300">
          <span className="text-[10px] tracking-[0.35em] font-orbitron uppercase text-cyan-300 text-glow-cyan">
            {state === 'listening'
              ? 'ACOUSTIC RECEPTORS ARMED // LISTENING'
              : state === 'speaking'
              ? 'NEURAL VOCALIZER ACTIVE'
              : state === 'processing'
              ? 'QUANTUM MATRIX COMPUTING'
              : 'CLICK OR SAY "HEY JARVIS" TO ENGAGE'}
          </span>
          <span className="text-[9px] font-mono-tech text-cyan-600/70 mt-1 tracking-widest">
            STARK ARC-REACTOR MK-VII // COUPLING: 100%
          </span>
        </div>
      </div>
    </div>
  );
};
