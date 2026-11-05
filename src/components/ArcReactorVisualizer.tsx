import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { audioEngine, JarvisAudioState } from '../services/audioEngine';

interface ArcReactorVisualizerProps {
  state: JarvisAudioState;
  onReactorClick?: () => void;
}

// Procedural ultra-smooth radial energy texture for glow coronas & quantum sparks
function createRadialGlowTexture(
  size = 512,
  inner = 'rgba(255, 255, 255, 1)',
  mid = 'rgba(0, 240, 255, 0.85)',
  rim = 'rgba(0, 110, 255, 0.3)',
  outer = 'rgba(0, 20, 80, 0)'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const center = size / 2;
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.18, mid);
    grad.addColorStop(0.48, rim);
    grad.addColorStop(0.8, 'rgba(0, 40, 140, 0.08)');
    grad.addColorStop(1, outer);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  return texture;
}

// Particle spark texture
function createSparkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const center = 64;
    const grad = ctx.createRadialGradient(center, center, 0, center, center, 56);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.25, 'rgba(0, 240, 255, 0.9)');
    grad.addColorStop(0.65, 'rgba(0, 100, 255, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
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
    renderer.toneMappingExposure = 1.4;
    container.appendChild(renderer.domElement);

    // 2. Cinematic Lighting
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 0.7);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00f0ff, 3.5, 45);
    pointLight.position.set(0, 0, 5);
    scene.add(pointLight);

    const coreLight = new THREE.PointLight(0xffffff, 6, 25);
    coreLight.position.set(0, 0, 1.5);
    scene.add(coreLight);

    // Master Group (Mouse-responsive tilt pivot)
    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    const reactorGroup = new THREE.Group();
    masterGroup.add(reactorGroup);

    // Textures
    const coreCoronaTex = createRadialGlowTexture(512);
    const sparkTex = createSparkTexture();

    // ==========================================
    // A. ULTRA-PREMIUM VOLUMETRIC PLASMA CORE ORB
    // ==========================================
    const coreContainer = new THREE.Group();
    reactorGroup.add(coreContainer);

    // Layer 1: Atmospheric Outer Bloom Sprite (Ethereal Backlight)
    const bloomSpriteMat = new THREE.SpriteMaterial({
      map: coreCoronaTex,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const bloomSprite = new THREE.Sprite(bloomSpriteMat);
    bloomSprite.scale.set(10.5, 10.5, 1);
    coreContainer.add(bloomSprite);

    // Layer 2: Core Volumetric Fresnel Plasma Sphere (Custom Shader)
    const plasmaVertexShader = `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const plasmaFragmentShader = `
      uniform float uTime;
      uniform float uAudioPulse;
      uniform vec3 uColorCore;
      uniform vec3 uColorMid;
      uniform vec3 uColorRim;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        // Angle between surface normal and camera view
        float NdotV = dot(normal, viewDir);
        float radial = clamp(NdotV, 0.0, 1.0);

        // Radiant Fresnel Edge Glow (rim illumination)
        float fresnel = 1.0 - radial;
        float rimGlow = pow(fresnel, 2.2);

        // Blinding white-hot central singularity
        float hotCore = pow(radial, 4.0) * (1.3 + uAudioPulse * 0.9);

        // Smooth radial transition: Core (white-cyan) -> Mid (electric cyan) -> Rim (deep sapphire)
        vec3 color = mix(uColorMid, uColorCore, pow(radial, 1.6));
        color = mix(color, uColorRim, rimGlow * 0.85);
        color += vec3(1.0, 1.0, 1.0) * hotCore * 0.65;

        // Soft holographic alpha transparency
        float alpha = clamp(pow(radial, 1.1) * 0.92 + rimGlow * 0.95, 0.0, 1.0);
        alpha *= (0.85 + uAudioPulse * 0.15);

        gl_FragColor = vec4(color, alpha);
      }
    `;

    const plasmaUniforms = {
      uTime: { value: 0 },
      uAudioPulse: { value: 0 },
      uColorCore: { value: new THREE.Color(0xffffff) },
      uColorMid: { value: new THREE.Color(0x00f0ff) },
      uColorRim: { value: new THREE.Color(0x0055ff) },
    };

    const plasmaMaterial = new THREE.ShaderMaterial({
      vertexShader: plasmaVertexShader,
      fragmentShader: plasmaFragmentShader,
      uniforms: plasmaUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const plasmaSphereGeom = new THREE.SphereGeometry(1.65, 48, 48);
    const plasmaSphere = new THREE.Mesh(plasmaSphereGeom, plasmaMaterial);
    coreContainer.add(plasmaSphere);

    // Layer 3: Nested Ultra-Fine Laser Gyro Rings
    const gyroGroup = new THREE.Group();
    coreContainer.add(gyroGroup);

    const createLaserRing = (radius: number, color: number) => {
      const geom = new THREE.TorusGeometry(radius, 0.018, 16, 100);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
      });
      return new THREE.Mesh(geom, mat);
    };

    const gyro1 = createLaserRing(2.15, 0x00f0ff);
    const gyro2 = createLaserRing(2.55, 0x38bdf8);
    const gyro3 = createLaserRing(2.95, 0x0284c7);
    gyroGroup.add(gyro1);
    gyroGroup.add(gyro2);
    gyroGroup.add(gyro3);

    // Layer 4: Delicate Geodesic Energy Lattice Shell (Fine Wireframe with Soft Additive Glow)
    const geodesicGeom = new THREE.IcosahedronGeometry(2.4, 2);
    const geodesicMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
    });
    const geodesicMesh = new THREE.Mesh(geodesicGeom, geodesicMat);
    coreContainer.add(geodesicMesh);

    // Layer 5: Internal Swirling Quantum Core Sparks (35 tiny luminous sparks)
    const coreSparkCount = 35;
    const coreSparkGeom = new THREE.BufferGeometry();
    const coreSparkPositions = new Float32Array(coreSparkCount * 3);
    const coreSparkData: { r: number; theta: number; phi: number; speed: number }[] = [];

    for (let i = 0; i < coreSparkCount; i++) {
      const r = 0.4 + Math.random() * 1.1;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;

      coreSparkPositions[i * 3] = r * Math.cos(theta) * Math.cos(phi);
      coreSparkPositions[i * 3 + 1] = r * Math.sin(theta) * Math.cos(phi);
      coreSparkPositions[i * 3 + 2] = r * Math.sin(phi);

      coreSparkData.push({
        r,
        theta,
        phi,
        speed: (0.008 + Math.random() * 0.015) * (Math.random() > 0.5 ? 1 : -1),
      });
    }

    coreSparkGeom.setAttribute('position', new THREE.BufferAttribute(coreSparkPositions, 3));
    const coreSparkMat = new THREE.PointsMaterial({
      map: sparkTex,
      color: 0xffffff,
      size: 0.4,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreSparkPoints = new THREE.Points(coreSparkGeom, coreSparkMat);
    coreContainer.add(coreSparkPoints);

    // ==========================================
    // B. REPLACED "SLICERS" WITH LUXURY AEROSPACE HUD TELEMETRY RETICLES
    // (No more chunky rectangular blocks!)
    // ==========================================
    const telemetryGroup = new THREE.Group();
    reactorGroup.add(telemetryGroup);

    // 1. Dual Concentric Hairline Laser Circles
    const trackRing1 = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(0, 0, 3.8, 3.8, 0, Math.PI * 2, false, 0).getPoints(120)
      ),
      new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
      })
    );
    const trackRing2 = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(0, 0, 4.4, 4.4, 0, Math.PI * 2, false, 0).getPoints(120)
      ),
      new THREE.LineBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
      })
    );
    telemetryGroup.add(trackRing1);
    telemetryGroup.add(trackRing2);

    // 2. High-Precision 120-Division Radial Chronograph Dial (Hairline ticks)
    const dialLinesGroup = new THREE.Group();
    telemetryGroup.add(dialLinesGroup);

    const dialTicks = 120;
    const tickPositions: number[] = [];
    for (let i = 0; i < dialTicks; i++) {
      const angle = (i / dialTicks) * Math.PI * 2;
      const isMajor = i % 10 === 0;
      const isMid = i % 5 === 0;
      const rInner = 4.8;
      const rOuter = rInner + (isMajor ? 0.35 : isMid ? 0.2 : 0.1);

      tickPositions.push(
        Math.cos(angle) * rInner, Math.sin(angle) * rInner, 0,
        Math.cos(angle) * rOuter, Math.sin(angle) * rOuter, 0
      );
    }
    const dialLineGeom = new THREE.BufferGeometry();
    dialLineGeom.setAttribute('position', new THREE.Float32BufferAttribute(tickPositions, 3));
    const dialLineMat = new THREE.LineSegments(
      dialLineGeom,
      new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
      })
    );
    dialLinesGroup.add(dialLineMat);

    // 3. Four Sleek Segmented Quadrant Arcs (HUD Brackets with Precision Dots)
    const quadrantGroup = new THREE.Group();
    telemetryGroup.add(quadrantGroup);

    for (let i = 0; i < 4; i++) {
      const startAngle = (i * Math.PI) / 2 + 0.12;
      const arcLength = Math.PI / 2 - 0.24;
      const arcCurve = new THREE.EllipseCurve(0, 0, 6.1, 6.1, startAngle, startAngle + arcLength, false, 0);
      const points = arcCurve.getPoints(40);
      const arcGeom = new THREE.BufferGeometry().setFromPoints(points);
      const arcMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
      });
      const arcLine = new THREE.Line(arcGeom, arcMat);
      quadrantGroup.add(arcLine);

      // Micro LED index bead on each arc center
      const midAngle = startAngle + arcLength / 2;
      const beadGeom = new THREE.CircleGeometry(0.045, 12);
      const beadMat = new THREE.MeshBasicMaterial({
        color: 0xe0ffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      const bead = new THREE.Mesh(beadGeom, beadMat);
      bead.position.set(Math.cos(midAngle) * 6.1, Math.sin(midAngle) * 6.1, 0.01);
      quadrantGroup.add(bead);
    }

    // 4. Smooth Reactive Audio Waveform Ribbon (Dynamic LineLoop)
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
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    const waveRing = new THREE.LineLoop(waveGeom, waveMat);
    telemetryGroup.add(waveRing);

    // 5. Outer Celestial Boundary with 4 Precision Vernier Notches
    const outerHorizonGeom = new THREE.TorusGeometry(8.9, 0.02, 8, 140);
    const outerHorizonMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });
    const outerHorizon = new THREE.Mesh(outerHorizonGeom, outerHorizonMat);
    telemetryGroup.add(outerHorizon);

    // 4 Cardinal Arrow Notches
    const cardinalGroup = new THREE.Group();
    telemetryGroup.add(cardinalGroup);

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const notchGeom = new THREE.BufferGeometry();
      const r = 8.9;
      const w = 0.15;
      const h = 0.3;
      // Precision chevron
      const p1 = new THREE.Vector3(Math.cos(angle) * (r - h), Math.sin(angle) * (r - h), 0);
      const p2 = new THREE.Vector3(Math.cos(angle) * r - Math.sin(angle) * w, Math.sin(angle) * r + Math.cos(angle) * w, 0);
      const p3 = new THREE.Vector3(Math.cos(angle) * r + Math.sin(angle) * w, Math.sin(angle) * r - Math.cos(angle) * w, 0);
      notchGeom.setFromPoints([p2, p1, p3]);
      const notchLine = new THREE.Line(
        notchGeom,
        new THREE.LineBasicMaterial({
          color: 0x00f0ff,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
        })
      );
      cardinalGroup.add(notchLine);
    }

    // ==========================================
    // C. AMBIENT CELESTIAL QUANTUM PARTICLES
    // ==========================================
    const particleCount = 700;
    const particleGeom = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleData: { r: number; theta: number; speed: number; z: number }[] = [];

    for (let i = 0; i < particleCount; i++) {
      const r = 3.4 + Math.random() * 6.2;
      const theta = Math.random() * Math.PI * 2;
      const z = (Math.random() - 0.5) * 1.5;

      particlePositions[i * 3] = Math.cos(theta) * r;
      particlePositions[i * 3 + 1] = Math.sin(theta) * r;
      particlePositions[i * 3 + 2] = z;

      particleData.push({
        r,
        theta,
        speed: (0.0006 + Math.random() * 0.0015) * (Math.random() > 0.5 ? 1 : -1),
        z,
      });
    }

    particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      map: sparkTex,
      color: 0x00f0ff,
      size: 0.3,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particleCloud = new THREE.Points(particleGeom, particleMat);
    reactorGroup.add(particleCloud);

    // ==========================================
    // D. HIGH-RESPONSIVENESS MOUSE PARALLAX & CALM IDLE
    // User requested: "make it more reactive to my mouse, just have it move less/slower while idle"
    // ==========================================
    let targetTiltX = 0;
    let targetTiltY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      // More reactive angular range (0.16 rad ~ 9.2 deg)
      targetTiltY = nx * 0.16;
      targetTiltX = -ny * 0.16;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // ==========================================
    // E. MAIN ANIMATION & AUDIO REACTIVITY LOOP
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

      // Color themes based on state
      let pulseMod = 1.0;
      let targetCore = new THREE.Color(0xffffff);
      let targetMid = new THREE.Color(0x00f0ff);
      let targetRim = new THREE.Color(0x0055ff);

      if (state === 'listening') {
        // High reactivity to live user microphone volume & frequency
        pulseMod = 1.0 + volume * 3.8;
        targetCore = new THREE.Color(0xffffff);
        targetMid = new THREE.Color(0xdcfce7); // vibrant radiant cyan-lime touch for acoustic ingest
        targetRim = new THREE.Color(0x00f0ff);
      } else if (state === 'speaking') {
        pulseMod = 1.0 + volume * 2.8;
        targetCore = new THREE.Color(0xffffff);
        targetMid = new THREE.Color(0x38bdf8);
        targetRim = new THREE.Color(0x0284c7);
      } else if (state === 'processing') {
        pulseMod = 1.2 + Math.sin(time * 6) * 0.25;
        targetCore = new THREE.Color(0xfef08a);
        targetMid = new THREE.Color(0xf59e0b);
        targetRim = new THREE.Color(0xd97706);
      } else {
        // Idle calm
        pulseMod = 1.0 + Math.sin(time * 1.2) * 0.04;
        targetCore = new THREE.Color(0xffffff);
        targetMid = new THREE.Color(0x00f0ff);
        targetRim = new THREE.Color(0x0044cc);
      }

      // 1. Reactive & Fluid Mouse Parallax:
      // Uses 0.08 lerp for direct, snappy tracking of mouse cursor,
      // with tiny, imperceptible idle breathing so it doesn't distract.
      const subtleBreathY = Math.sin(time * 0.2) * 0.003;
      const subtleBreathX = Math.cos(time * 0.16) * 0.003;
      masterGroup.rotation.y += (targetTiltY + subtleBreathY - masterGroup.rotation.y) * 0.08;
      masterGroup.rotation.x += (targetTiltX + subtleBreathX - masterGroup.rotation.x) * 0.08;

      // Very subtle, gentle vertical floating (reduced amplitude)
      masterGroup.position.y = Math.sin(time * 0.4) * 0.035;

      // 2. Slow, Majestic Idle Rotations (moves less / slower while idle):
      const speedMult = state === 'processing' ? 2.5 : 1.0;
      dialLinesGroup.rotation.z -= (0.0006 * speedMult + volume * 0.01);
      quadrantGroup.rotation.z += (0.0004 * speedMult + volume * 0.008);
      trackRing1.rotation.z += (0.0008 * speedMult);
      cardinalGroup.rotation.z -= (0.0005 * speedMult);

      // Gyroscopic Laser Rings (calm celestial orbital rates)
      gyro1.rotation.x += 0.004 * pulseMod;
      gyro1.rotation.y += 0.003 * pulseMod;
      gyro2.rotation.y += 0.0035 * pulseMod;
      gyro2.rotation.z += 0.0045 * pulseMod;
      gyro3.rotation.x += 0.0025 * pulseMod;
      gyro3.rotation.z += 0.003 * pulseMod;
      geodesicMesh.rotation.y -= 0.002 * pulseMod;

      // 3. Update Plasma Core Shader Uniforms
      plasmaUniforms.uTime.value = time;
      plasmaUniforms.uAudioPulse.value = volume;
      plasmaUniforms.uColorCore.value.lerp(targetCore, 0.08);
      plasmaUniforms.uColorMid.value.lerp(targetMid, 0.08);
      plasmaUniforms.uColorRim.value.lerp(targetRim, 0.08);

      // Core Breathing & Dynamic Scale (strongly reacts to speech volume)
      const baseScale = 1.0 + Math.sin(time * 1.5) * 0.02;
      const audioScale = baseScale + volume * (state === 'listening' ? 0.95 : 0.65);
      coreContainer.scale.set(audioScale, audioScale, audioScale);

      // Outer Corona Bloom Sprite
      const spriteScale = 9.5 + volume * (state === 'listening' ? 6.5 : 4.0) + Math.sin(time * 2) * 0.2;
      bloomSprite.scale.set(spriteScale, spriteScale, 1);
      bloomSpriteMat.opacity = Math.min(0.95, 0.55 + volume * 0.45);
      bloomSpriteMat.color.lerp(targetMid, 0.08);

      // Lights (brightens dynamically with vocal tone)
      coreLight.intensity = 4.0 + volume * (state === 'listening' ? 12.0 : 7.0);
      pointLight.intensity = 2.5 + volume * (state === 'listening' ? 8.0 : 4.5);
      pointLight.color.lerp(targetMid, 0.08);

      // 4. Update Internal Core Sparks
      const sparkPosAttr = coreSparkGeom.attributes.position as THREE.BufferAttribute;
      const sparkPosArray = sparkPosAttr.array as Float32Array;

      for (let i = 0; i < coreSparkCount; i++) {
        const d = coreSparkData[i];
        d.theta += d.speed * (1.0 + volume * 3.5);
        d.phi += d.speed * 0.8;
        sparkPosArray[i * 3] = d.r * Math.cos(d.theta) * Math.cos(d.phi);
        sparkPosArray[i * 3 + 1] = d.r * Math.sin(d.theta) * Math.cos(d.phi);
        sparkPosArray[i * 3 + 2] = d.r * Math.sin(d.phi);
      }
      sparkPosAttr.needsUpdate = true;

      // 5. Audio Reactive Waveform Ribbon (Living Oscilloscope)
      const wavePosAttr = waveGeom.attributes.position as THREE.BufferAttribute;
      const wavePosArray = wavePosAttr.array as Float32Array;

      for (let i = 0; i < waveSegments; i++) {
        const theta = (i / waveSegments) * Math.PI * 2;
        let offset = 0;

        if (freqArray && freqArray.length > 0) {
          const freqIndex = Math.floor((i / waveSegments) * (freqArray.length / 2));
          const freqVal = freqArray[freqIndex] || 0;
          offset += (freqVal / 255) * (state === 'listening' ? 2.4 : 1.5);
        }

        if (timeArray && timeArray.length > 0) {
          const timeIndex = Math.floor((i / waveSegments) * timeArray.length);
          const timeVal = (timeArray[timeIndex] - 128) / 128;
          offset += timeVal * (state === 'listening' ? 1.1 : 0.6);
        }

        const r = baseWaveRadius + offset * (state === 'idle' ? 0.08 : 1.0);
        wavePosArray[i * 3] = Math.cos(theta) * r;
        wavePosArray[i * 3 + 1] = Math.sin(theta) * r;
        wavePosArray[i * 3 + 2] = Math.sin(theta * 3 + time * 2) * (volume * 0.45);
      }
      wavePosAttr.needsUpdate = true;
      waveMat.color.lerp(targetMid, 0.08);

      // 6. Update Ambient Accretion Dust Particles (slow, hypnotic)
      const partPosAttr = particleGeom.attributes.position as THREE.BufferAttribute;
      const partPosArray = partPosAttr.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const p = particleData[i];
        p.theta += p.speed * (1.0 + volume * 1.8);
        const currentR = p.r + (volume > 0.05 ? Math.sin(time * 3 + i) * volume * 0.4 : 0);

        partPosArray[i * 3] = Math.cos(p.theta) * currentR;
        partPosArray[i * 3 + 1] = Math.sin(p.theta) * currentR;
        partPosArray[i * 3 + 2] = p.z + Math.sin(time * 0.6 + p.theta) * 0.15;
      }
      partPosAttr.needsUpdate = true;
      particleMat.color.lerp(targetMid, 0.08);

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
      coreCoronaTex.dispose();
      sparkTex.dispose();
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
        <div className="w-[430px] h-[430px] rounded-full border border-cyan-400/10 animate-[spin_240s_linear_infinite]" />
        <div className="absolute w-[540px] h-[540px] rounded-full border border-dashed border-cyan-500/10 animate-[spin_320s_linear_infinite_reverse]" />
        <div className="absolute w-[680px] h-[680px] rounded-full border border-cyan-400/5" />

        {/* Hairline Crosshair Radials */}
        <div className="absolute w-[740px] h-[1px] bg-gradient-to-r from-transparent via-cyan-500/15 to-transparent" />
        <div className="absolute h-[740px] w-[1px] bg-gradient-to-b from-transparent via-cyan-500/15 to-transparent" />

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
