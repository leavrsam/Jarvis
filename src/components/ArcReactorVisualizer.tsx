import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { audioEngine, JarvisAudioState } from '../services/audioEngine';

interface ArcReactorVisualizerProps {
  state: JarvisAudioState;
  onReactorClick?: () => void;
}

/**
 * Procedural dual-tone radial soft glow texture (White-Gold core fading to Arc Cyan rim)
 */
function createRadialGlowTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const center = size / 2;
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.15, 'rgba(255, 235, 170, 0.95)');
    grad.addColorStop(0.35, 'rgba(245, 158, 11, 0.65)');
    grad.addColorStop(0.60, 'rgba(0, 240, 255, 0.28)');
    grad.addColorStop(0.82, 'rgba(2, 132, 199, 0.08)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Procedural pinpoint spark texture for stardust embers and acoustic nodes
 */
function createSparkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.25, 'rgba(255, 225, 130, 0.95)');
    grad.addColorStop(0.55, 'rgba(0, 240, 255, 0.45)');
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
        // Mobile portrait viewport distance
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
    renderer.toneMappingExposure = 1.55;
    container.appendChild(renderer.domElement);

    // 2. Cinematic Dual-Color Dynamic Lighting (Stark Gold + Electric Arc Blue)
    const ambientLight = new THREE.AmbientLight(0xffb020, 0.7);
    scene.add(ambientLight);

    // Gold Key Light (Top-Right Orbit)
    const pointLightGold = new THREE.PointLight(0xff9d00, 3.8, 60);
    pointLightGold.position.set(6, 6, 8);
    scene.add(pointLightGold);

    // Electric Cyan Fill Light (Bottom-Left Orbit)
    const pointLightCyan = new THREE.PointLight(0x00f0ff, 3.8, 60);
    pointLightCyan.position.set(-6, -6, 8);
    scene.add(pointLightCyan);

    // Incandescent Core Light
    const coreLight = new THREE.PointLight(0xfffaed, 8.0, 35);
    coreLight.position.set(0, 0, 2);
    scene.add(coreLight);

    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    const reactorGroup = new THREE.Group();
    masterGroup.add(reactorGroup);

    const coreCoronaTex = createRadialGlowTexture(512);
    const sparkTex = createSparkTexture();

    // ==========================================
    // A. CENTRAL CORE WITH MARK-VI TRIANGULAR REACTOR (Image 3)
    // ==========================================
    const coreContainer = new THREE.Group();
    reactorGroup.add(coreContainer);

    // Corona Bloom Sprite (Dynamic Dual Tint: Cyan ↔ Gold)
    const bloomSpriteMat = new THREE.SpriteMaterial({
      map: coreCoronaTex,
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const bloomSprite = new THREE.Sprite(bloomSpriteMat);
    bloomSprite.scale.set(11.5, 11.5, 1);
    coreContainer.add(bloomSprite);

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
      color: 0xfffaed,
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
      opacity: 0.88,
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
      pts.push(pts[0].clone());

      const statorGeom = new THREE.BufferGeometry().setFromPoints(pts);
      // Alternate stators with subtle Gold and Arc Blue accents
      const statorMat = new THREE.LineBasicMaterial({
        color: i % 2 === 0 ? 0xf59e0b : 0x00f0ff,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
      });
      const statorMesh = new THREE.Line(statorGeom, statorMat);
      statorGroup.add(statorMesh);
      statorBlocks.push(statorMesh);
    }

    // 3. Volumetric Acoustic Plasma Shader Core (Dual-Tone Blue & Gold Interweave)
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
        float waveBass = sin(position.x * freq1 + uTime * 3.2) * cos(position.y * freq1 - uTime * 2.6) * uBass * 0.28;
        float waveMid = sin(position.y * freq2 - uTime * 5.0) * sin(position.z * freq2 + uTime * 4.2) * uMid * 0.22;
        float waveTreble = cos(position.x * 14.0 + position.z * 14.0 + uTime * 9.0) * uTreble * 0.12;

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
      uniform vec3 uColorSecondary;
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

        // Dynamic dual-wave filament pattern
        float wave1 = sin(normal.x * (6.0 + uPitch * 8.0) + uTime * 3.5);
        float wave2 = cos(normal.y * (6.0 + uMid * 8.0) - uTime * 2.8);
        float plasmaWave = wave1 * wave2;
        float filament = smoothstep(-0.2, 0.8, plasmaWave) * (0.3 + uMid * 0.8 + uTreble * 0.5);

        float hotCore = pow(radial, 3.4 - uBass * 1.4) * (1.3 + uAudioPulse * 1.2);

        // Core blends from mid to core, with dual-tone secondary chromatic rim highlights
        vec3 color = mix(uColorMid, uColorCore, pow(radial, 1.4));
        color = mix(color, uColorRim, rimGlow * 0.85);

        // Secondary color ribbon (weaves Blue with Gold along the spiral)
        float secondaryBand = clamp(sin(normal.z * 8.0 + uTime * 2.5), 0.0, 1.0);
        color = mix(color, uColorSecondary, secondaryBand * 0.45 * (0.5 + uAudioPulse * 0.5));

        color += uColorCore * filament * 0.45;
        color += vec3(1.0, 0.98, 0.92) * (hotCore * 0.65 + clamp(vDisplacement * 2.5, 0.0, 0.6));

        float alpha = clamp(pow(radial, 1.05) * 0.94 + rimGlow * 0.98, 0.0, 1.0);
        alpha *= (0.88 + uAudioPulse * 0.15);

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
      uColorCore: { value: new THREE.Color(0xfffaed) },
      uColorMid: { value: new THREE.Color(0xf59e0b) },
      uColorRim: { value: new THREE.Color(0x00f0ff) },
      uColorSecondary: { value: new THREE.Color(0x0077ff) },
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

    // 4. Geodesic Wireframe Lattice Cage (Image 2) - Electric Cyan
    const geodesicGeom = new THREE.IcosahedronGeometry(2.45, 3);
    const baseGeodesicPos = new Float32Array(
      (geodesicGeom.attributes.position as THREE.BufferAttribute).array
    );
    const geodesicMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
    });
    const geodesicMesh = new THREE.Mesh(geodesicGeom, geodesicMat);
    coreContainer.add(geodesicMesh);

    // ==========================================
    // B. 3D ACOUSTIC WAVE POINT-CLOUD SHELL (Image 4 & Image 2)
    // Dynamic color gradient per vertex: Gold equator ↔ Cyan poles
    // ==========================================
    const pointCount = 2400;
    const waveShellGeom = new THREE.BufferGeometry();
    const waveShellPos = new Float32Array(pointCount * 3);
    const baseWaveShellPos = new Float32Array(pointCount * 3);
    const waveShellColors = new Float32Array(pointCount * 3);
    const shellBaseR = 3.65;

    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    for (let i = 0; i < pointCount; i++) {
      const theta = (2 * Math.PI * i) / goldenRatio;
      const phi = Math.acos(1 - (2 * (i + 0.5)) / pointCount);

      const x = Math.cos(theta) * Math.sin(phi);
      const y = Math.sin(theta) * Math.sin(phi);
      const z = Math.cos(phi);

      baseWaveShellPos[i * 3] = x * shellBaseR;
      baseWaveShellPos[i * 3 + 1] = y * shellBaseR;
      baseWaveShellPos[i * 3 + 2] = z * shellBaseR;

      waveShellPos[i * 3] = baseWaveShellPos[i * 3];
      waveShellPos[i * 3 + 1] = baseWaveShellPos[i * 3 + 1];
      waveShellPos[i * 3 + 2] = baseWaveShellPos[i * 3 + 2];

      // Dual-palette initial vertex colors: Gold near equator, Cyan near poles
      const latFactor = Math.abs(z);
      const r = THREE.MathUtils.lerp(0.98, 0.0, latFactor);
      const g = THREE.MathUtils.lerp(0.68, 0.94, latFactor);
      const b = THREE.MathUtils.lerp(0.12, 1.0, latFactor);
      waveShellColors[i * 3] = r;
      waveShellColors[i * 3 + 1] = g;
      waveShellColors[i * 3 + 2] = b;
    }

    waveShellGeom.setAttribute('position', new THREE.BufferAttribute(waveShellPos, 3));
    waveShellGeom.setAttribute('color', new THREE.BufferAttribute(waveShellColors, 3));

    const waveShellMat = new THREE.PointsMaterial({
      map: sparkTex,
      vertexColors: true,
      size: 0.38,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const waveShellPoints = new THREE.Points(waveShellGeom, waveShellMat);
    reactorGroup.add(waveShellPoints);

    // ==========================================
    // C. ICONIC 3D INCLINED CELESTIAL GYROSCOPE RINGS (Image 2) - Stark Gold
    // ==========================================
    // 1. Primary Inclined Celestial Ring (tilted ~35° on X, 18° on Y)
    const gyroGroup1 = new THREE.Group();
    gyroGroup1.rotation.x = THREE.MathUtils.degToRad(35);
    gyroGroup1.rotation.y = THREE.MathUtils.degToRad(18);
    reactorGroup.add(gyroGroup1);

    const gyroRingRadius = 4.75;
    const gyroRingGeom = new THREE.BufferGeometry().setFromPoints(
      new THREE.EllipseCurve(0, 0, gyroRingRadius, gyroRingRadius, 0, Math.PI * 2, false, 0).getPoints(160)
    );
    const gyroRingMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const gyroRing1 = new THREE.LineLoop(gyroRingGeom, gyroRingMat);
    gyroGroup1.add(gyroRing1);

    // Concentric Inner Filament Ring - Cyan accent
    const gyroInnerRadius = 4.45;
    const gyroInnerGeom = new THREE.BufferGeometry().setFromPoints(
      new THREE.EllipseCurve(0, 0, gyroInnerRadius, gyroInnerRadius, 0, Math.PI * 2, false, 0).getPoints(140)
    );
    const gyroInnerMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const gyroInnerRing = new THREE.LineLoop(gyroInnerGeom, gyroInnerMat);
    gyroGroup1.add(gyroInnerRing);

    // Scribed Circuit Dash Segments along Inclined Ring
    const gyroTicks = 72;
    const gyroTickPos = new Float32Array(gyroTicks * 2 * 3);
    for (let i = 0; i < gyroTicks; i++) {
      const a = (i / gyroTicks) * Math.PI * 2;
      const isMajor = i % 6 === 0;
      const rIn = gyroInnerRadius;
      const rOut = rIn + (isMajor ? 0.35 : 0.15);
      gyroTickPos[i * 6] = Math.cos(a) * rIn;
      gyroTickPos[i * 6 + 1] = Math.sin(a) * rIn;
      gyroTickPos[i * 6 + 2] = 0;
      gyroTickPos[i * 6 + 3] = Math.cos(a) * rOut;
      gyroTickPos[i * 6 + 4] = Math.sin(a) * rOut;
      gyroTickPos[i * 6 + 5] = 0;
    }
    const gyroTickGeom = new THREE.BufferGeometry();
    gyroTickGeom.setAttribute('position', new THREE.BufferAttribute(gyroTickPos, 3));
    const gyroTickMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    const gyroTickSegments = new THREE.LineSegments(gyroTickGeom, gyroTickMat);
    gyroGroup1.add(gyroTickSegments);

    // 2. Counter-Tilted Gyroscope Orbital Ring (tilted -28° on X, -16° on Z) - Cyan & Blue
    const gyroGroup2 = new THREE.Group();
    gyroGroup2.rotation.x = THREE.MathUtils.degToRad(-28);
    gyroGroup2.rotation.z = THREE.MathUtils.degToRad(-16);
    reactorGroup.add(gyroGroup2);

    const gyroRing2Radius = 5.35;
    const gyroRing2Geom = new THREE.BufferGeometry().setFromPoints(
      new THREE.EllipseCurve(0, 0, gyroRing2Radius, gyroRing2Radius, 0, Math.PI * 2, false, 0).getPoints(160)
    );
    const gyroRing2Mat = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const gyroRing2 = new THREE.LineLoop(gyroRing2Geom, gyroRing2Mat);
    gyroGroup2.add(gyroRing2);

    // High-speed orbiting beacon spark nodes
    const beaconCount = 6;
    const beaconGeom = new THREE.BufferGeometry();
    const beaconPos = new Float32Array(beaconCount * 3);
    beaconGeom.setAttribute('position', new THREE.BufferAttribute(beaconPos, 3));
    const beaconMat = new THREE.PointsMaterial({
      map: sparkTex,
      color: 0xfffaed,
      size: 0.65,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beaconPoints = new THREE.Points(beaconGeom, beaconMat);
    gyroGroup1.add(beaconPoints);

    // ==========================================
    // D. DENSE CONCENTRIC SCHEMATIC DIALS & 120-BAR EQUALIZER (Image 3)
    // ==========================================
    const telemetryGroup = new THREE.Group();
    reactorGroup.add(telemetryGroup);

    // Concentric Segmented Holographic Arcs (Interweaving Gold & Cyan)
    const arcCount = 4;
    const arcMeshes: THREE.Line[] = [];
    for (let k = 0; k < arcCount; k++) {
      const arcRadius = 3.9 + k * 0.45;
      const arcAngleSpan = (Math.PI * 0.65) / (k + 1);
      const arcGeom = new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(0, 0, arcRadius, arcRadius, 0, arcAngleSpan, false, 0).getPoints(30)
      );
      const arcMat = new THREE.LineBasicMaterial({
        color: k % 2 === 0 ? 0xf59e0b : 0x00f0ff,
        transparent: true,
        opacity: 0.72 - k * 0.1,
        blending: THREE.AdditiveBlending,
      });
      const arcMesh = new THREE.Line(arcGeom, arcMat);
      arcMesh.rotation.z = (k * Math.PI) / 2;
      telemetryGroup.add(arcMesh);
      arcMeshes.push(arcMesh);
    }

    // Live 120-Bar Radial Frequency Spectrum Chronograph Dial (Symmetric Gold ↔ Cyan)
    const dialTicks = 120;
    const tickPositions = new Float32Array(dialTicks * 2 * 3);
    const smoothedTickBins = new Float32Array(dialTicks);

    for (let i = 0; i < dialTicks; i++) {
      const angle = (i / dialTicks) * Math.PI * 2;
      const isMajor = i % 10 === 0;
      const isMid = i % 5 === 0;
      const rInner = 5.95;
      const rOuter = rInner + (isMajor ? 0.38 : isMid ? 0.22 : 0.12);

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
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const dialLineSegments = new THREE.LineSegments(dialLineGeom, dialLineMaterial);
    telemetryGroup.add(dialLineSegments);

    // Outer Time-Domain Oscilloscope Waveform Ribbon (r = 7.4) - Electric Arc Cyan
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
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
    });
    const waveRing = new THREE.LineLoop(waveGeom, waveMat);
    telemetryGroup.add(waveRing);

    // Outer Horizon Boundary with Cardinal Laser Ticks - Deep Arc Blue
    const outerHorizonGeom = new THREE.TorusGeometry(8.9, 0.02, 8, 140);
    const outerHorizonMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    const outerHorizon = new THREE.Mesh(outerHorizonGeom, outerHorizonMat);
    telemetryGroup.add(outerHorizon);

    // ==========================================
    // E. FLOATING AMBIENT STARDUST CONSTELLATION EMBERS (Image 5)
    // Dynamic blend of Gold & Arc Cyan stardust
    // ==========================================
    const stardustCount = 850;
    const stardustGeom = new THREE.BufferGeometry();
    const stardustPositions = new Float32Array(stardustCount * 3);
    const stardustColors = new Float32Array(stardustCount * 3);
    const stardustData: { r: number; theta: number; phi: number; speed: number; pulseSpeed: number }[] = [];

    for (let i = 0; i < stardustCount; i++) {
      const r = 3.2 + Math.random() * 7.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.9;

      stardustPositions[i * 3] = r * Math.cos(theta) * Math.cos(phi);
      stardustPositions[i * 3 + 1] = r * Math.sin(theta) * Math.cos(phi);
      stardustPositions[i * 3 + 2] = r * Math.sin(phi);

      // 55% Amber-Gold, 45% Arc Cyan embers
      const isGold = i % 2 === 0;
      stardustColors[i * 3] = isGold ? 0.98 : 0.0;
      stardustColors[i * 3 + 1] = isGold ? 0.65 : 0.94;
      stardustColors[i * 3 + 2] = isGold ? 0.12 : 1.0;

      stardustData.push({
        r,
        theta,
        phi,
        speed: (0.0004 + Math.random() * 0.0012) * (Math.random() > 0.5 ? 1 : -1),
        pulseSpeed: 1.0 + Math.random() * 2.5,
      });
    }

    stardustGeom.setAttribute('position', new THREE.BufferAttribute(stardustPositions, 3));
    stardustGeom.setAttribute('color', new THREE.BufferAttribute(stardustColors, 3));

    const stardustMat = new THREE.PointsMaterial({
      map: sparkTex,
      vertexColors: true,
      size: 0.3,
      transparent: true,
      opacity: 0.75,
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

    // Click handler on reactor
    const handleCanvasClick = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      onReactorClick?.();
    };
    renderer.domElement.addEventListener('click', handleCanvasClick);

    // ==========================================
    // G. MAIN 60FPS DYNAMIC DUAL-PALETTE ANIMATION LOOP
    // ==========================================
    let animFrameId: number;
    const clock = new THREE.Clock();

    let smoothVol = 0;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothTreble = 0;
    let smoothPitch = 0.25;

    // Palette anchors
    const colorGold = new THREE.Color(0xf59e0b);
    const colorAmber = new THREE.Color(0xd97706);
    const colorCyan = new THREE.Color(0x00f0ff);
    const colorBlue = new THREE.Color(0x0284c7);
    const colorWhite = new THREE.Color(0xfffaed);

    const targetCore = new THREE.Color();
    const targetMid = new THREE.Color();
    const targetRim = new THREE.Color();
    const targetSec = new THREE.Color();

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

      // DYNAMIC COLOR DUAL-PALETTE MODULATION:
      // - LISTENING: Surges into Electric Arc Cyan & Brilliant White with Gold accents
      // - SPEAKING: Surges into Stark Molten Amber-Gold with Cyan telemetry accents
      // - IDLE: Harmonious dual-breathing fusion (Gold rings orbiting a glowing Cyan Arc Core)
      // - PROCESSING: Counter-rotating dual spiral of Gold & Blue
      let pulseMod = 1.0;

      if (currentState === 'listening') {
        // Listening: Electric Arc Cyan dominant (acoustic receptor), with golden telemetry
        pulseMod = 1.25 + smoothVol * 4.8 + smoothBass * 2.5;
        targetCore.setHex(0xffffff);
        targetMid.copy(colorCyan).lerp(colorWhite, smoothVol * 0.7);
        targetRim.copy(colorBlue).lerp(colorGold, smoothPitch * 0.5);
        targetSec.copy(colorGold);
      } else if (currentState === 'speaking') {
        // Speaking: Stark Amber-Gold dominant (AI speech hologram), with Arc Cyan rims
        pulseMod = 1.35 + smoothVol * 4.5 + smoothMid * 2.6;
        targetCore.setHex(0xfffbeb);
        targetMid.copy(colorGold).lerp(new THREE.Color(0xf97316), smoothMid * 0.6);
        targetRim.copy(colorAmber).lerp(colorCyan, smoothTreble * 0.4);
        targetSec.copy(colorCyan);
      } else if (currentState === 'processing') {
        // Processing: Dual alternating spiral
        pulseMod = 1.6 + Math.sin(time * 8) * 0.4;
        const wave = Math.sin(time * 6) * 0.5 + 0.5;
        targetCore.copy(colorWhite);
        targetMid.copy(colorGold).lerp(colorCyan, wave);
        targetRim.copy(colorCyan).lerp(colorAmber, wave);
        targetSec.copy(colorGold);
      } else {
        // Idle: Balanced Dual-Palette Fusion
        // Cyan arc core with warm Stark Gold telemetry rings
        pulseMod = 1.0 + Math.sin(time * 1.2) * 0.05;
        const idleWave = Math.sin(time * 0.8) * 0.5 + 0.5;
        targetCore.copy(colorWhite);
        targetMid.copy(colorGold).lerp(colorCyan, idleWave * 0.35);
        targetRim.copy(colorCyan).lerp(colorAmber, 1.0 - idleWave * 0.35);
        targetSec.copy(colorCyan);
      }

      // 1. Mouse/Touch Gyroscopic Parallax
      const subtleBreathY = Math.sin(time * 0.2) * 0.003;
      const subtleBreathX = Math.cos(time * 0.16) * 0.003;
      masterGroup.rotation.y += (targetTiltY + subtleBreathY - masterGroup.rotation.y) * 0.08;
      masterGroup.rotation.x += (targetTiltX + subtleBreathX - masterGroup.rotation.x) * 0.08;
      masterGroup.position.y = Math.sin(time * 0.4) * 0.035;

      // 2. Mark-VI Triangular Core & Stator Rotation
      const speedMult = currentState === 'processing' ? 3.0 : 1.0;
      triangleGroup.rotation.z += 0.0025 * speedMult + smoothBass * 0.015;
      statorGroup.rotation.z -= 0.0018 * speedMult + smoothMid * 0.012;

      // Pulse triangle and stators on audio
      triLineMat.color.lerp(targetCore, 0.14);
      innerTriMat.color.lerp(targetSec, 0.14);
      triOutline.scale.setScalar(1.0 + smoothBass * 0.22 + smoothVol * 0.15);
      innerTriOutline.scale.setScalar(1.0 + smoothMid * 0.25);

      statorBlocks.forEach((b, idx) => {
        const mat = b.material as THREE.LineBasicMaterial;
        const baseColor = idx % 2 === 0 ? targetMid : targetSec;
        mat.color.lerp(baseColor, 0.14);
        mat.opacity = 0.55 + smoothVol * 0.45 + (idx % 2 === 0 ? smoothTreble * 0.25 : 0);
      });

      // 3. Volumetric Acoustic Plasma Shader Core
      plasmaUniforms.uTime.value = time;
      plasmaUniforms.uAudioPulse.value = smoothVol;
      plasmaUniforms.uBass.value = smoothBass;
      plasmaUniforms.uMid.value = smoothMid;
      plasmaUniforms.uTreble.value = smoothTreble;
      plasmaUniforms.uPitch.value = smoothPitch;
      plasmaUniforms.uColorCore.value.lerp(targetCore, 0.14);
      plasmaUniforms.uColorMid.value.lerp(targetMid, 0.14);
      plasmaUniforms.uColorRim.value.lerp(targetRim, 0.14);
      plasmaUniforms.uColorSecondary.value.lerp(targetSec, 0.14);

      const baseScale = 1.0 + Math.sin(time * 1.5) * 0.018;
      const audioScale = baseScale + smoothBass * 0.55 + smoothVol * 0.45;
      coreContainer.scale.set(audioScale, audioScale, audioScale);

      const spriteScale = 10.5 + smoothVol * 7.0 + smoothBass * 3.5 + Math.sin(time * 2) * 0.15;
      bloomSprite.scale.set(spriteScale, spriteScale, 1);
      bloomSpriteMat.opacity = Math.min(0.95, 0.58 + smoothVol * 0.42);
      bloomSpriteMat.color.lerp(targetMid, 0.14);

      // Dynamic Dual-Color Lighting Intensity
      coreLight.intensity = 5.0 + smoothVol * 15.0;
      pointLightGold.intensity = 2.5 + (currentState === 'speaking' ? smoothVol * 8.0 : smoothVol * 4.0);
      pointLightCyan.intensity = 2.5 + (currentState === 'listening' ? smoothVol * 8.0 : smoothVol * 4.0);
      pointLightGold.color.lerp(targetMid, 0.14);
      pointLightCyan.color.lerp(targetSec, 0.14);

      // 4. Geodesic Wireframe Deformation (Image 2) - Electric Arc Cyan
      geodesicMesh.rotation.y -= 0.0025 * pulseMod;
      geodesicMesh.rotation.x += 0.0015 * smoothMid;
      geodesicMat.color.lerp(targetSec, 0.14);
      geodesicMat.opacity = 0.32 + smoothVol * 0.45;

      const geoPositions = geodesicGeom.attributes.position as THREE.BufferAttribute;
      const geoArr = geoPositions.array as Float32Array;
      const geoLen = geoArr.length / 3;

      for (let i = 0; i < geoLen; i++) {
        const bx = baseGeodesicPos[i * 3];
        const by = baseGeodesicPos[i * 3 + 1];
        const bz = baseGeodesicPos[i * 3 + 2];

        const harmonic = Math.sin(bx * 3.5 + time * 4.0) * Math.cos(by * 3.5 - time * 3.0);
        const disp = 1.0 + harmonic * (smoothBass * 0.28 + smoothMid * 0.18);

        geoArr[i * 3] = bx * disp;
        geoArr[i * 3 + 1] = by * disp;
        geoArr[i * 3 + 2] = bz * disp;
      }
      geoPositions.needsUpdate = true;

      // 5. 3D Acoustic Wave Shell Harmonic Deformation & Dynamic Color Blending
      const shellPositions = waveShellGeom.attributes.position as THREE.BufferAttribute;
      const shellArr = shellPositions.array as Float32Array;
      const shellColorsAttr = waveShellGeom.attributes.color as THREE.BufferAttribute;
      const shellColorsArr = shellColorsAttr.array as Float32Array;

      const freqStride = freqArray && freqArray.length > 0 ? Math.floor(freqArray.length / 32) : 1;
      const isListening = currentState === 'listening';

      for (let i = 0; i < pointCount; i++) {
        const bx = baseWaveShellPos[i * 3];
        const by = baseWaveShellPos[i * 3 + 1];
        const bz = baseWaveShellPos[i * 3 + 2];

        // Map point index to frequency spectrum bin
        const binIdx = freqArray && freqArray.length > 0 ? ((i % 32) * freqStride) % freqArray.length : 0;
        const binVal = freqArray ? freqArray[binIdx] / 255 : 0;

        // Spherical harmonic wave ripples
        const wave1 = Math.sin(bx * 2.2 + time * 3.6) * Math.cos(bz * 2.2 - time * 2.8);
        const wave2 = Math.sin(by * 4.5 - time * 5.2) * Math.cos(bx * 3.8 + time * 4.0);

        let dynamicR: number;
        if (isListening) {
          // Acoustic Ingestion Vortex
          const suckEffect = 0.88 - smoothVol * 0.18;
          const ripple = (wave1 * 0.6 + wave2 * 0.4) * (smoothVol * 0.55 + binVal * 0.35);
          dynamicR = shellBaseR * suckEffect + ripple;
        } else if (currentState === 'speaking') {
          // J.A.R.V.I.S. Voice Projection
          const outwardBlast = 1.0 + smoothVol * 0.42 + smoothBass * 0.35;
          const ripple = (wave1 * 0.7 + wave2 * 0.5) * (smoothMid * 0.6 + binVal * 0.4);
          dynamicR = shellBaseR * outwardBlast + ripple;
        } else {
          // Ambient idle breathing
          const gentleBreath = Math.sin(time * 1.5 + bx * 0.8) * 0.08;
          dynamicR = shellBaseR + gentleBreath;
        }

        const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
        const dirX = bx / len;
        const dirY = by / len;
        const dirZ = bz / len;

        shellArr[i * 3] = dirX * dynamicR;
        shellArr[i * 3 + 1] = dirY * dynamicR;
        shellArr[i * 3 + 2] = dirZ * dynamicR;

        // Dynamic vertex color interpolation (Dual-Color Gold ↔ Cyan wave)
        const lat = Math.abs(dirZ);
        const colorMix = (currentState === 'listening')
          ? 0.75 + lat * 0.25 // More Cyan when listening
          : (currentState === 'speaking')
          ? 0.15 + lat * 0.3 // More Gold when speaking
          : 0.45 + Math.sin(time * 2 + bx) * 0.3; // Dynamic dual wave when idle

        // Lerp between Stark Gold and Arc Cyan
        shellColorsArr[i * 3] = THREE.MathUtils.lerp(0.98, 0.0, colorMix);
        shellColorsArr[i * 3 + 1] = THREE.MathUtils.lerp(0.65, 0.94, colorMix);
        shellColorsArr[i * 3 + 2] = THREE.MathUtils.lerp(0.12, 1.0, colorMix);
      }
      shellPositions.needsUpdate = true;
      shellColorsAttr.needsUpdate = true;

      waveShellMat.size = 0.38 + smoothVol * 0.45 + smoothBass * 0.22;
      waveShellMat.opacity = Math.min(1.0, 0.78 + smoothVol * 0.32);

      // 6. 3D Inclined Celestial Gyroscope Rings (Image 2) - Stark Gold & Arc Cyan
      gyroGroup1.rotation.z += 0.0016 * speedMult + smoothMid * 0.015;
      gyroGroup2.rotation.z -= 0.0012 * speedMult + smoothBass * 0.012;

      gyroRingMat.color.lerp(targetMid, 0.14);
      gyroInnerMat.color.lerp(targetSec, 0.14);
      gyroTickMat.color.lerp(targetMid, 0.14);
      gyroRing2Mat.color.lerp(targetSec, 0.14);

      // Orbiting beacon sparks along inclined track. Each has its own speed, so they drift past
      // one another; kept slow (a lap every ~12-25 s) so the motion stays calm, not distracting.
      const bPosAttr = beaconGeom.attributes.position as THREE.BufferAttribute;
      const bPosArr = bPosAttr.array as Float32Array;
      for (let b = 0; b < beaconCount; b++) {
        const beaconAngle = time * (0.25 + b * 0.05) + (b * Math.PI * 2) / beaconCount;
        bPosArr[b * 3] = Math.cos(beaconAngle) * gyroRingRadius;
        bPosArr[b * 3 + 1] = Math.sin(beaconAngle) * gyroRingRadius;
        bPosArr[b * 3 + 2] = Math.sin(time * 1 + b) * 0.12;
      }
      bPosAttr.needsUpdate = true;
      beaconMat.color.lerp(targetCore, 0.14);

      // 7. Concentric Schematic Arcs & Telemetry (Image 3)
      arcMeshes.forEach((arc, idx) => {
        arc.rotation.z += (idx % 2 === 0 ? 1 : -1) * (0.002 + idx * 0.001) * speedMult + smoothMid * 0.008;
        const mat = arc.material as THREE.LineBasicMaterial;
        const arcTarget = idx % 2 === 0 ? targetMid : targetSec;
        mat.color.lerp(arcTarget, 0.14);
        mat.opacity = 0.65 + smoothVol * 0.35;
      });

      // 8. Live 120-Bar Radial Equalizer Dial (Dynamic Dual Color Lerping)
      dialLineSegments.rotation.z -= 0.0006 * speedMult + smoothBass * 0.016;
      dialLineMaterial.color.lerp(targetMid, 0.14);

      const dialPosAttr = dialLineGeom.attributes.position as THREE.BufferAttribute;
      const dialArr = dialPosAttr.array as Float32Array;
      const numBins = freqArray ? freqArray.length : 0;

      for (let i = 0; i < dialTicks; i++) {
        const angle = (i / dialTicks) * Math.PI * 2;
        const isMajor = i % 10 === 0;
        const isMid = i % 5 === 0;
        const rInner = 5.95;

        // Symmetric frequency spectrum mapping
        const foldedIndex = i < dialTicks / 2 ? i : dialTicks - 1 - i;
        const freqBinIndex = numBins > 0 ? Math.floor((foldedIndex / (dialTicks / 2)) * (numBins * 0.7)) : 0;
        const rawAmp = (freqArray && isActiveAudio) ? freqArray[freqBinIndex] / 255 : 0;

        smoothedTickBins[i] += (rawAmp - smoothedTickBins[i]) * (rawAmp > smoothedTickBins[i] ? 0.45 : 0.16);
        const dynamicAmp = smoothedTickBins[i] * 1.5;

        const baseExtension = isMajor ? 0.38 : isMid ? 0.22 : 0.12;
        const rOuter = rInner + baseExtension + dynamicAmp + smoothVol * 0.4;

        dialArr[i * 6] = Math.cos(angle) * rInner;
        dialArr[i * 6 + 1] = Math.sin(angle) * rInner;
        dialArr[i * 6 + 2] = 0;
        dialArr[i * 6 + 3] = Math.cos(angle) * rOuter;
        dialArr[i * 6 + 4] = Math.sin(angle) * rOuter;
        dialArr[i * 6 + 5] = 0;
      }
      dialPosAttr.needsUpdate = true;

      // 9. Outer Oscilloscope Time-Domain Ribbon - Electric Arc Cyan
      waveRing.rotation.z += 0.0004 * speedMult;
      waveMat.color.lerp(targetSec, 0.14);

      const wavePosAttr = waveGeom.attributes.position as THREE.BufferAttribute;
      const waveArr = wavePosAttr.array as Float32Array;
      const timeLen = timeArray ? timeArray.length : 0;

      for (let i = 0; i < waveSegments; i++) {
        const theta = (i / waveSegments) * Math.PI * 2;
        let ampOffset = 0;

        if (timeArray && isActiveAudio && timeLen > 0) {
          const sampleIdx = Math.floor((i / waveSegments) * timeLen);
          const rawSample = (timeArray[sampleIdx] - 128) / 128;
          ampOffset = rawSample * (0.35 + smoothVol * 0.85);
        } else {
          ampOffset = Math.sin(theta * 6.0 + time * 3.0) * 0.05;
        }

        const r = baseWaveRadius + ampOffset;
        waveArr[i * 3] = Math.cos(theta) * r;
        waveArr[i * 3 + 1] = Math.sin(theta) * r;
        waveArr[i * 3 + 2] = 0;
      }
      wavePosAttr.needsUpdate = true;

      outerHorizonMat.color.lerp(targetRim, 0.14);

      // 10. Ambient Floating Stardust Embers (Image 5)
      stardustCloud.rotation.y += 0.0003;
      stardustCloud.rotation.x = Math.sin(time * 0.05) * 0.05;

      const starPosAttr = stardustGeom.attributes.position as THREE.BufferAttribute;
      const starArr = starPosAttr.array as Float32Array;

      for (let i = 0; i < stardustCount; i++) {
        const d = stardustData[i];
        d.theta += d.speed * (1.0 + smoothVol * 2.0);

        const currentR = d.r + Math.sin(time * d.pulseSpeed + d.phi) * (0.12 + smoothBass * 0.35);
        starArr[i * 3] = currentR * Math.cos(d.theta) * Math.cos(d.phi);
        starArr[i * 3 + 1] = currentR * Math.sin(d.theta) * Math.cos(d.phi);
        starArr[i * 3 + 2] = currentR * Math.sin(d.phi);
      }
      starPosAttr.needsUpdate = true;

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      updateCamera(w, h);
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

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
    />
  );
};
