import { useEffect, useRef } from "react";

/** Ambient grid of drifting green points behind the hero, in the spirit of a data-field loop. Cheap 2D canvas. */
export function Particles() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, w = 0, h = 0;
    const pts = Array.from({ length: 90 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, s: 0.02 + Math.random() * 0.05, p: i }));
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      // faint grid
      ctx.strokeStyle = "rgba(0,236,151,0.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 56) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (const p of pts) {
        const yy = ((p.y + (reduce ? 0 : (t / 1000) * p.s * 0.08)) % 1) * h;
        const xx = p.x * w + Math.sin(t / 1400 + p.p) * 4;
        const a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t / 900 + p.p));
        ctx.fillStyle = `rgba(0,236,151,${a})`;
        ctx.shadowColor = "rgba(0,236,151,0.9)";
        ctx.shadowBlur = p.r * 6;
        ctx.beginPath(); ctx.arc(xx, yy, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="particles" aria-hidden />;
}
