import { useEffect, useRef } from "react";

/**
 * A small cluster of 3D coins (NEAR, USDC, ETH, SOL, BTC) drifting and spinning.
 * three.js is loaded lazily so the dashboard data never waits on it; honours
 * prefers-reduced-motion (static pose) and pauses when the tab is hidden.
 */
export function Coins3D({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let dispose = () => {};
    let cancelled = false;
    (async () => {
      const THREE = await import("three");
      if (cancelled) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0, 0.6, 11);

      scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(4, 6, 6);
      scene.add(key);
      const green = new THREE.PointLight(0x00ec97, 40, 30, 2);
      green.position.set(-5, -2, 4);
      scene.add(green);
      const rim = new THREE.DirectionalLight(0x9bffd9, 1.2);
      rim.position.set(-6, 3, -4);
      scene.add(rim);

      const faceTexture = (symbol: string, fg: string, bg: string, draw: (c: CanvasRenderingContext2D, s: number) => void) => {
        const s = 512;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = s;
        const c = canvas.getContext("2d")!;
        const g = c.createRadialGradient(s * 0.35, s * 0.3, s * 0.1, s / 2, s / 2, s * 0.6);
        g.addColorStop(0, bg);
        g.addColorStop(1, shade(bg, -0.35));
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
        c.strokeStyle = "rgba(255,255,255,0.25)";
        c.lineWidth = s * 0.02;
        c.beginPath();
        c.arc(s / 2, s / 2, s * 0.45, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = fg;
        c.strokeStyle = fg;
        draw(c, s);
        const t = new THREE.CanvasTexture(canvas);
        // Cylinder caps map UVs a quarter-turn off; rotate so symbols read upright.
        t.center.set(0.5, 0.5);
        t.rotation = Math.PI / 2;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        (t as any).userData = { symbol };
        return t;
      };
      const text = (label: string, size = 0.42) => (c: CanvasRenderingContext2D, s: number) => {
        c.font = `700 ${s * size}px "Inter Tight Variable", Inter, system-ui, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(label, s / 2, s / 2 + s * 0.02);
      };
      // NEAR mark: two uprights joined by a diagonal.
      const nearMark = (c: CanvasRenderingContext2D, s: number) => {
        const w = s * 0.085, x0 = s * 0.3, x1 = s * 0.7 - w, y0 = s * 0.3, y1 = s * 0.7;
        c.fillRect(x0, y0, w, y1 - y0);
        c.fillRect(x1, y0, w, y1 - y0);
        c.lineWidth = w * 0.9;
        c.lineCap = "butt";
        c.beginPath();
        c.moveTo(x0 + w / 2, y0 + w * 0.3);
        c.lineTo(x1 + w / 2, y1 - w * 0.3);
        c.stroke();
      };
      const defs = [
        { tex: faceTexture("NEAR", "#00ec97", "#0f1512", nearMark), r: 1.25, pos: [0.2, 0.4, 0], tilt: 0.35 },
        { tex: faceTexture("USDC", "#ffffff", "#2775ca", text("$", 0.5)), r: 0.95, pos: [-2.6, 1.6, -1.5], tilt: -0.4 },
        { tex: faceTexture("ETH", "#ffffff", "#454a75", text("Ξ", 0.5)), r: 0.8, pos: [2.9, 1.9, -2], tilt: 0.6 },
        { tex: faceTexture("SOL", "#0b0d0b", "#14f195", text("S", 0.46)), r: 0.75, pos: [-2.4, -1.7, -0.8], tilt: 0.2 },
        { tex: faceTexture("BTC", "#ffffff", "#f7931a", text("₿", 0.5)), r: 0.85, pos: [2.6, -1.5, -0.6], tilt: -0.25 },
      ];
      const coins = defs.map((d, i) => {
        const edge = new THREE.MeshPhysicalMaterial({ color: 0xd9d9d4, metalness: 0.9, roughness: 0.35, clearcoat: 0.6 });
        const face = new THREE.MeshPhysicalMaterial({ map: d.tex, metalness: 0.55, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
        const geo = new THREE.CylinderGeometry(d.r, d.r, d.r * 0.16, 72, 1, false);
        const mesh = new THREE.Mesh(geo, [edge, face, face]);
        mesh.rotation.x = Math.PI / 2; // cap faces the camera
        // The group tumbles around the vertical axis (edge catches the light), like a coin being flipped slowly.
        const group = new THREE.Group();
        group.add(mesh);
        group.position.set(d.pos[0], d.pos[1], d.pos[2]);
        group.rotation.z = d.tilt * 0.4;
        group.userData = { base: [...d.pos], phase: i * 1.3, speed: 0.35 + i * 0.06, tilt: d.tilt };
        scene.add(group);
        return group;
      });

      const resize = () => {
        const w = host.clientWidth || 600, h = host.clientHeight || 420;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      let raf = 0, t0 = performance.now(), running = true;
      const frame = (now: number) => {
        if (!running) return;
        const t = (now - t0) / 1000;
        coins.forEach((g) => {
          const { base, phase, speed, tilt } = g.userData as any;
          g.position.y = base[1] + Math.sin(t * 0.8 + phase) * 0.18;
          g.rotation.y = Math.sin(t * speed + phase) * 0.75 + tilt;
          g.rotation.x = Math.sin(t * 0.45 + phase) * 0.18;
        });
        renderer.render(scene, camera);
        if (!reduce) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      const onVis = () => {
        if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!running) { running = true; t0 = performance.now() - 1; raf = requestAnimationFrame(frame); }
      };
      document.addEventListener("visibilitychange", onVis);
      dispose = () => {
        running = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        coins.forEach((g) => g.traverse((o: any) => { if (o.isMesh) { o.geometry.dispose(); (o.material as any[]).forEach((x) => { x.map?.dispose(); x.dispose(); }); } }));
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch(() => {/* WebGL unavailable: the hero simply shows without coins */});
    return () => { cancelled = true; dispose(); };
  }, []);
  return <div ref={ref} className={className} aria-hidden />;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
