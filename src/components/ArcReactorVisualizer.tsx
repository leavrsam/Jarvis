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

function createAnamorphicFlareTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 32, 512, 32);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0)');
    grad.addColorStop(0.35, 'rgba(0, 240, 255, 0.25)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.65, 'rgba(0, 240, 255, 0.25)');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 64);
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
        // Portrait mobile: scale distance so 3D reactor fits without clipping
        const targetZ = Math.min(54, Math.max(25, 12 / (0.4142 * aspect)));
        camera.position.z = targetZ;
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
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 0.8);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00f0ff, 4.0, 50);
    pointLight.position.set(0, 0, 6);
    scene.add(pointLight);

    const coreLight = new THREE.PointLight(0xffffff, 6.5, 30);
    coreLight.position.set(0, 0, 2);
    scene.add(coreLight);

    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    const reactorGroup = new THREE.Group();
    masterGroup.add(reactorGroup);

    const coreCoronaTex = createRadialGlowTexture(512);
    const sparkTex = createSparkTexture();
    const flareTex = createAnamorphicFlareTexture();

    // ==========================================
    // A. CENTRAL CORE WITH MARK-VI TRIANGULAR REACTOR (Image 3)
    // ==========================================
    const coreContainer = new THREE.Group();
    reactorGroup.add(coreContainer);

    // Corona Bloom Sprite
    const bloomSpriteMat = new THREE.SpriteMaterial({
      map: coreCoronaTex,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const bloomSprite = new THREE.Sprite(bloomSpriteMat);
    bloomSprite.scale.set(11, 11, 1);
    coreContainer.add(bloomSprite);

    // Anamorphic Laser Flare (Image 3 Stark Laser Line)
    const flareMat = new THREE.SpriteMaterial({
      map: flareTex,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flareSprite = new THREE.Sprite(flareMat);
    flareSprite.scale.set(18, 1.8, 1);
    coreContainer.add(flareSprite);

    // 1. Mark-VI Inverted Triangular Reactor Core Geometry (Image 3)
    const triangleGroup = new THREE.Group();
    coreContainer.add(triangleGroup);

    const triShape = new THREE.Shape();
    const triRadius = 1.35;
    // Inverted equilateral triangle
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      const x = Math.cos(angle) * triRadius;
      const y = Math.sin(angle) * triRadius;
      if (i === 0) triShape.moveTo(x, y);
      else triShape.lineTo(x, y);
    }
    triShape.closePath();

    const triPoints = triShape.getPoints();
    const triLineGeom = new THREE.BufferGeometry().setFromPoints(triPoints);
    const triLineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const triOutline = new THREE.LineLoop(triLineGeom, triLineMat);
    triangleGroup.add(triOutline);

    // Inner Concentric Triangular Chevron Vents
    const innerTriShape = new THREE.Shape();
    const innerTriRadius = 0.88;
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      const x = Math.cos(angle) * innerTriRadius;
      const y = Math.sin(angle) * innerTriRadius;
      if (i === 0) innerTriShape.moveTo(x, y);
      else innerTriShape.lineTo(x, y);
    }
    innerTriShape.closePath();

    const innerTriGeom = new THREE.BufferGeometry().setFromPoints(innerTriShape.getPoints());
    const innerTriMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const innerTriOutline = new THREE.LineLoop(innerTriGeom, innerTriMat);
    triangleGroup.add(innerTriOutline);

    // 2. 10 Segmented Arc Reactor Stator Blocks (Image 3)
    const statorGroup = new THREE.Group();
    coreContainer.add(statorGroup);

    const statorBlocks: THREE.Line[] = [];
    const statorCount = 10;
    const statorRInner = 1.75;
    const statorROuter = 2.05;

    for (let i = 0; i < statorCount; i++) {
      const baseAngle = (i * 2 * Math.PI) / statorCount;
      const arcSpan = (2 * Math.PI) / statorCount * 0.72; // Gap between blocks
      const startA = baseAngle - arcSpan / 2;
      const endA = baseAngle + arcSpan / 2;

      const pts: THREE.Vector3[] = [];
      const steps = 8;
      // Outer arc
      for (let j = 0; j <= steps; j++) {
        const a = startA + (j / steps) * (endA - startA);
        pts.push(new THREE.Vector3(Math.cos(a) * statorROuter, Math.sin(a) * statorROuter, 0));
      }
      // Inner arc reverse
      for (let j = steps; j >= 0; j--) {
        const a = startA + (j / steps) * (endA - startA);
        pts.push(new THREE.Vector3(Math.cos(a) * statorRInner, Math.sin(a) * statorRInner, 0));
      }
      pts.push(pts[0].clone()); // Close loop

      const statorGeom = new THREE.BufferGeometry().setFromPoints(pts);
      const statorMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
      });
      const statorMesh = new THREE.Line(statorGeom, statorMat);
      statorGroup.add(statorMesh);
      statorBlocks.push(statorMesh);
    }

    // 3. Volumetric Acoustic Plasma Shader Core
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
        float freq1 = 3.0 + floor(uPitch * 4.0);
        float freq2 = 6.0 + floor(uPitch * 6.0);
        float waveBass = sin(position.x * freq1 + uTime * 3.2) * cos(position.y * freq1 - uTime * 2.6) * uBass * 0.26;
        float waveMid = sin(position.y * freq2 - uTime * 5.0) * sin(position.z * freq2 + uTime * 4.2) * uMid * 0.20;
        float waveTreble = cos(position.x * 14.0 + position.z * 14.0 + uTime * 9.0) * uTreble * 0.10;

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

    const plasmaSphereGeom = new THREE.SphereGeometry(1.4, 48, 48);
    const plasmaSphere = new THREE.Mesh(plasmaSphereGeom, plasmaMaterial);
    coreContainer.add(plasmaSphere);

    // 4. Geodesic Wireframe Lattice Cage (Image 2)
    const geodesicGeom = new THREE.IcosahedronGeometry(2.45, 3);
    const baseGeodesicPos = new Float32Array(
      (geodesicGeom.attributes.position as THREE.BufferAttribute).array
    );
    const geodesicMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
    });
    const geodesicMesh = new THREE.Mesh(geodesicGeom, geodesicMat);
    coreContainer.add(geodesicMesh);

    // ==========================================
    // B. 3D ACOUSTIC WAVE POINT-CLOUD SHELL (Image 4 & Image 2)
    // ==========================================
    // 2,400 points uniformly distributed on a Fibonacci Sphere surface (radius = 3.65)
    // In render loop, points are dynamically displaced by live audio frequency harmonics!
    const pointCount = 2400;
    const waveShellGeom = new THREE.BufferGeometry();
    const waveShellPos = new Float32Array(pointCount * 3);
    const baseWaveShellPos = new Float32Array(pointCount * 3);
    const shellBaseR = 3.65;

    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    for (let i = 0; i < pointCount; i++) {
      const theta = 2 * Math.PI * i / goldenRatio;
      const phi = Math.acos(1 - 2 * (i + 0.5) / pointCount);

      const x = Math.cos(theta) * Math.sin(phi);
      const y = Math.sin(theta) * Math.sin(phi);
      const z = Math.cos(phi);

      baseWaveShellPos[i * 3] = x * shellBaseR;
      baseWaveShellPos[i * 3 + 1] = y * shellBaseR;
      baseWaveShellPos[i * 3 + 2] = z * shellBaseR;

      waveShellPos[i * 3] = baseWaveShellPos[i * 3];
      waveShellPos[i * 3 + 1] = baseWaveShellPos[i * 3 + 1];
      waveShellPos[i * 3 + 2] = baseWaveShellPos[i * 3 + 2];
    }

    waveShellGeom.setAttribute('position', new THREE.BufferAttribute(waveShellPos, 3));
    const waveShellMat = new THREE.PointsMaterial({
      map: sparkTex,
      color: 0x00f0ff,
      size: 0.36,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const waveShellPoints = new THREE.Points(waveShellGeom, waveShellMat);
    reactorGroup.add(waveShellPoints);

    // ==========================================
    // C. SCRIBED ORBITAL RADAR TRACKS & LONGITUDE/LATITUDE ARCS (Image 1)
    // ==========================================
    const orbitalGroup = new THREE.Group();
    // Tilted at 23.5° like a planetary celestial hologram (Image 1)
    orbitalGroup.rotation.x = THREE.MathUtils.degToRad(23.5);
    reactorGroup.add(orbitalGroup);

    // Orbital ring 1 (Latitude Ring)
    const orbRing1Geom = new THREE.BufferGeometry().setFromPoints(
      new THREE.EllipseCurve(0, 0, 4.35, 4.35, 0, Math.PI * 2, false, 0).getPoints(140)
    );
    const orbRing1Mat = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
    });
    const orbRing1 = new THREE.LineLoop(orbRing1Geom, orbRing1Mat);
    orbitalGroup.add(orbRing1);

    // Orbital ring 2 (Outer Polar Ring)
    const orbRing2Geom = new THREE.BufferGeometry().setFromPoints(
      new THREE.EllipseCurve(0, 0, 5.15, 5.15, 0, Math.PI * 2, false, 0).getPoints(140)
    );
    const orbRing2Mat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });
    const orbRing2 = new THREE.LineLoop(orbRing2Geom, orbRing2Mat);
    orbitalGroup.add(orbRing2);

    // Scribed Tick Marks on Orbital Track (Image 1)
    const orbTicks = 80;
    const orbTickPos = new Float32Array(orbTicks * 2 * 3);
    for (let i = 0; i < orbTicks; i++) {
      const a = (i / orbTicks) * Math.PI * 2;
      const isMajor = i % 8 === 0;
      const rIn = 4.35;
      const rOut = rIn + (isMajor ? 0.22 : 0.1);
      orbTickPos[i * 6] = Math.cos(a) * rIn;
      orbTickPos[i * 6 + 1] = Math.sin(a) * rIn;
      orbTickPos[i * 6 + 2] = 0;
      orbTickPos[i * 6 + 3] = Math.cos(a) * rOut;
      orbTickPos[i * 6 + 4] = Math.sin(a) * rOut;
      orbTickPos[i * 6 + 5] = 0;
    }
    const orbTickGeom = new THREE.BufferGeometry();
    orbTickGeom.setAttribute('position', new THREE.BufferAttribute(orbTickPos, 3));
    const orbTickMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const orbTickSegments = new THREE.LineSegments(orbTickGeom, orbTickMat);
    orbitalGroup.add(orbTickSegments);

    // ==========================================
    // D. LIVE 120-BAR RADIAL EQUALIZER & OSCILLOSCOPE RIBBONS
    // ==========================================
    const telemetryGroup = new THREE.Group();
    reactorGroup.add(telemetryGroup);

    // Live 120-Bar Radial Frequency Spectrum Chronograph Dial
    const dialTicks = 120;
    const tickPositions = new Float32Array(dialTicks * 2 * 3);
    const smoothedTickBins = new Float32Array(dialTicks);

    for (let i = 0; i < dialTicks; i++) {
      const angle = (i / dialTicks) * Math.PI * 2;
      const isMajor = i % 10 === 0;
      const isMid = i % 5 === 0;
      const rInner = 5.85;
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
    telemetryGroup.add(dialLineSegments);

    // Outer Time-Domain Oscilloscope Waveform Ribbon (r = 7.4)
    const waveSegments = 180;
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
      blending: THREE.AdditiveBlending,
    });
    const waveRing = new THREE.LineLoop(waveGeom, waveMat);
    telemetryGroup.add(waveRing);

    // Outer Horizon Boundary with Cardinal Laser Ticks
    const outerHorizonGeom = new THREE.TorusGeometry(8.9, 0.02, 8, 140);
    const outerHorizonMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    const outerHorizon = new THREE.Mesh(outerHorizonGeom, outerHorizonMat);
    telemetryGroup.add(outerHorizon);

    // ==========================================
    // E. FLOATING AMBIENT STARDUST CONSTELLATION EMBERS (Image 5)
    // ==========================================
    const stardustCount = 800;
    const stardustGeom = new THREE.BufferGeometry();
    const stardustPositions = new Float32Array(stardustCount * 3);
    const stardustData: { r: number; theta: number; phi: number; speed: number; pulseSpeed: number }[] = [];

    for (let i = 0; i < stardustCount; i++) {
      const r = 3.2 + Math.random() * 7.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.9;

      stardustPositions[i * 3] = r * Math.cos(theta) * Math.cos(phi);
      stardustPositions[i * 3 + 1] = r * Math.sin(theta) * Math.cos(phi);
      stardustPositions[i * 3 + 2] = r * Math.sin(phi);

      stardustData.push({
        r,
        theta,
        phi,
        speed: (0.0004 + Math.random() * 0.0012) * (Math.random() > 0.5 ? 1 : -1),
        pulseSpeed: 1.0 + Math.random() * 2.5,
      });
    }

    stardustGeom.setAttribute('position', new THREE.BufferAttribute(stardustPositions, 3));
    const stardustMat = new THREE.PointsMaterial({
      map: sparkTex,
      color: 0x00f0ff,
      size: 0.28,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const stardustCloud = new THREE.Points(stardustGeom, stardustMat);
    reactorGroup.add(stardustCloud);

    // ==========================================
    // F. INTERACTIVE TOUCH & MOUSE PARALLAX
    // ==========================================
    let targetTiltX = 0;
    let targetTiltY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetTiltY = nx * 0.18;
      targetTiltX = -ny * 0.18;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const rect = container.getBoundingClientRect();
        const nx = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((touch.clientY - rect.top) / rect.height) * 2 - 1);
        targetTiltY = nx * 0.24;
        targetTiltX = -ny * 0.24;
      }
    };
    window.addEventListener('touchmove', handleTouchMove, { passive: true });

    // Click handler on core
    const handleCanvasClick = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      onReactorClick?.();
    };
    renderer.domElement.addEventListener('click', handleCanvasClick);

    // ==========================================
    // G. MAIN 60FPS ACOUSTIC & SPECTRAL ANIMATION LOOP
    // ==========================================
    let animFrameId: number;
    const clock = new THREE.Clock();

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

      // Telemetry audio data
      const telemetry = audioEngine.getAudioTelemetry();
      const isActiveAudio = currentState === 'listening' || currentState === 'speaking';

      const rawVol = isActiveAudio ? telemetry.volume : 0;
      const rawBass = isActiveAudio ? telemetry.bass : 0;
      const rawMid = isActiveAudio ? telemetry.mid : 0;
      const rawTreble = isActiveAudio ? telemetry.treble : 0;
      const rawPitch = isActiveAudio ? telemetry.spectralCentroid : 0.25;

      smoothVol += (rawVol - smoothVol) * (rawVol > smoothVol ? 0.38 : 0.14);
      smoothBass += (rawBass - smoothBass) * (rawBass > smoothBass ? 0.38 : 0.14);
      smoothMid += (rawMid - smoothMid) * (rawMid > smoothMid ? 0.34 : 0.15);
      smoothTreble += (rawTreble - smoothTreble) * (rawTreble > smoothTreble ? 0.42 : 0.18);
      smoothPitch += (rawPitch - smoothPitch) * 0.14;

      const freqArray = telemetry.frequencyData;
      const timeArray = telemetry.timeDomainData;

      // Dynamic Color Palettes (Cyan for Listening ↔ Amber-Gold for Speaking - Image 1)
      let pulseMod = 1.0;
      const targetCore = new THREE.Color(0xffffff);
      const targetMid = new THREE.Color(0x00f0ff);
      const targetRim = new THREE.Color(0x0055ff);

      if (currentState === 'listening') {
        // Acoustic Ingest Receptor Mode (Bioluminescent Emerald & Electric Cyan)
        pulseMod = 1.15 + smoothVol * 4.5 + smoothBass * 2.2;
        const emerald = new THREE.Color(0x10b981);
        const electricCyan = new THREE.Color(0x00f0ff);
        targetMid.copy(emerald).lerp(electricCyan, smoothPitch);
        targetRim.setHex(0x00ffa3).lerp(new THREE.Color(0x0284c7), smoothPitch);
        targetCore.setHex(0xffffff);
      } else if (currentState === 'speaking') {
        // J.A.R.V.I.S. Movie Hologram Mode (Stark Amber-Gold & Warm Plasma - Image 1)
        pulseMod = 1.25 + smoothVol * 4.2 + smoothMid * 2.5;
        const warmGold = new THREE.Color(0xf59e0b);
        const brightAmber = new THREE.Color(0xfbbf24);
        targetMid.copy(warmGold).lerp(brightAmber, smoothMid * 0.7 + smoothPitch * 0.3);
        targetRim.setHex(0xd97706).lerp(new THREE.Color(0xb45309), smoothBass * 0.5);
        targetCore.setHex(0xfffbeb).lerp(new THREE.Color(0xfef08a), smoothMid * 0.6);
      } else if (currentState === 'processing') {
        pulseMod = 1.6 + Math.sin(time * 8) * 0.4;
        targetCore.setHex(0xfef08a);
        targetMid.setHex(0xf59e0b);
        targetRim.setHex(0xd97706);
      } else {
        pulseMod = 1.0 + Math.sin(time * 1.2) * 0.04;
        targetCore.setHex(0xffffff);
        targetMid.setHex(0x00f0ff);
        targetRim.setHex(0x0044cc);
      }

      // 1. Mouse/Touch Gyroscopic Parallax
      const subtleBreathY = Math.sin(time * 0.2) * 0.003;
      const subtleBreathX = Math.cos(time * 0.16) * 0.003;
      masterGroup.rotation.y += (targetTiltY + subtleBreathY - masterGroup.rotation.y) * 0.08;
      masterGroup.rotation.x += (targetTiltX + subtleBreathX - masterGroup.rotation.x) * 0.08;
      masterGroup.position.y = Math.sin(time * 0.4) * 0.035;

      // 2. Mark-VI Triangular Core & Stator Rotation
      const speedMult = currentState === 'processing' ? 3.0 : 1.0;
      triangleGroup.rotation.z += 0.002 * speedMult + smoothBass * 0.015;
      statorGroup.rotation.z -= 0.0015 * speedMult + smoothMid * 0.012;

      // Pulse triangle and stators on audio
      triLineMat.color.lerp(targetCore, 0.14);
      innerTriMat.color.lerp(targetMid, 0.14);
      triOutline.scale.setScalar(1.0 + smoothBass * 0.22 + smoothVol * 0.15);
      innerTriOutline.scale.setScalar(1.0 + smoothMid * 0.25);

      statorBlocks.forEach((b, idx) => {
        const mat = b.material as THREE.LineBasicMaterial;
        mat.color.lerp(targetMid, 0.14);
        mat.opacity = 0.5 + smoothVol * 0.5 + (idx % 2 === 0 ? smoothTreble * 0.3 : 0);
      });

      // 3. Anamorphic Horizontal Laser Flares (Image 3)
      flareSprite.scale.x = 18 + smoothVol * 14 + smoothBass * 8;
      flareSprite.scale.y = 1.8 + smoothVol * 2.2;
      flareMat.color.lerp(targetMid, 0.14);
      flareMat.opacity = 0.35 + smoothVol * 0.65;

      // 4. Volumetric Acoustic Plasma Shader Core
      plasmaUniforms.uTime.value = time;
      plasmaUniforms.uAudioPulse.value = smoothVol;
      plasmaUniforms.uBass.value = smoothBass;
      plasmaUniforms.uMid.value = smoothMid;
      plasmaUniforms.uTreble.value = smoothTreble;
      plasmaUniforms.uPitch.value = smoothPitch;
      plasmaUniforms.uColorCore.value.lerp(targetCore, 0.14);
      plasmaUniforms.uColorMid.value.lerp(targetMid, 0.14);
      plasmaUniforms.uColorRim.value.lerp(targetRim, 0.14);

      const baseScale = 1.0 + Math.sin(time * 1.5) * 0.018;
      const audioScale = baseScale + smoothBass * 0.55 + smoothVol * 0.45;
      coreContainer.scale.set(audioScale, audioScale, audioScale);

      const spriteScale = 9.8 + smoothVol * 6.5 + smoothBass * 3.2 + Math.sin(time * 2) * 0.15;
      bloomSprite.scale.set(spriteScale, spriteScale, 1);
      bloomSpriteMat.opacity = Math.min(0.95, 0.52 + smoothVol * 0.48);
      bloomSpriteMat.color.lerp(targetMid, 0.14);

      coreLight.intensity = 4.5 + smoothVol * 14.0;
      pointLight.intensity = 2.8 + smoothVol * 9.0;
      pointLight.color.lerp(targetMid, 0.14);

      // 5. Geodesic Wireframe Deformation (Image 2)
      geodesicMesh.rotation.y -= 0.002 * pulseMod;
      geodesicMesh.rotation.x += 0.0012 * smoothMid;
      geodesicMat.color.lerp(targetMid, 0.14);
      geodesicMat.opacity = 0.25 + smoothVol * 0.5;

      const geoPosAttr = geodesicGeom.attributes.position as THREE.BufferAttribute;
      const geoPosArr = geoPosAttr.array as Float32Array;
      const vertexCount = geoPosAttr.count;

      for (let i = 0; i < vertexCount; i++) {
        const bx = baseGeodesicPos[i * 3];
        const by = baseGeodesicPos[i * 3 + 1];
        const bz = baseGeodesicPos[i * 3 + 2];

        let deform = 1.0;
        if (isActiveAudio && freqArray.length > 0) {
          const binIdx = 1 + ((i * 7) % 44);
          const binVal = (freqArray[binIdx] || 0) / 255;
          const waveSample = timeArray.length > 0 ? (timeArray[i % timeArray.length] - 128) / 128 : 0;
          deform =
            1.0 +
            binVal * (currentState === 'listening' ? 0.36 : 0.30) +
            waveSample * 0.14 * smoothVol;
        } else if (currentState === 'processing') {
          deform = 1.0 + Math.sin(time * 8 + bx * 2 + by * 2) * 0.09;
        }

        geoPosArr[i * 3] = bx * deform;
        geoPosArr[i * 3 + 1] = by * deform;
        geoPosArr[i * 3 + 2] = bz * deform;
      }
      geoPosAttr.needsUpdate = true;

      // 6. 3D Acoustic Wave Point-Cloud Shell (Image 4 & Image 2)
      // Displaces 2,400 points in 3D using spherical harmonics and live FFT
      const shellPosAttr = waveShellGeom.attributes.position as THREE.BufferAttribute;
      const shellPosArr = shellPosAttr.array as Float32Array;

      waveShellPoints.rotation.y += 0.0015 * (1 + smoothMid * 2.5);
      waveShellPoints.rotation.z -= 0.0008 * (1 + smoothTreble * 3.0);
      waveShellMat.color.lerp(targetMid, 0.14);
      waveShellMat.size = 0.34 + smoothVol * 0.22 + smoothTreble * 0.15;

      for (let i = 0; i < pointCount; i++) {
        const bx = baseWaveShellPos[i * 3];
        const by = baseWaveShellPos[i * 3 + 1];
        const bz = baseWaveShellPos[i * 3 + 2];

        // Spherical coordinate factors
        const normX = bx / shellBaseR;
        const normY = by / shellBaseR;
        const normZ = bz / shellBaseR;

        let radialFactor = 1.0;

        if (isActiveAudio) {
          // Harmonic wave distortion
          const wave1 = Math.sin(normX * 8.0 + time * 6.0) * Math.cos(normY * 8.0 - time * 5.0);
          const wave2 = Math.cos(normZ * 12.0 + time * 8.0) * smoothTreble;
          const fftBin = 1 + ((i * 5) % 40);
          const fftVal = ((freqArray[fftBin] || 0) / 255) * 0.8;

          if (currentState === 'listening') {
            // Ingest mode: ripples pull inward toward core
            radialFactor = 1.0 - smoothVol * 0.35 + wave1 * (0.15 + smoothMid * 0.35) + fftVal * 0.25;
          } else {
            // Projection mode: sound shockwave billows outward
            radialFactor = 1.0 + smoothVol * 0.45 + wave1 * (0.2 + smoothMid * 0.4) + wave2 * 0.18 + fftVal * 0.35;
          }
        } else if (currentState === 'processing') {
          radialFactor = 1.0 + Math.sin(normX * 6 + normY * 6 + time * 10) * 0.12;
        } else {
          // Ambient breathing ripple
          radialFactor = 1.0 + Math.sin(normX * 4 + time * 2) * Math.cos(normY * 4 + time * 1.5) * 0.05;
        }

        shellPosArr[i * 3] = bx * radialFactor;
        shellPosArr[i * 3 + 1] = by * radialFactor;
        shellPosArr[i * 3 + 2] = bz * radialFactor;
      }
      shellPosAttr.needsUpdate = true;

      // 7. Scribed Orbital Tracks Rotation & Color (Image 1)
      orbitalGroup.rotation.z += 0.001 * speedMult + smoothBass * 0.015;
      orbRing1Mat.color.lerp(targetMid, 0.14);
      orbRing2Mat.color.lerp(targetRim, 0.14);
      orbTickMat.color.lerp(targetMid, 0.14);

      // 8. 120-Bar Radial Equalizer Dial (Image 2)
      dialLineSegments.rotation.z -= 0.0006 * speedMult + smoothBass * 0.016;
      const dialPosAttr = dialLineGeom.attributes.position as THREE.BufferAttribute;
      const dialPosArray = dialPosAttr.array as Float32Array;

      for (let i = 0; i < dialTicks; i++) {
        const angle = (i / dialTicks) * Math.PI * 2;
        const isMajor = i % 10 === 0;
        const isMid = i % 5 === 0;
        const baseTickLen = isMajor ? 0.35 : isMid ? 0.2 : 0.1;

        let targetBinEnergy = 0;
        if (isActiveAudio && freqArray.length > 0) {
          const quadrantPos = i % 30;
          const mirroredBin = quadrantPos < 15 ? 1 + quadrantPos * 2 : 1 + (29 - quadrantPos) * 2;
          targetBinEnergy = ((freqArray[mirroredBin] || 0) / 255) * (0.6 + smoothVol * 0.95);
        } else if (currentState === 'processing') {
          targetBinEnergy = Math.max(0, Math.sin(angle * 4 - time * 8)) * 0.45;
        }

        smoothedTickBins[i] +=
          (targetBinEnergy - smoothedTickBins[i]) *
          (targetBinEnergy > smoothedTickBins[i] ? 0.48 : 0.18);

        const rInner = 5.85 - smoothedTickBins[i] * 0.25;
        const rOuter = 5.85 + baseTickLen + smoothedTickBins[i] * 1.55;

        dialPosArray[i * 6] = Math.cos(angle) * rInner;
        dialPosArray[i * 6 + 1] = Math.sin(angle) * rInner;
        dialPosArray[i * 6 + 2] = smoothedTickBins[i] * 0.2;
        dialPosArray[i * 6 + 3] = Math.cos(angle) * rOuter;
        dialPosArray[i * 6 + 4] = Math.sin(angle) * rOuter;
        dialPosArray[i * 6 + 5] = smoothedTickBins[i] * 0.35;
      }
      dialPosAttr.needsUpdate = true;
      dialLineMaterial.color.lerp(targetMid, 0.14);

      // 9. Time-Domain Oscilloscope Waveform Ribbon
      const wavePosAttr = waveGeom.attributes.position as THREE.BufferAttribute;
      const wavePosArray = wavePosAttr.array as Float32Array;

      for (let i = 0; i < waveSegments; i++) {
        const theta = (i / waveSegments) * Math.PI * 2;
        let offset = 0;

        if (isActiveAudio) {
          if (timeArray && timeArray.length > 0) {
            const timeIndex = Math.floor((i / waveSegments) * timeArray.length);
            const timeVal = (timeArray[timeIndex] - 128) / 128;
            offset += timeVal * (1.2 + smoothVol * 1.9);
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
      waveMat.color.lerp(targetMid, 0.14);
      outerHorizonMat.color.lerp(targetRim, 0.14);

      // 10. Ambient Stardust Constellation Embers (Image 5)
      const stardustPosAttr = stardustGeom.attributes.position as THREE.BufferAttribute;
      const stardustPosArr = stardustPosAttr.array as Float32Array;

      for (let i = 0; i < stardustCount; i++) {
        const d = stardustData[i];
        d.theta += d.speed * (1.0 + smoothVol * 2.8 + smoothTreble * 2.5);
        d.phi += d.speed * 0.4;

        const radialShift =
          currentState === 'listening'
            ? -smoothVol * 0.9 // Pulled inward
            : currentState === 'speaking'
            ? smoothVol * 1.1 + Math.sin(d.r * 2 - time * 5) * smoothMid * 0.5 // Projected outward
            : Math.sin(time * d.pulseSpeed) * 0.08;

        const currentR = Math.max(2.8, d.r + radialShift);

        stardustPosArr[i * 3] = currentR * Math.cos(d.theta) * Math.cos(d.phi);
        stardustPosArr[i * 3 + 1] = currentR * Math.sin(d.theta) * Math.cos(d.phi);
        stardustPosArr[i * 3 + 2] = currentR * Math.sin(d.phi);
      }
      stardustPosAttr.needsUpdate = true;
      stardustMat.color.lerp(targetMid, 0.14);

      // Render Scene
      renderer.render(scene, camera);
    };

    animFrameId = requestAnimationFrame(animate);

    // Resize Observer
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      updateCamera(w, h);
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      renderer.domElement.removeEventListener('click', handleCanvasClick);

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
      coreCoronaTex.dispose();
      sparkTex.dispose();
      flareTex.dispose();
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onReactorClick]);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-full cursor-pointer select-none"
      title="Click or tap to toggle listening"
    />
  );
};
