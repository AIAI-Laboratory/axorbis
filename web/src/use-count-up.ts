import { useEffect, useRef, useState } from "react";

export function useCountUp(value: number | null, duration = 480) {
  const [display, setDisplay] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const target = value ?? 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target === current.current) {
      current.current = target;
      setDisplay(target);
      return;
    }

    const start = current.current;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(start + (target - start) * eased);
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, value]);

  return display;
}
