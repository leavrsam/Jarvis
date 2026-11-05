import { useState, useEffect } from 'react';

export interface BatteryStatus {
  isSupported: boolean;
  charging: boolean;
  level: number; // 0 to 1
  chargingTime: number;
  dischargingTime: number;
}

interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  onchargingchange: ((this: BatteryManager, ev: Event) => void) | null;
  onlevelchange: ((this: BatteryManager, ev: Event) => void) | null;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManager>;
}

export function useBatteryStatus(): BatteryStatus {
  const [battery, setBattery] = useState<BatteryStatus>({
    isSupported: false,
    charging: true, // Default to true so wake-word works if API is unavailable
    level: 1.0,
    chargingTime: 0,
    dischargingTime: Infinity,
  });

  useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== 'function') {
      return;
    }

    let batteryManager: BatteryManager | null = null;

    const updateBattery = () => {
      if (!batteryManager) return;
      setBattery({
        isSupported: true,
        charging: batteryManager.charging,
        level: batteryManager.level,
        chargingTime: batteryManager.chargingTime,
        dischargingTime: batteryManager.dischargingTime,
      });
    };

    nav.getBattery()
      .then((bm) => {
        batteryManager = bm;
        updateBattery();
        bm.addEventListener('chargingchange', updateBattery);
        bm.addEventListener('levelchange', updateBattery);
      })
      .catch((err) => {
        console.warn('[useBatteryStatus] Error querying battery manager:', err);
      });

    return () => {
      if (batteryManager) {
        batteryManager.removeEventListener('chargingchange', updateBattery);
        batteryManager.removeEventListener('levelchange', updateBattery);
      }
    };
  }, []);

  return battery;
}
