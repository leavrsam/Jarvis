import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../services/audioEngine';

interface AudioSpectrumMeterProps {
  bars?: number;
  className?: string;
}

export const AudioSpectrumMeter: React.FC<AudioSpectrumMeterProps> = ({
  bars = 24,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const peakCaps = new Float32Array(bars);

    const render = () => {
      animId = requestAnimationFrame(render);
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      const telemetry = audioEngine.getAudioTelemetry();
      const freqData = telemetry.frequencyData;
      const state = audioEngine.getState();
      const pitch = telemetry.spectralCentroid;

      // Map bars across the vocal fundamental & harmonic range (bins 1..42, ~90Hz to ~8,000Hz)
      const vocalBinCount = Math.min(42, freqData.length - 1);
      const barWidth = (width / bars) - 2;

      for (let i = 0; i < bars; i++) {
        let val = 0;
        if (freqData.length > 2) {
          const binIdx = 1 + Math.floor((i / bars) * vocalBinCount);
          const nextBin = Math.min(freqData.length - 1, binIdx + 1);
          val = (freqData[binIdx] * 0.65 + freqData[nextBin] * 0.35);
        }

        // Normalize value (0 to 1) with vocal presence curve
        const normalized = Math.max(0.05, Math.pow(val / 255, 0.85));
        const barHeight = normalized * height;

        // Smooth peak hold with gravity decay
        if (barHeight >= peakCaps[i]) {
          peakCaps[i] = barHeight;
        } else {
          peakCaps[i] = Math.max(2, peakCaps[i] - 0.55);
        }

        const x = i * (barWidth + 2);
        const y = height - barHeight;

        const grad = ctx.createLinearGradient(0, height, 0, 0);
        if (state === 'listening') {
          // Radiant solar-gold with hot white-gold peak
          grad.addColorStop(0, 'rgba(217, 119, 6, 0.45)');
          grad.addColorStop(0.6, 'rgba(251, 191, 36, 0.88)');
          grad.addColorStop(1, 'rgba(255, 255, 255, 1)');
        } else if (state === 'speaking') {
          // Stark molten amber-gold harmonic spectrum
          const warmMix = Math.min(1, (i / bars) * 0.6 + pitch * 0.6);
          grad.addColorStop(0, 'rgba(180, 83, 9, 0.5)');
          grad.addColorStop(0.55, warmMix > 0.4 ? 'rgba(245, 158, 11, 0.9)' : 'rgba(251, 191, 36, 0.9)');
          grad.addColorStop(1, 'rgba(255, 250, 235, 1)');
        } else {
          // Ambient Stark Gold spectrum
          grad.addColorStop(0, 'rgba(180, 83, 9, 0.3)');
          grad.addColorStop(0.6, 'rgba(245, 158, 11, 0.7)');
          grad.addColorStop(1, 'rgba(254, 243, 199, 0.95)');
        }

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Floating peak hold cap
        const capY = Math.max(0, height - peakCaps[i] - 2);
        ctx.fillStyle = state === 'listening' ? '#fde047' : state === 'speaking' ? '#fbbf24' : '#f59e0b';
        ctx.fillRect(x, capY, barWidth, 1.5);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [bars]);

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={36}
      className={`rounded bg-black/40 border border-amber-950/60 ${className}`}
    />
  );
};
