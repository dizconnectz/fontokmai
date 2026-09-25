import { useCallback, useEffect, useRef, useState } from 'react';
import { DataError, loadConfig, loadSnapshot, type RuntimeConfig, type Snapshot } from './data';

export function useData() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<DataError | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const current = useRef<Snapshot | null>(null);
  const settings = useRef<RuntimeConfig | null>(null);
  const flight = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setLoading(true);
    try {
      const nextConfig = settings.current ?? (await loadConfig(window.location.origin));
      if (controller.signal.aborted) return;
      settings.current = nextConfig;
      setConfig(nextConfig);
      const next = await loadSnapshot(
        nextConfig.DATA_BASE_URL,
        current.current,
        fetch,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      current.current = next;
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof DataError ? cause : new DataError('network', 'โหลดข้อมูลไม่สำเร็จ'),
        );
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const resume = () => {
      setNow(Date.now());
      if (!document.hidden) void refresh();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      flight.current?.abort();
      flight.current = null;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  return { snapshot, config, error, loading, now, refresh };
}
