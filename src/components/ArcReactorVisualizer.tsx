import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { audioEngine, JarvisAudioState } from '../services/audioEngine';

interface ArcReactorVisualizerProps {
  state: JarvisAudioState;
  onReactorClick?: () => void;
}

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
  const stateRef = useRef<JarvisAudioState>(state);

  // Keep stateRef synced without tearing down the Three.js WebGL context
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

    const updateCamera = (w: number, h: number) => {
      const aspect = w / h;
      camera.aspect = aspect;
      if (aspect < 1) {
        // Portrait mobile screen: scale distance so 3D reactor (radius ~9.5) fits horizontally without clipping
        // FOV is 45 deg, tan(22.5 deg) = 0.4142. Visible half-width at distance d is d * 0.4142 * aspect.
        const targetZ = Math.min(54, Math.max(25, 12 / (0.4142 * aspect)));
        camera.position.z = targetZ;
        // On mobile, subtitles HUD sits in the bottom ~160px; elevate camera slightly so reactor is centered in available view
        camera.position.y = 1.1;
      } else {
        camera.position.z = 25;
        camera.position.y = 0;
      }
      camera.updateProjectionMatrix();
    };

    updateCamera(container.clientWidth, container.clientHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
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

    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    const reactorGroup = new THREE.Group();
    masterGroup.add(reactorGroup);

    const coreCoronaTex = createRadialGlowTexture(512);
    const sparkTex = createSparkTexture();

    // ==========================================
    // A. ACOUSTIC-MORPHING VOLUMETRIC PLASMA CORE ORB
    // ==========================================
    const coreContainer = new THREE.Group();
    reactorGroup.add(coreContainer);

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

    // Custom 3D Harmonic Acoustic Vertex + Fragment Shader
    const plasmaVertexShader = `
      uniform float uTime;
      uniform float uBass;
      uniform float uMid;
      uniform float uTreble;
      uniform float uPitch;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying float vDisplacement;

      void main() {
        // Multi-band spherical harmonic surface displacement driven by real voice formants
        float freq1 = 3.0 + floor(uPitch * 4.0);
        float freq2 = 6.0 + floor(uPitch * 6.0);
        float waveBass = sin(position.x * freq1 + uTime * 3.2) * cos(position.y * freq1 - uTime * 2.6) * uBass * 0.24;
        float waveMid = sin(position.y * freq2 - uTime * 5.0) * sin(position.z * freq2 + uTime * 4.2) * uMid * 0.19;
        float waveTreble = cos(position.x * 14.0 + position.z * 14.0 + uTime * 9.0) * uTreble * 0.09;

        float displacement = waveBass + waveMid + waveTreble;
        vDisplacement = displacement;

        vec3 displacedPos = position + normal * displacement;
        vNormal = normalize(normalMatrix * normalize(normal + normal * displacement * 1.8));
        vec4 mvPosition = modelViewMatrix * vec4(displacedPos, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const plasmaFragmentShader = `
      uniform float uTime;
      uniform float uAudioPulse;
      uniform float uBass;
      uniform float uMid;
      uniform float uTreble;
      uniform float uPitch;
      uniform vec3 uColorCore;
      uniform vec3 uColorMid;
      uniform vec3 uColorRim;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying float vDisplacement;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        float NdotV = dot(normal, viewDir);
        float radial = clamp(NdotV, 0.0, 1.0);

        float fresnel = 1.0 - radial;
        float rimGlow = pow(fresnel, 2.0 - uMid * 0.5);

        // Dynamic plasma filament interference driven by vocal formants & pitch
        float plasmaWave = sin(normal.x * (6.0 + uPitch * 8.0) + uTime * 3.5)
                         * cos(normal.y * (6.0 + uMid * 8.0) - uTime * 2.8);
        float filament = smoothstep(-0.2, 0.8, plasmaWave) * (0.25 + uMid * 0.75 + uTreble * 0.5);

        float hotCore = pow(radial, 3.6 - uBass * 1.4) * (1.25 + uAudioPulse * 1.15);

        vec3 color = mix(uColorMid, uColorCore, pow(radial, 1.5));
        color = mix(color, uColorRim, rimGlow * 0.85);
        color += uColorCore * filament * 0.45;
        color += vec3(1.0, 1.0, 1.0) * (hotCore * 0.65 + clamp(vDisplacement * 2.5, 0.0, 0.6));

        float alpha = clamp(pow(radial, 1.05) * 0.92 + rimGlow * 0.96, 0.0, 1.0);
        alpha *= (0.85 + uAudioPulse * 0.15);

        gl_FragColor = vec4(color, alpha);
      }
    `;

    const plasmaUniforms = {
      uTime: { value: 0 },
      uAudioPulse: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uPitch: { value: 0.25 },
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

    const plasmaSphereGeom = new THREE.SphereGeometry(1.65, 64, 64);
    const plasmaSphere = new THREE.Mesh(plasmaSphereGeom, plasmaMaterial);
    coreContainer.add(plasmaSphere);

    // Layer 3: Nested Laser Gyro Rings
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
      return { mesh: new THREE.Mesh(geom, mat), mat };
    };

    const gyro1 = createLaserRing(2.15, 0x00f0ff);
    const gyro2 = createLaserRing(2.55, 0x38bdf8);
    const gyro3 = createLaserRing(2.95, 0x0284c7);
    gyroGroup.add(gyro1.mesh);
    gyroGroup.add(gyro2.mesh);
    gyroGroup.add(gyro3.mesh);

    // Layer 4: 3D Acoustic-Morphing Geodesic Energy Lattice Shell
    const geodesicGeom = new THREE.IcosahedronGeometry(2.42, 3);
    const baseGeodesicPos = new Float32Array(
      (geodesicGeom.attributes.position as THREE.BufferAttribute).array
    );
    const geodesicMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });
    const geodesicMesh = new THREE.Mesh(geodesicGeom, geodesicMat);
    coreContainer.add(geodesicMesh);

    // Layer 5: Internal Swirling Quantum Core Sparks
    const coreSparkCount = 45;
    const coreSparkGeom = new THREE.BufferGeometry();
    const coreSparkPositions = new Float32Array(coreSparkCount * 3);
    const coreSparkData: { r: number; theta: number; phi: number; speed: number }[] = [];

    for (let i = 0; i < coreSparkCount; i++) {
      const r = 0.45 + Math.random() * 1.15;
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
      size: 0.42,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreSparkPoints = new THREE.Points(coreSparkGeom, coreSparkMat);
    coreContainer.add(coreSparkPoints);

    // ==========================================
    // B. LIVE RADIAL SPECTRUM & DUAL WAVEFORM TELEMETRY RINGS
    // ==========================================
    const telemetryGroup = new THREE.Group();
    reactorGroup.add(telemetryGroup);

    // 1. Inner Formant Harmonic Ribbon (r = 3.85)
    const innerWaveSegments = 128;
    const innerWaveGeom = new THREE.BufferGeometry();
    const innerWavePositions = new Float32Array(innerWaveSegments * 3);
    const baseInnerRadius = 3.85;
    for (let i = 0; i < innerWaveSegments; i++) {
      const theta = (i / innerWaveSegments) * Math.PI * 2;
      innerWavePositions[i * 3] = Math.cos(theta) * baseInnerRadius;
      innerWavePositions[i * 3 + 1] = Math.sin(theta) * baseInnerRadius;
      innerWavePositions[i * 3 + 2] = 0;
    }
    innerWaveGeom.setAttribute('position', new THREE.BufferAttribute(innerWavePositions, 3));
    const innerWaveMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const innerWaveRing = new THREE.LineLoop(innerWaveGeom, innerWaveMat);
    telemetryGroup.add(innerWaveRing);

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
    telemetryGroup.add(trackRing2);

    // 2. Live 120-Bar Radial Frequency Spectrum Chronograph Dial
    const dialLinesGroup = new THREE.Group();
    telemetryGroup.add(dialLinesGroup);

    const dialTicks = 120;
    const tickPositions = new Float32Array(dialTicks * 2 * 3);
    const smoothedTickBins = new Float32Array(dialTicks);

    for (let i = 0; i < dialTicks; i++) {
      const angle = (i / dialTicks) * Math.PI * 2;
      const isMajor = i % 10 === 0;
      const isMid = i % 5 === 0;
      const rInner = 4.8;
      const rOuter = rInner + (isMajor ? 0.35 : isMid ? 0.2 : 0.1);

      tickPositions[i * 6] = Math.cos(angle) * rInner;
      tickPositions[i * 6 + 1] = Math.sin(angle) * rInner;
      tickPositions[i * 6 + 2] = 0;
      tickPositions[i * 6 + 3] = Math.cos(angle) * rOuter;
      tickPositions[i * 6 + 4] = Math.sin(angle) * rOuter;
      tickPositions[i * 6 + 5] = 0;
    }
    const dialLineGeom = new THREE.BufferGeometry();
    dialLineGeom.setAttribute('position', new THREE.BufferAttribute(tickPositions, 3));
    const dialLineMaterial = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const dialLineSegments = new THREE.LineSegments(dialLineGeom, dialLineMaterial);
    dialLinesGroup.add(dialLineSegments);

    // 3. Four Sleek Segmented Quadrant Arcs
    const quadrantGroup = new THREE.Group();
    telemetryGroup.add(quadrantGroup);

    for (let i = 0; i < 4; i++) {
      const startAngle = (i * Math.PI) / 2 + 0.12;
      const arcLength = Math.PI / 2 - 0.24;
      const arcCurve = new THREE.EllipseCurve(
        0,
        0,
        6.1,
        6.1,
        startAngle,
        startAngle + arcLength,
        false,
        0
      );
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

    // 4. Outer Time-Domain Oscilloscope Waveform Ribbon (r = 7.3)
    const waveSegments = 180;
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
      opacity: 0.85,
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

    const cardinalGroup = new THREE.Group();
    telemetryGroup.add(cardinalGroup);

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const notchGeom = new THREE.BufferGeometry();
      const r = 8.9;
      const w = 0.15;
      const h = 0.3;
      const p1 = new THREE.Vector3(Math.cos(angle) * (r - h), Math.sin(angle) * (r - h), 0);
      const p2 = new THREE.Vector3(
        Math.cos(angle) * r - Math.sin(angle) * w,
        Math.sin(angle) * r + Math.cos(angle) * w,
        0
      );
      const p3 = new THREE.Vector3(
        Math.cos(angle) * r + Math.sin(angle) * w,
        Math.sin(angle) * r - Math.cos(angle) * w,
        0
      );
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
    // D. MOUSE PARALLAX
    // ==========================================
    let targetTiltX = 0;
    let targetTiltY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetTiltY = nx * 0.16;
      targetTiltX = -ny * 0.16;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const rect = container.getBoundingClientRect();
        const nx = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((touch.clientY - rect.top) / rect.height) * 2 - 1);
        targetTiltY = nx * 0.22;
        targetTiltX = -ny * 0.22;
      }
    };
    window.addEventListener('touchmove', handleTouchMove, { passive: true });

    // ==========================================
    // E. MAIN ANIMATION & MULTI-BAND AUDIO REACTIVITY LOOP
    // ==========================================
    let animFrameId: number;
    const clock = new THREE.Clock();

    // Smoothed acoustic state variables for organic fluid dynamics
    let smoothVol = 0;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothTreble = 0;
    let smoothPitch = 0.25;

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);

      if (document.hidden) {
        return;
      }

      const time = clock.getElapsedTime();
      const currentState = stateRef.current;

      // Read live multi-band Web Audio API telemetry
      const telemetry = audioEngine.getAudioTelemetry();
      const isActiveAudio = currentState === 'listening' || currentState === 'speaking';

      const rawVol = isActiveAudio ? telemetry.volume : 0;
      const rawBass = isActiveAudio ? telemetry.bass : 0;
      const rawMid = isActiveAudio ? telemetry.mid : 0;
      const rawTreble = isActiveAudio ? telemetry.treble : 0;
      const rawPitch = isActiveAudio ? telemetry.spectralCentroid : 0.25;

      // Fast attack, smooth organic decay
      smoothVol += (rawVol - smoothVol) * (rawVol > smoothVol ? 0.35 : 0.14);
      smoothBass += (rawBass - smoothBass) * (rawBass > smoothBass ? 0.35 : 0.14);
      smoothMid += (rawMid - smoothMid) * (rawMid > smoothMid ? 0.32 : 0.15);
      smoothTreble += (rawTreble - smoothTreble) * (rawTreble > smoothTreble ? 0.4 : 0.18);
      smoothPitch += (rawPitch - smoothPitch) * 0.12;

      const freqArray = telemetry.frequencyData;
      const timeArray = telemetry.timeDomainData;

      // Dynamic Timbre & State Color Palettes
      let pulseMod = 1.0;
      const targetCore = new THREE.Color(0xffffff);
      const targetMid = new THREE.Color(0x00f0ff);
      const targetRim = new THREE.Color(0x0055ff);

      if (currentState === 'listening') {
        // Acoustic Receptor Mode: shifts from bioluminescent emerald-aqua to electric cyan-white with vocal pitch
        pulseMod = 1.15 + smoothVol * 4.2 + smoothBass * 2.0;
        const lowPitchListen = new THREE.Color(0x10b981); // vibrant emerald
        const highPitchListen = new THREE.Color(0x00f0ff); // electric cyan
        targetMid.copy(lowPitchListen).lerp(highPitchListen, smoothPitch);
        targetRim.setHex(0x00ffa3).lerp(new THREE.Color(0x0284c7), smoothPitch);
        targetCore.setHex(0xffffff);
      } else if (currentState === 'speaking') {
        // Movie J.A.R.V.I.S. Vocal Projection Mode: shifts between Stark Holographic Cyan and Warm Gold Core with baritone/formants
        pulseMod = 1.2 + smoothVol * 3.8 + smoothMid * 2.2;
        const baritoneCyan = new THREE.Color(0x38bdf8);
        const formantGold = new THREE.Color(0xfbbf24); // Movie Jarvis holographic gold inflection
        targetMid.copy(baritoneCyan).lerp(formantGold, Math.min(1, smoothMid * 0.65 + smoothPitch * 0.35));
        targetRim.setHex(0x0284c7).lerp(new THREE.Color(0xf59e0b), smoothBass * 0.6);
        targetCore.setHex(0xffffff).lerp(new THREE.Color(0xfef08a), smoothMid * 0.5);
      } else if (currentState === 'processing') {
        pulseMod = 1.5 + Math.sin(time * 7) * 0.35;
        targetCore.setHex(0xfef08a);
        targetMid.setHex(0xf59e0b);
        targetRim.setHex(0xd97706);
      } else {
        pulseMod = 1.0 + Math.sin(time * 1.2) * 0.04;
        targetCore.setHex(0xffffff);
        targetMid.setHex(0x00f0ff);
        targetRim.setHex(0x0044cc);
      }

      // 1. Mouse Parallax
      const subtleBreathY = Math.sin(time * 0.2) * 0.003;
      const subtleBreathX = Math.cos(time * 0.16) * 0.003;
      masterGroup.rotation.y += (targetTiltY + subtleBreathY - masterGroup.rotation.y) * 0.08;
      masterGroup.rotation.x += (targetTiltX + subtleBreathX - masterGroup.rotation.x) * 0.08;
      masterGroup.position.y = Math.sin(time * 0.4) * 0.035;

      // 2. Ring & Dial Rotations driven by Bass vs Treble
      const speedMult = currentState === 'processing' ? 2.8 : 1.0;
      dialLinesGroup.rotation.z -= 0.0005 * speedMult + smoothBass * 0.014;
      quadrantGroup.rotation.z += 0.0004 * speedMult + smoothMid * 0.012;
      innerWaveRing.rotation.z += 0.0008 * speedMult + smoothTreble * 0.018;
      cardinalGroup.rotation.z -= 0.0005 * speedMult;

      // Gyroscopic Rings react independently to Bass, Mid, and Treble bands
      gyro1.mesh.rotation.x += 0.0035 * (1 + smoothBass * 4.5);
      gyro1.mesh.rotation.y += 0.0025 * (1 + smoothBass * 3.5);
      gyro2.mesh.rotation.y += 0.003 * (1 + smoothMid * 4.5);
      gyro2.mesh.rotation.z += 0.004 * (1 + smoothMid * 3.5);
      gyro3.mesh.rotation.x += 0.0025 * (1 + smoothTreble * 5.0);
      gyro3.mesh.rotation.z += 0.003 * (1 + smoothTreble * 4.0);

      gyro1.mat.color.lerp(targetMid, 0.12);
      gyro2.mat.color.lerp(targetCore, 0.12);
      gyro3.mat.color.lerp(targetRim, 0.12);

      geodesicMesh.rotation.y -= 0.0018 * pulseMod;
      geodesicMesh.rotation.x += 0.001 * smoothMid;
      geodesicMat.color.lerp(targetMid, 0.12);
      geodesicMat.opacity = 0.24 + smoothVol * 0.45;

      // 3. 3D Acoustic Vertex Morphing on the Geodesic Energy Lattice
      const geoPosAttr = geodesicGeom.attributes.position as THREE.BufferAttribute;
      const geoPosArr = geoPosAttr.array as Float32Array;
      const vertexCount = geoPosAttr.count;

      for (let i = 0; i < vertexCount; i++) {
        const bx = baseGeodesicPos[i * 3];
        const by = baseGeodesicPos[i * 3 + 1];
        const bz = baseGeodesicPos[i * 3 + 2];

        let deform = 1.0;
        if (isActiveAudio && freqArray.length > 0) {
          // Map vertex angle/index to vocal FFT bins (1..48)
          const binIdx = 1 + ((i * 7) % 44);
          const binVal = (freqArray[binIdx] || 0) / 255;
          const waveSample = timeArray.length > 0 ? (timeArray[i % timeArray.length] - 128) / 128 : 0;
          deform =
            1.0 +
            binVal * (currentState === 'listening' ? 0.34 : 0.28) +
            waveSample * 0.12 * smoothVol;
        } else if (currentState === 'processing') {
          deform = 1.0 + Math.sin(time * 8 + bx * 2 + by * 2) * 0.08;
        }

        geoPosArr[i * 3] = bx * deform;
        geoPosArr[i * 3 + 1] = by * deform;
        geoPosArr[i * 3 + 2] = bz * deform;
      }
      geoPosAttr.needsUpdate = true;

      // 4. Update Volumetric Plasma Shader Uniforms
      plasmaUniforms.uTime.value = time;
      plasmaUniforms.uAudioPulse.value = smoothVol;
      plasmaUniforms.uBass.value = smoothBass;
      plasmaUniforms.uMid.value = smoothMid;
      plasmaUniforms.uTreble.value = smoothTreble;
      plasmaUniforms.uPitch.value = smoothPitch;
      plasmaUniforms.uColorCore.value.lerp(targetCore, 0.12);
      plasmaUniforms.uColorMid.value.lerp(targetMid, 0.12);
      plasmaUniforms.uColorRim.value.lerp(targetRim, 0.12);

      // Core Scale reacts dynamically to fundamental vocal chest bass + RMS punch
      const baseScale = 1.0 + Math.sin(time * 1.5) * 0.018;
      const audioScale = baseScale + smoothBass * 0.55 + smoothVol * 0.45;
      coreContainer.scale.set(audioScale, audioScale, audioScale);

      const spriteScale = 9.5 + smoothVol * 6.0 + smoothBass * 3.0 + Math.sin(time * 2) * 0.15;
      bloomSprite.scale.set(spriteScale, spriteScale, 1);
      bloomSpriteMat.opacity = Math.min(0.95, 0.5 + smoothVol * 0.48);
      bloomSpriteMat.color.lerp(targetMid, 0.12);

      coreLight.intensity = 4.0 + smoothVol * 12.0;
      pointLight.intensity = 2.5 + smoothVol * 8.0;
      pointLight.color.lerp(targetMid, 0.12);

      // 5. Internal Core Sparks react to Treble & Volume
      const sparkPosAttr = coreSparkGeom.attributes.position as THREE.BufferAttribute;
      const sparkPosArray = sparkPosAttr.array as Float32Array;

      for (let i = 0; i < coreSparkCount; i++) {
        const d = coreSparkData[i];
        d.theta += d.speed * (1.0 + smoothVol * 3.5 + smoothTreble * 4.0);
        d.phi += d.speed * (0.8 + smoothMid * 2.5);
        const dynamicR = d.r * (1.0 + smoothBass * 0.35);
        sparkPosArray[i * 3] = dynamicR * Math.cos(d.theta) * Math.cos(d.phi);
        sparkPosArray[i * 3 + 1] = dynamicR * Math.sin(d.theta) * Math.cos(d.phi);
        sparkPosArray[i * 3 + 2] = dynamicR * Math.sin(d.phi);
      }
      sparkPosAttr.needsUpdate = true;

      // 6. Live 120-Bar Radial Frequency Spectrum Equalizer Dial
      const dialPosAttr = dialLineGeom.attributes.position as THREE.BufferAttribute;
      const dialPosArray = dialPosAttr.array as Float32Array;

      for (let i = 0; i < dialTicks; i++) {
        const angle = (i / dialTicks) * Math.PI * 2;
        const isMajor = i % 10 === 0;
        const isMid = i % 5 === 0;
        const baseTickLen = isMajor ? 0.35 : isMid ? 0.2 : 0.1;

        let targetBinEnergy = 0;
        if (isActiveAudio && freqArray.length > 0) {
          // 4-quadrant mirrored mapping across bins 1..30 (the prime human vocal spectrum)
          const quadrantPos = i % 30;
          const mirroredBin = quadrantPos < 15 ? 1 + quadrantPos * 2 : 1 + (29 - quadrantPos) * 2;
          targetBinEnergy = ((freqArray[mirroredBin] || 0) / 255) * (0.6 + smoothVol * 0.9);
        } else if (currentState === 'processing') {
          targetBinEnergy = Math.max(0, Math.sin(angle * 4 - time * 8)) * 0.45;
        }

        smoothedTickBins[i] +=
          (targetBinEnergy - smoothedTickBins[i]) *
          (targetBinEnergy > smoothedTickBins[i] ? 0.45 : 0.18);

        const rInner = 4.8 - smoothedTickBins[i] * 0.28;
        const rOuter = 4.8 + baseTickLen + smoothedTickBins[i] * 1.45;

        dialPosArray[i * 6] = Math.cos(angle) * rInner;
        dialPosArray[i * 6 + 1] = Math.sin(angle) * rInner;
        dialPosArray[i * 6 + 2] = smoothedTickBins[i] * 0.2;
        dialPosArray[i * 6 + 3] = Math.cos(angle) * rOuter;
        dialPosArray[i * 6 + 4] = Math.sin(angle) * rOuter;
        dialPosArray[i * 6 + 5] = smoothedTickBins[i] * 0.35;
      }
      dialPosAttr.needsUpdate = true;
      dialLineMaterial.color.lerp(targetMid, 0.12);

      // 7. Inner Formant Harmonic Ribbon (r = 3.85)
      const innerPosAttr = innerWaveGeom.attributes.position as THREE.BufferAttribute;
      const innerPosArray = innerPosAttr.array as Float32Array;
      for (let i = 0; i < innerWaveSegments; i++) {
        const theta = (i / innerWaveSegments) * Math.PI * 2;
        let rOffset = 0;
        if (isActiveAudio && freqArray.length > 0) {
          const bin = 2 + ((i * 3) % 28);
          const fVal = (freqArray[bin] || 0) / 255;
          rOffset =
            Math.sin(theta * 6 + time * 5) * smoothMid * 0.35 +
            fVal * (currentState === 'listening' ? -0.45 : 0.5);
        }
        const r = baseInnerRadius + rOffset;
        innerPosArray[i * 3] = Math.cos(theta) * r;
        innerPosArray[i * 3 + 1] = Math.sin(theta) * r;
        innerPosArray[i * 3 + 2] = Math.cos(theta * 4 - time * 4) * smoothBass * 0.4;
      }
      innerPosAttr.needsUpdate = true;
      innerWaveMat.color.lerp(targetCore, 0.12);

      // 8. Outer Time-Domain Oscilloscope Waveform Ribbon (r = 7.3)
      const wavePosAttr = waveGeom.attributes.position as THREE.BufferAttribute;
      const wavePosArray = wavePosAttr.array as Float32Array;

      for (let i = 0; i < waveSegments; i++) {
        const theta = (i / waveSegments) * Math.PI * 2;
        let offset = 0;

        if (isActiveAudio) {
          if (timeArray && timeArray.length > 0) {
            const timeIndex = Math.floor((i / waveSegments) * timeArray.length);
            const timeVal = (timeArray[timeIndex] - 128) / 128;
            offset += timeVal * (1.2 + smoothVol * 1.8);
          }
          if (freqArray && freqArray.length > 0) {
            const freqIndex = 1 + Math.floor(((i % 45) / 45) * 40);
            const freqVal = (freqArray[freqIndex] || 0) / 255;
            offset += freqVal * 0.85;
          }
        } else if (currentState === 'processing') {
          offset = Math.sin(theta * 8 + time * 10) * 0.25;
        }

        const r = baseWaveRadius + offset;
        wavePosArray[i * 3] = Math.cos(theta) * r;
        wavePosArray[i * 3 + 1] = Math.sin(theta) * r;
        wavePosArray[i * 3 + 2] = Math.sin(theta * 3 + time * 3) * (smoothVol * 0.55);
      }
      wavePosAttr.needsUpdate = true;
      waveMat.color.lerp(targetMid, 0.12);

      // 9. Ambient Quantum Particles (Inward radial pull when listening, outward expansion when speaking)
      const partPosAttr = particleGeom.attributes.position as THREE.BufferAttribute;
      const partPosArray = partPosAttr.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const p = particleData[i];
        p.theta += p.speed * (1.0 + smoothVol * 2.5 + smoothTreble * 2.0);
        const radialShift =
          currentState === 'listening'
            ? -smoothVol * 0.85 // Pulled inward toward acoustic receptor
            : currentState === 'speaking'
            ? smoothVol * 0.95 + Math.sin(p.r * 2 - time * 6) * smoothMid * 0.45 // Projected outward on vocal waves
            : 0;
        const currentR = Math.max(2.6, p.r + radialShift);

        partPosArray[i * 3] = Math.cos(p.theta) * currentR;
        partPosArray[i * 3 + 1] = Math.sin(p.theta) * currentR;
        partPosArray[i * 3 + 2] = p.z + Math.sin(time * 0.6 + p.theta) * (0.15 + smoothBass * 0.45);
      }
      partPosAttr.needsUpdate = true;
      particleMat.color.lerp(targetMid, 0.12);

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      updateCamera(w, h);
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('resize', handleResize);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      coreCoronaTex.dispose();
      sparkTex.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      onClick={onReactorClick}
      className="relative w-full h-full flex items-center justify-center cursor-pointer select-none group touch-manipulation"
      title="Click or tap Arc-Reactor to activate / toggle push-to-talk"
    >
      {/* Sci-Fi Holographic Reticle Overlays */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
        <div className="w-[280px] h-[280px] sm:w-[430px] sm:h-[430px] rounded-full border border-cyan-400/10 animate-[spin_240s_linear_infinite]" />
        <div className="absolute w-[360px] h-[360px] sm:w-[540px] sm:h-[540px] rounded-full border border-dashed border-cyan-500/10 animate-[spin_320s_linear_infinite_reverse]" />
        <div className="absolute w-[460px] h-[460px] sm:w-[680px] sm:h-[680px] rounded-full border border-cyan-400/5 hidden sm:block" />

        <div className="absolute w-full max-w-[740px] h-[1px] bg-gradient-to-r from-transparent via-cyan-500/15 to-transparent" />
        <div className="absolute h-full max-h-[740px] w-[1px] bg-gradient-to-b from-transparent via-cyan-500/15 to-transparent" />

        <div className="absolute bottom-24 sm:bottom-12 flex flex-col items-center px-4 text-center opacity-60 group-hover:opacity-100 transition-opacity duration-300">
          <span className="text-[9px] sm:text-[10px] tracking-[0.25em] sm:tracking-[0.35em] font-orbitron uppercase text-cyan-300 text-glow-cyan">
            {state === 'listening'
              ? 'ACOUSTIC RECEPTORS ARMED // LISTENING'
              : state === 'speaking'
              ? 'NEURAL VOCALIZER ACTIVE // SPEAKING'
              : state === 'processing'
              ? 'QUANTUM MATRIX COMPUTING'
              : 'TAP OR SAY "HEY JARVIS" TO ENGAGE'}
          </span>
          <span className="text-[8px] sm:text-[9px] font-mono-tech text-cyan-600/70 mt-0.5 tracking-widest hidden sm:inline">
            STARK ARC-REACTOR MK-VII // COUPLING: 100%
          </span>
        </div>
      </div>
    </div>
  );
};
