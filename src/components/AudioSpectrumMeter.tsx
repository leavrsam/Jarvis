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

    const render = () => {
      animId = requestAnimationFrame(render);
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      const telemetry = audioEngine.getAudioTelemetry();
      const freqData = telemetry.frequencyData;
      const step = Math.floor((freqData.length / 2) / bars);

      const barWidth = (width / bars) - 2;

      for (let i = 0; i < bars; i++) {
        let val = 0;
        if (freqData.length > 0) {
          val = freqData[i * step] || 0;
        }

        // Normalize value (0 to 1)
        const normalized = Math.max(0.04, val / 255);
        const barHeight = normalized * height;

        const x = i * (barWidth + 2);
        const y = height - barHeight;

        // Futuristic cyan/blue gradient
        const grad = ctx.createLinearGradient(0, height, 0, 0);
        grad.addColorStop(0, 'rgba(0, 120, 255, 0.4)');
        grad.addColorStop(0.6, 'rgba(0, 240, 255, 0.8)');
        grad.addColorStop(1, 'rgba(224, 255, 255, 1)');

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Peak cap
        ctx.fillStyle = '#e0ffff';
        ctx.fillRect(x, Math.max(0, y - 2), barWidth, 1.5);
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
      className={`rounded bg-black/40 border border-cyan-950/60 ${className}`}
    />
  );
};
