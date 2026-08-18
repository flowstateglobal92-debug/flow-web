/**
 * Fluid inside the preloader's glass tube — one small WebGL canvas laid over
 * the tube's bounding box. The liquid advances left → right (fill 0..1) with a
 * wavy front, a sloshing top surface, drifting caustics, bubbles carried by the
 * flow and a bright meniscus — the same visual family as the hero's liquid
 * wordmark. Returns a controller, or null when WebGL is unavailable.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uFill;   // 0..1 along the tube
uniform float uAgit;   // extra turbulence while advancing
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i.x + i.y * 57.0), b = hash(i.x + 1.0 + i.y * 57.0);
  float c = hash(i.x + (i.y + 1.0) * 57.0), d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// signed distance to a horizontal capsule spanning the canvas (radius = half height)
float sdCapsule(vec2 q, float len) {
  vec2 a = vec2(0.5, 0.5), b = vec2(len - 0.5, 0.5);
  vec2 pa = q - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - 0.5;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2(vUv.x * aspect, vUv.y);   // x in tube-height units, y 0..1
  float px = 1.0 / uRes.y;
  float t = uTime;

  // glass capsule mask — the liquid never leaves the tube
  float sd = sdCapsule(q, aspect) + 1.5 * px;
  float mask = 1.0 - smoothstep(-1.5 * px, 1.5 * px, sd);
  if (mask < 0.003) discard;

  // top surface: a sloshing level along the tube
  float lvl = 0.80
    + 0.035 * sin(q.x * 2.6 - t * 1.6)
    + 0.02 * sin(q.x * 5.1 + t * 2.3)
    + 0.03 * (noise(vec2(q.x * 1.6 - t * 0.9, t * 0.4)) - 0.5)
    + 0.05 * uAgit * sin(q.x * 4.0 - t * 5.0);

  // advancing front: a wavy vertical edge that leads at the bottom and curls at the top
  float frontX = uFill * aspect;
  float wave = 0.07 * sin(q.y * 14.0 + t * 5.0)
             + 0.05 * (noise(vec2(q.y * 3.0, t * 1.4)) - 0.5)
             + 0.10 * uAgit * (noise(vec2(q.y * 5.0 + 3.0, t * 2.2)) - 0.5)
             + 0.06 * (1.0 - q.y);
  float dxFront = frontX + wave - q.x;         // > 0 inside the liquid
  float inX = smoothstep(-2.0 * px, 2.0 * px, dxFront);
  float dyTop = lvl - q.y;                     // > 0 below the surface
  float inY = smoothstep(-2.0 * px, 2.0 * px, dyTop);
  float inside = inX * inY * mask;

  // body: bright near the surface, deeper terracotta below, drifting caustics
  float depth = clamp(dyTop / max(lvl, 0.001), 0.0, 1.0);
  vec3 top  = vec3(0.99, 0.66, 0.48);
  vec3 mid  = vec3(0.86, 0.42, 0.26);
  vec3 deep = vec3(0.52, 0.20, 0.10);
  vec3 liq = mix(top, mid, smoothstep(0.0, 0.35, depth));
  liq = mix(liq, deep, smoothstep(0.30, 1.0, depth));
  float caust = noise(vec2(q.x * 3.0 - t * 1.4, q.y * 6.0 + t * 0.6))
              * noise(vec2(q.x * 5.0 - t * 0.9 + 7.0, q.y * 9.0 - t * 0.7));
  liq += vec3(0.9, 0.6, 0.45) * caust * 0.5 * (1.0 - depth * 0.6);

  // bubbles carried along by the flow, rising slowly
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    float sp = 0.25 + 0.2 * hash(fk * 3.7);
    float span = max(frontX - 0.4, 0.5);
    float bx = mod(hash(fk * 1.3) * aspect + t * sp, span) + 0.25;
    float by = 0.12 + 0.6 * fract(hash(fk * 2.1) + t * (0.05 + 0.04 * hash(fk)));
    by = min(by, lvl - 0.06);
    float r = 0.035 + 0.03 * hash(fk + 9.0);
    float dist = length(q - vec2(bx, by));
    float ring = smoothstep(r, r * 0.7, dist) - smoothstep(r * 0.68, r * 0.35, dist);
    liq += vec3(1.0, 0.86, 0.76) * ring * 0.5 * step(bx, frontX - 0.15);
  }

  vec3 col = liq;
  // meniscus / foam at the advancing front and along the surface
  float front = exp(-pow(dxFront / 0.05, 2.0)) * inY;
  float surf = exp(-pow(dyTop / 0.03, 2.0)) * inX;
  col += vec3(1.0, 0.92, 0.84) * (front * 0.9 + surf * 0.7);
  col += vec3(0.98, 0.72, 0.55) * smoothstep(0.5, 0.0, dxFront) * inY * 0.25;
  // soft specular band just under the surface (light through the glass)
  col += vec3(1.0, 0.95, 0.9) * 0.16 * smoothstep(0.42, 0.62, q.y) * (1.0 - smoothstep(0.62, 0.78, q.y));

  float alpha = clamp(inside + (front + surf) * 0.6 * mask, 0.0, 1.0);
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied
}
`;

export type TubeLiquid = {
  /** Pull-based: the render loop reads the current fill/agitation every frame. */
  setSource(fn: () => { fill: number; agit: number }): void;
  destroy(): void;
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("tubeLiquid shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * One controller per canvas. React's dev double-mount would otherwise leave a
 * ghost render loop drawing stale frames over the live one (same canvas = same
 * WebGL context), so any previous instance is destroyed first.
 */
const instances = new WeakMap<HTMLCanvasElement, TubeLiquid>();

export function createTubeLiquid(canvas: HTMLCanvasElement): TubeLiquid | null {
  instances.get(canvas)?.destroy();
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uFill = gl.getUniformLocation(prog, "uFill");
  const uAgit = gl.getUniformLocation(prog, "uAgit");

  let source: () => { fill: number; agit: number } = () => ({
    fill: 0,
    agit: 0,
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let raf = 0;
  const start = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const { fill, agit } = source();
    gl.useProgram(prog);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform1f(uFill, fill);
    gl.uniform1f(uAgit, agit);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  raf = requestAnimationFrame(frame);

  const controller: TubeLiquid = {
    setSource: (fn) => {
      source = fn;
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      if (instances.get(canvas) === controller) instances.delete(canvas);
    },
  };
  instances.set(canvas, controller);
  return controller;
}
