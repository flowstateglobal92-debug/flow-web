"use client";

import { useEffect, useRef, useState } from "react";
import { onReveal } from "@/lib/reveal";

/**
 * "FLOW STATE" in the logo's own letterforms, each letter a glass vessel of
 * terracotta liquid with its own level, slosh, waves, caustics and bubbles.
 *
 * One small WebGL canvas, one fragment shader, one draw call. The texture
 * `/brand/wordmark-liquid.png` encodes per pixel: R = letter id, G = local x,
 * B = local y (bottom→top), A = mask — so every letter animates independently
 * without any per-letter DOM. Pauses when off-screen or the tab is hidden.
 * Falls back to a CSS liquid when WebGL is unavailable.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uTilt;
uniform float uFill;   // 0 → 1: pour-in progress (eased)
uniform float uAgit;   // 1 while pouring → 0 at rest: extra turbulence
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i.x + i.y * 57.0), b = hash(i.x + 1.0 + i.y * 57.0);
  float c = hash(i.x + (i.y + 1.0) * 57.0), d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec4 m = texture2D(uTex, vUv);
  float mask = m.a;
  if (mask < 0.004) discard;

  float id = floor(m.r * 255.0 / 20.0 + 0.5);
  float lx = m.g;           // 0..1 across the letter
  float ly = m.b;           // 0 bottom .. 1 top of the letter
  float t = uTime;
  float ph = id * 1.91;     // per-letter phase → independent motion

  // Liquid level: pours in from the bottom on load (uFill), settles ~95% full,
  // then keeps a gentle per-letter slosh. Extra agitation while pouring.
  float pour  = uFill * (0.94 + 0.02 * hash(id * 4.3));      // each letter fills to ~95%
  float rest  = 0.018 * sin(t * 0.75 + ph) + 0.012 * sin(t * 1.7 + ph * 2.3);
  float level = pour + rest * uFill + 0.05 * uAgit * sin(t * 3.2 + ph);
  float tilt  = (0.05 + 0.10 * uAgit) * sin(t * 0.6 + ph * 1.3) + uTilt * (0.6 + 0.4 * hash(id));
  float amp   = 0.55 + 0.9 * uAgit;
  float wave  = amp * (0.030 * sin(lx * 7.0 + t * 2.4 + ph)
              + 0.018 * sin(lx * 13.0 - t * 3.3 + ph * 1.7)
              + 0.022 * (noise(vec2(lx * 4.0 + ph, t * 0.6)) - 0.5));
  float surf = min(level + tilt * (lx - 0.5) + wave, 0.985);
  float d = ly - surf;                       // > 0 above the surface
  float inside = 1.0 - smoothstep(-0.012, 0.012, d);

  // Liquid body: brighter near the surface, deeper terracotta below, moving caustics
  float depth = clamp((surf - ly) / max(surf, 0.001), 0.0, 1.0);
  vec3 top  = vec3(0.99, 0.64, 0.46);
  vec3 mid  = vec3(0.87, 0.43, 0.27);
  vec3 deep = vec3(0.54, 0.21, 0.11);
  vec3 liq = mix(top, mid, smoothstep(0.0, 0.35, depth));
  liq = mix(liq, deep, smoothstep(0.30, 1.0, depth));
  float caust = noise(vec2(lx * 9.0 + t * 0.9 + ph, ly * 6.0 - t * 0.7))
              * noise(vec2(lx * 5.0 - t * 0.6, ly * 9.0 + t * 0.8 + ph));
  liq += vec3(0.85, 0.55, 0.40) * caust * 0.45 * (1.0 - depth * 0.7);

  // Bubbles rising inside each letter
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float sp = 0.09 + 0.06 * hash(id * 7.0 + fk);
    float by = fract(t * sp + hash(id + fk * 3.1));
    float bx = 0.18 + 0.64 * hash(id * 3.7 + fk * 5.3) + 0.03 * sin(t * 3.0 + fk + ph);
    vec2 bp = vec2(bx, by * (surf - 0.03));
    float r = 0.035 + 0.02 * hash(fk + id);
    float dist = length((vec2(lx, ly) - bp) * vec2(1.6, 1.0));
    float ring = smoothstep(r, r * 0.72, dist) - smoothstep(r * 0.7, r * 0.35, dist);
    liq += vec3(1.0, 0.85, 0.75) * ring * 0.55 * inside * step(by, 0.985) * smoothstep(0.15, 0.4, uFill);
  }

  // Empty glass above the liquid: dark tinted, slightly see-through
  vec3 glass = vec3(0.24, 0.12, 0.08) + vec3(0.30, 0.16, 0.11) * (1.0 - ly) * 0.35;
  vec3 col = liq * inside + glass * (1.0 - inside);

  // Meniscus: bright surface line
  float men = exp(-pow(d / 0.018, 2.0));
  col += vec3(1.0, 0.90, 0.82) * men * 0.95;

  // Glass lighting: top specular band, left rim, slow sweep across the word
  col += vec3(1.0, 0.95, 0.90) * 0.26 * smoothstep(0.66, 0.98, ly);
  col += vec3(1.0, 0.90, 0.85) * 0.10 * (1.0 - smoothstep(0.0, 0.14, lx));
  col += 0.14 * exp(-pow((vUv.x - fract(t * 0.07)) * 6.0, 2.0));

  float alpha = mask * mix(0.9, 1.0, inside);
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("LiquidWordmark shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function LiquidWordmark({
  className = "",
  word = "full",
}: {
  className?: string;
  word?: "flow" | "full";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gl, setGl] = useState<"pending" | "on" | "off">("pending");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- capability check, client only
      setGl("off");
      return;
    }
    const ctx = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!ctx) {
      setGl("off");
      return;
    }
    const vs = compile(ctx, ctx.VERTEX_SHADER, VERT);
    const fs = compile(ctx, ctx.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      setGl("off");
      return;
    }
    const prog = ctx.createProgram()!;
    ctx.attachShader(prog, vs);
    ctx.attachShader(prog, fs);
    ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
      setGl("off");
      return;
    }
    ctx.useProgram(prog);

    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
    const aPos = ctx.getAttribLocation(prog, "aPos");
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);
    const uTime = ctx.getUniformLocation(prog, "uTime");
    const uTilt = ctx.getUniformLocation(prog, "uTilt");
    const uFill = ctx.getUniformLocation(prog, "uFill");
    const uAgit = ctx.getUniformLocation(prog, "uAgit");
    // Pour-in: starts shortly after the page is revealed AND the texture is ready.
    const POUR_DELAY = 500;
    const POUR_MS = 5200;
    let pourStart = -1;
    let loadedAt = -1;
    let revealedAt = -1;
    const armPour = () => {
      if (pourStart < 0 && loadedAt >= 0 && revealedAt >= 0) pourStart = Math.max(loadedAt, revealedAt) + POUR_DELAY;
    };
    const offReveal = onReveal(() => {
      revealedAt = performance.now();
      armPour();
    });

    // Data texture (id / local x / local y / mask) — must NOT be premultiplied.
    const tex = ctx.createTexture();
    ctx.bindTexture(ctx.TEXTURE_2D, tex);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, 1, 1, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    let loaded = false;
    const img = new Image();
    img.onload = () => {
      ctx.bindTexture(ctx.TEXTURE_2D, tex);
      ctx.pixelStorei(ctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      ctx.pixelStorei(ctx.UNPACK_COLORSPACE_CONVERSION_WEBGL, ctx.NONE);
      ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true);
      ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, img);
      loaded = true;
      loadedAt = performance.now();
      armPour();
      setGl("on");
    };
    img.onerror = () => setGl("off");
    img.src = word === "flow" ? "/brand/flow-liquid.png" : "/brand/wordmark-liquid.png";

    // Size to the element, capped DPR.
    const dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2);
    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        ctx.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // Pointer → gentle global tilt, eased. A window-level listener, so it is
    // scoped to real cursors: on touch it only ever fired mid-drag, on every
    // page that mounts a wordmark.
    let tiltTarget = 0;
    let tilt = 0;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const onMove = (e: PointerEvent) => {
      tiltTarget = ((e.clientX / window.innerWidth) - 0.5) * 0.18;
    };
    if (!coarse) window.addEventListener("pointermove", onMove, { passive: true });

    // The wordmark sits under three chained drop-shadows, which the browser has
    // to re-run over the canvas on every frame it draws — so on phones half the
    // frames is also half that filter work.
    const minFrameMs = coarse ? 1000 / 30 - 2 : 0;

    let raf = 0;
    let last = performance.now();
    let drawnAt = 0;
    const start = last;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !loaded) return;
      if (now - drawnAt < minFrameMs) return;
      drawnAt = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tilt += (tiltTarget - tilt) * Math.min(1, dt * 2.5);
      const p = pourStart < 0 ? 0 : Math.min(1, Math.max(0, (now - pourStart) / POUR_MS));
      const fill = 1 - Math.pow(1 - p, 2.2); // ease-out: steady pour, gentle finish
      ctx.uniform1f(uTime, (now - start) / 1000);
      ctx.uniform1f(uTilt, tilt);
      ctx.uniform1f(uFill, fill);
      ctx.uniform1f(uAgit, 1 - fill);
      ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
    };

    // Only animate while visible — and stop *scheduling* frames too, rather
    // than waking every 16ms to decide there is nothing to draw.
    const start_ = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver(([en]) => (en.isIntersecting ? start_() : stop()));
    io.observe(canvas);
    start_();

    return () => {
      offReveal();
      stop();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      ctx.deleteTexture(tex);
      ctx.deleteBuffer(buf);
      ctx.deleteProgram(prog);
    };
  }, [word]);

  return (
    <span
      className={`liquid-word ${word === "flow" ? "liquid-word--flow" : ""} ${gl === "on" ? "is-gl" : ""} ${className}`}
      role="img"
      aria-label={word === "flow" ? "flow" : "flow state"}
    >
      {/* CSS fallback (also what shows while the texture loads) */}
      <span className="liquid-word__fluid" aria-hidden>
        <i className="liquid-word__blob liquid-word__blob--1" />
        <i className="liquid-word__blob liquid-word__blob--2" />
        <i className="liquid-word__blob liquid-word__blob--3" />
        <span className="liquid-word__spec" />
      </span>
      <canvas ref={canvasRef} className="liquid-word__gl" aria-hidden />
    </span>
  );
}
