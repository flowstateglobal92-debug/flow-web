/**
 * The intro's liquid — one full-viewport WebGL canvas. A mass of terracotta
 * surges down from the top edge (`front` 0→1), floods the screen, then its
 * top surface lets go and the whole body drains off the bottom (`top` 0→1),
 * uncovering the hero. Wavy, dripping leading edge; bright meniscus; drifting
 * caustics; a few bubbles — the same visual family as the hero's liquid
 * wordmark, so it reads as the same liquid at a different scale.
 * Returns a controller, or null when WebGL is unavailable.
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
uniform float uFront;  // 0..1: how far down the leading edge has surged
uniform float uTop;    // 0..1: how far down the trailing (top) surface has drained
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
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2(vUv.x * aspect, 1.0 - vUv.y);   // x in height units, y = distance from top (0..1)
  float px = 1.0 / uRes.y;
  float t = uTime;

  // Leading edge: broad swells plus thin finger-like drips running ahead of it.
  float swell = 0.06 * sin(q.x * 3.1 + t * 2.2)
              + 0.04 * sin(q.x * 6.7 - t * 3.1)
              + 0.05 * (noise(vec2(q.x * 2.2, t * 0.8)) - 0.5);
  float fingers = 0.22 * pow(noise(vec2(q.x * 6.5 + 2.0, t * 0.5)), 5.0)
                + 0.12 * pow(noise(vec2(q.x * 13.0 + 9.0, t * 0.9)), 6.0);
  float frontY = uFront * 1.34 - 0.14 + swell + fingers;
  float dFront = frontY - q.y;                  // > 0 inside (above the leading edge)

  // Trailing surface while draining: calmer, with drips left hanging off it.
  float tail = 0.05 * sin(q.x * 2.4 - t * 1.7)
             + 0.03 * (noise(vec2(q.x * 3.0 + 5.0, t * 0.6)) - 0.5)
             - 0.18 * pow(noise(vec2(q.x * 8.0 + 4.0, t * 0.4)), 4.0);
  float topY = uTop * 1.30 - 0.16 + tail;
  float dTop = q.y - topY;                      // > 0 inside (below the trailing surface)

  // Cheap reject before any of the expensive shading below: anything well
  // outside the liquid on either surface contributes nothing. During the surge
  // and the drain this skips the majority of the screen.
  if (dFront < -0.04 || dTop < -0.04) discard;

  float inFront = smoothstep(-1.5 * px, 1.5 * px, dFront);
  float inTop = smoothstep(-1.5 * px, 1.5 * px, dTop);
  float inside = inFront * inTop;

  // Body: bright at the leading edge easing back into deep terracotta. The
  // falloff is deliberately broad — a fast one collapses the whole screen to a
  // flat wash once the liquid has covered it.
  // Two ramps, keyed to distance from the leading edge rather than to a single
  // normalised depth: a fast one so even a thin surging band already reads
  // terracotta instead of cream, then a slow one into the depths so the frame
  // still has range once the liquid covers it.
  float depth = clamp(dFront / 0.9, 0.0, 1.0);
  vec3 edgeC = vec3(0.99, 0.66, 0.48);
  vec3 midC  = vec3(0.86, 0.42, 0.26);
  vec3 deepC = vec3(0.50, 0.19, 0.10);
  vec3 liq = mix(edgeC, midC, smoothstep(0.0, 0.075, dFront));
  liq = mix(liq, deepC, smoothstep(0.18, 0.95, dFront));

  // Everything below keeps moving after the liquid has covered the frame, so
  // the hold still reads as flowing liquid rather than a painted background.
  // Two layers of caustics at different scales and speeds.
  float caust = noise(vec2(q.x * 2.4 + t * 0.7, q.y * 3.2 - t * 1.6))
              * noise(vec2(q.x * 4.1 - t * 0.5 + 7.0, q.y * 5.5 - t * 1.1));
  liq += vec3(0.95, 0.62, 0.46) * caust * 0.62 * (1.0 - depth * 0.5);
  // Slow large-scale churn — the body turning over on itself.
  float churn = noise(vec2(q.x * 1.3 - t * 0.35, q.y * 1.1 + t * 0.5)) - 0.5;
  liq += vec3(0.92, 0.55, 0.38) * churn * 0.30;
  // Vertical streaks pulled along by the flow.
  float streak = noise(vec2(q.x * 9.0, q.y * 1.5 - t * 2.4));
  liq += vec3(0.95, 0.62, 0.45) * 0.14 * streak * (1.0 - depth * 0.6);

  // Bubbles carried along with the flow.
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    float bx = mod(hash(fk * 1.3) * aspect + 0.15 * sin(t * (0.6 + hash(fk)) + fk), aspect);
    float by = fract(hash(fk * 2.1) + t * (0.10 + 0.08 * hash(fk * 5.0)));
    float r = 0.012 + 0.014 * hash(fk + 9.0);
    float dist = length(q - vec2(bx, by));
    float ring = smoothstep(r, r * 0.7, dist) - smoothstep(r * 0.68, r * 0.35, dist);
    liq += vec3(1.0, 0.86, 0.76) * ring * 0.45 * step(0.06, dFront) * step(0.04, dTop);
  }

  // A gentle pool behind the centre so the mark keeps its contrast — light
  // enough that it does not flatten the liquid around it.
  vec2 c = vec2(aspect * 0.5, 0.5);
  liq *= 1.0 - 0.16 * (1.0 - smoothstep(0.05, 0.55, length((q - c) * vec2(0.85, 1.0))));

  vec3 col = liq;
  // Meniscus / foam along both surfaces, with a warm halo behind the lip.
  float frontGlow = exp(-pow(dFront / 0.020, 2.0)) * inTop;
  float topGlow = exp(-pow(dTop / 0.018, 2.0)) * inFront;
  col += vec3(1.0, 0.92, 0.84) * (frontGlow * 0.8 + topGlow * 0.7);
  col += vec3(0.98, 0.72, 0.55) * smoothstep(0.22, 0.0, dFront) * inTop * 0.18;
  // Wet sheen just behind the trailing surface as it drains.
  col += vec3(1.0, 0.95, 0.9) * 0.12 * smoothstep(0.0, 0.09, dTop) * (1.0 - smoothstep(0.09, 0.26, dTop)) * inFront;

  float alpha = clamp(inside + (frontGlow + topGlow) * 0.55, 0.0, 1.0);
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied
}
`;

export type PourLiquid = {
  /** Pull-based: the render loop reads the current front/top every frame. */
  setSource(fn: () => { front: number; top: number }): void;
  destroy(): void;
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("pourLiquid shader:", gl.getShaderInfoLog(sh));
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
const instances = new WeakMap<HTMLCanvasElement, PourLiquid>();

export function createPourLiquid(canvas: HTMLCanvasElement): PourLiquid | null {
  instances.get(canvas)?.destroy();
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "default",
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
  const uFront = gl.getUniformLocation(prog, "uFront");
  const uTop = gl.getUniformLocation(prog, "uTop");

  let source: () => { front: number; top: number } = () => ({
    front: 0,
    top: 0,
  });
  // Full-viewport fragment work, so resolution is the dominant cost — but the
  // caustics and bubbles are the whole point of the effect, and undersampling
  // mushes them. The early discard in the shader buys back the headroom.
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
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
    const { front, top } = source();
    gl.useProgram(prog);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform1f(uFront, front);
    gl.uniform1f(uTop, top);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  raf = requestAnimationFrame(frame);

  const controller: PourLiquid = {
    setSource: (fn) => {
      source = fn;
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // NB: do NOT call WEBGL_lose_context here. The canvas element outlives a
      // controller (React re-runs effects on the same node, and the dev-mode
      // double-mount does it on every load); a context killed that way stays
      // dead, so the next createPourLiquid gets a lost context back from
      // getContext and silently renders nothing. The GPU memory is released
      // when the canvas itself is collected, moments later, on unmount.
      if (instances.get(canvas) === controller) instances.delete(canvas);
    },
  };
  instances.set(canvas, controller);
  return controller;
}
