"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * Animated hero backdrop: the Higgsfield ribbon render on a full-screen quad,
 * gently flowing (noise-driven refraction), breathing (slow zoom), lit by a
 * travelling sheen along the ribbon, and bending softly around the cursor.
 *
 * Raw WebGL2, not three.js. This is one quad, one draw call and one hand-written
 * shader — three + @react-three/fiber was 890KB raw (234KB gzip, ~47% of the
 * home route's JavaScript) to supply a texture loader, a Vector2 and a damp().
 * The GLSL below is unchanged from the r3f version, and the texture is uploaded
 * as SRGB8_ALPHA8 exactly as `THREE.SRGBColorSpace` did, so sampling still
 * returns linear values and the output is identical.
 */

const VERT = /* glsl */ `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `#version 300 es
  precision highp float;
  uniform sampler2D uTex;
  uniform float uTime;
  uniform vec2 uMouse;     // 0..1, y up
  uniform vec2 uRes;       // canvas px
  uniform vec2 uTexRes;    // texture px
  uniform float uAmp;      // flow amplitude
  uniform float uReveal;   // 0..1 fade-in
  uniform float uScroll;   // 0..1 hero scrolled away
  in vec2 vUv;
  out vec4 fragColor;

#ifndef LOW_Q
  // Simplex 2D noise (Ashima / Ian McEwan) — MIT
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
#endif

  // object-fit: cover, anchored slightly right so the glowing sweep stays in frame.
  vec2 coverUv(vec2 uv) {
    float ra = uRes.x / uRes.y;
    float ta = uTexRes.x / uTexRes.y;
    vec2 s = ra > ta ? vec2(1.0, ta / ra) : vec2(ra / ta, 1.0);
    vec2 anchor = vec2(0.6, 0.5);
    return (uv - anchor) * s + anchor;
  }

  void main() {
    float t = uTime;

    // Breathing zoom + slow drift + scroll parallax
    float zoom = 1.06 + 0.045 * sin(t * 0.22);
    vec2 uv = (vUv - 0.5) / zoom + 0.5;
    uv += vec2(0.018 * sin(t * 0.13), 0.012 * cos(t * 0.17));
    uv.y += uScroll * 0.10;
    uv = coverUv(uv);

    // Flow field — the ribbon drifts in a visible current, plus a wave that
    // travels along the ribbon's own diagonal so it reads as "flowing".
    // The amplitude here is 0.011 on phones, i.e. a sub-pixel displacement, so
    // the low-quality path trades two octaves of simplex noise — the dominant
    // per-pixel cost in the whole shader — for a sine field of the same range.
#ifdef LOW_Q
    float n1 = sin(uv.x * 6.3 + t * 0.41) * cos(uv.y * 5.1 - t * 0.33);
    float n2 = sin(uv.y * 7.7 - t * 0.29) * cos(uv.x * 4.4 + t * 0.37);
#else
    float n1 = snoise(uv * 2.0 + vec2(t * 0.11, -t * 0.08));
    float n2 = snoise(uv * 3.2 - vec2(t * 0.08, t * 0.12));
#endif
    vec2 flow = vec2(n1, n2) * uAmp;
    vec2 along = normalize(vec2(1.0, -1.0));
    float ripple = sin(dot(uv, along) * 14.0 - t * 1.6) * 0.5
                 + sin(dot(uv, along) * 27.0 - t * 2.3) * 0.25;
    flow += along.yx * ripple * uAmp * 0.9;

    // Cursor lens — soft refraction bulge that follows the pointer
    vec2 m = uMouse;
    vec2 d = (vUv - m) * vec2(uRes.x / uRes.y, 1.0);
    float r = length(d);
    float lens = smoothstep(0.5, 0.0, r);
    vec2 refr = -d * lens * 0.07;

    vec2 suv = uv + flow + refr;

    vec3 col = texture(uTex, suv).rgb;

    // Travelling sheens: two soft diagonal bands of light riding the ribbon
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float pos = (vUv.x + vUv.y) * 0.5;
    float band = exp(-pow((pos - fract(t * 0.09)) * 5.5, 2.0))
               + 0.6 * exp(-pow((pos - fract(t * 0.09 + 0.5)) * 8.0, 2.0));
    col += col * band * 0.8 * smoothstep(0.05, 0.5, lum);
    // Slow pulse of the inner glow
    col += col * 0.10 * (0.5 + 0.5 * sin(t * 0.7)) * smoothstep(0.15, 0.6, lum);

    // Cursor warmth — the glass catches a little terracotta light near the pointer
    col += vec3(0.62, 0.30, 0.18) * lens * 0.10 * (0.4 + lum);

    // Vignette + reveal
    float vig = smoothstep(1.25, 0.35, length((vUv - 0.5) * vec2(1.15, 1.0)));
    col *= mix(0.55, 1.0, vig);
    col *= uReveal * (1.0 - uScroll * 0.55);

    fragColor = vec4(col, 1.0);
  }
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("HeroBackdrop shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/** three's MathUtils.damp — frame-rate independent easing toward a target. */
const damp = (a: number, b: number, lambda: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-lambda * dt));

export default function HeroBackdrop({
  mouse,
  scroll,
  quality = 1,
  src = "/art/hero-bg.webp",
  paused = false,
}: {
  mouse: MutableRefObject<{ x: number; y: number }>;
  scroll: MutableRefObject<number>;
  quality?: number;
  /** Backdrop image (object-fit cover, anchored right of centre). */
  src?: string;
  /** Stop rendering entirely — off-screen, or mid scroll gesture. */
  paused?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read inside the loop rather than resubscribing: `paused` flips on every
  // scroll start/stop and must not tear the WebGL context down with it.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const low = quality <= 0.5;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, low ? FRAG.replace("precision highp float;", "precision highp float;\n#define LOW_Q") : FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("HeroBackdrop link:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = {
      tex: gl.getUniformLocation(prog, "uTex"),
      time: gl.getUniformLocation(prog, "uTime"),
      mouse: gl.getUniformLocation(prog, "uMouse"),
      res: gl.getUniformLocation(prog, "uRes"),
      texRes: gl.getUniformLocation(prog, "uTexRes"),
      amp: gl.getUniformLocation(prog, "uAmp"),
      reveal: gl.getUniformLocation(prog, "uReveal"),
      scroll: gl.getUniformLocation(prog, "uScroll"),
    };
    gl.uniform1i(u.tex, 0);
    gl.uniform1f(u.amp, low ? 0.011 : 0.016);

    // SRGB8_ALPHA8 + LINEAR + MIRRORED_REPEAT is exactly what the r3f texture
    // was configured with; NPOT art (2400×1357) is why this needs WebGL2.
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);

    let loaded = false;
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.uniform2f(u.texRes, img.naturalWidth, img.naturalHeight);
      loaded = true;
    };
    img.src = src;

    // r3f clamped devicePixelRatio into [1, max]; phones already sat at 1.
    const dprCap = low ? 1 : 1.5;
    const dpr = Math.min(dprCap, Math.max(1, window.devicePixelRatio || 1));
    let cssW = 1;
    let cssH = 1;
    const resize = () => {
      cssW = Math.max(1, canvas.clientWidth);
      cssH = Math.max(1, canvas.clientHeight);
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // Phones render at 30fps. The fastest term in the shader is the `t * 2.3`
    // ripple at ~0.37Hz, so half the frames still carry it smoothly, and this
    // halves both the fragment work and the compositor's canvas uploads.
    const minFrameMs = low ? 1000 / 30 - 2 : 0;

    let raf = 0;
    let last = performance.now();
    let drawnAt = 0;
    let elapsed = 0;
    let reveal = 0;
    const smooth = { x: 0.62, y: 0.55 };
    let lost = false;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (lost || !loaded || pausedRef.current) {
        last = now;
        return;
      }
      if (now - drawnAt < minFrameMs) return;
      // Clock advances only on rendered frames, so pausing never jumps the
      // animation the way three's shared Clock did on resume.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      drawnAt = now;
      elapsed += dt;

      // Ease the lens toward the pointer so it feels like heavy glass, not a cursor.
      smooth.x = damp(smooth.x, mouse.current.x, 2.2, dt);
      smooth.y = damp(smooth.y, mouse.current.y, 2.2, dt);
      reveal = damp(reveal, 1, 1.4, dt);

      gl.useProgram(prog);
      gl.uniform1f(u.time, elapsed);
      gl.uniform2f(u.mouse, smooth.x, smooth.y);
      gl.uniform2f(u.res, cssW, cssH);
      gl.uniform1f(u.reveal, reveal);
      gl.uniform1f(u.scroll, scroll.current);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);

    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost);
      ro.disconnect();
      img.onload = null;
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [src, quality, mouse, scroll]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ display: "block", width: "100%", height: "100%", background: "#0b0806" }}
    />
  );
}
