import { useEffect, useRef } from "react";

/**
 * VortexCanvas — the Qronos-style white particle funnel on pure black.
 * A funnel of thin white spiral lines + dots: wide at the top, narrowing to
 * a waist, then spreading into a ripple disc at the bottom. Built from
 * scratch with a 2D canvas (no library, no template code).
 *
 * Motion: requestAnimationFrame spiral. Respects prefers-reduced-motion
 * (renders one static frame). Resize-aware, devicePixelRatio-capped.
 */

interface Arm {
  phase: number;
  speed: number;
  hue: number; // 0..1 brightness variation
}

function radiusProfile(t: number, maxR: number): number {
  // t = 0 (top) → wide; t = 0.55 (waist) → narrow; t = 1 (bottom) → wide.
  const d = Math.abs(t - 0.55) / 0.55;
  return maxR * (0.1 + 0.9 * Math.pow(d, 1.4));
}

export default function VortexCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Spiral arms (the thin curved lines) + dots riding them.
    const ARMS = 26;
    const arms: Arm[] = Array.from({ length: ARMS }, (_, i) => ({
      phase: (i / ARMS) * Math.PI * 2,
      speed: 0.00012 + Math.random() * 0.00008,
      hue: 0.35 + Math.random() * 0.65,
    }));

    // Free dots for the grainy particle feel.
    const DOTS = 420;
    const dots = Array.from({ length: DOTS }, () => ({
      t: Math.random(),
      angle: Math.random() * Math.PI * 2,
      speed: 0.0002 + Math.random() * 0.0006,
      rJitter: 0.85 + Math.random() * 0.3,
      size: 0.6 + Math.random() * 1.1,
      alpha: 0.25 + Math.random() * 0.55,
    }));

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const maxR = Math.min(w * 0.42, 560);
      const horizon = h * 0.94; // where the ripple disc sits

      // — Spiral arms: thin white polylines from top to waist. —
      for (const arm of arms) {
        const twist = now * arm.speed + arm.phase;
        ctx.beginPath();
        const steps = 26;
        for (let s = 0; s <= steps; s++) {
          const t = (s / steps) * 0.62; // arms run top → waist
          const r = radiusProfile(t, maxR);
          const a = twist + t * Math.PI * 3.2;
          const x = cx + Math.cos(a) * r;
          const y = t * h;
          // Fake depth: front (cos > 0) brighter, back dimmer.
          const depth = (Math.cos(a) + 1) / 2;
          const alpha = 0.05 + depth * 0.22 * arm.hue;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          // set stroke per segment is expensive; use a single low alpha.
          void alpha;
        }
        ctx.strokeStyle = `rgba(255,255,255,${0.1 * arm.hue + 0.05})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // — Free dots along the funnel. —
      for (const d of dots) {
        const a = d.angle + now * d.speed;
        const r = radiusProfile(d.t, maxR) * d.rJitter;
        const x = cx + Math.cos(a) * r;
        const y = d.t * h;
        const depth = (Math.cos(a) + 1) / 2;
        ctx.beginPath();
        ctx.arc(x, y, d.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${d.alpha * (0.35 + depth * 0.65)})`;
        ctx.fill();
      }

      // — Ripple disc at the bottom: concentric faint ellipses + dots. —
      const rings = 9;
      for (let i = 1; i <= rings; i++) {
        const rr = (i / rings) * maxR * 1.35;
        ctx.beginPath();
        ctx.ellipse(cx, horizon, rr, rr * 0.16, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.16 - (i / rings) * 0.1})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Dots on the disc.
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2 + now * 0.00005;
        const rr = maxR * (0.25 + ((i * 37) % 100) / 100) * 1.3;
        const x = cx + Math.cos(a) * rr;
        const y = horizon + Math.sin(a) * rr * 0.16;
        ctx.beginPath();
        ctx.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fill();
      }
    };

    if (reduced) {
      draw(0);
    } else {
      const loop = (now: number) => {
        draw(now);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
    />
  );
}
