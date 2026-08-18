"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

/**
 * Animated hero backdrop: the Higgsfield ribbon render on a full-screen quad,
 * gently flowing (noise-driven refraction), breathing (slow zoom), lit by a
 * travelling sheen along the ribbon, and bending softly around the cursor.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  uniform float uTime;
  uniform vec2 uMouse;     // 0..1, y up
  uniform vec2 uRes;       // canvas px
  uniform vec2 uTexRes;    // texture px
  uniform float uAmp;      // flow amplitude
  uniform float uReveal;   // 0..1 fade-in
  uniform float uScroll;   // 0..1 hero scrolled away
  varying vec2 vUv;

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
    // travels along the ribbon's own diagonal so it reads as "flowing"
    float n1 = snoise(uv * 2.0 + vec2(t * 0.11, -t * 0.08));
    float n2 = snoise(uv * 3.2 - vec2(t * 0.08, t * 0.12));
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

    vec3 col = texture2D(uTex, suv).rgb;

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

    gl_FragColor = vec4(col, 1.0);
  }
`;

function Plane({
  mouse,
  scroll,
  amp,
  src,
}: {
  mouse: MutableRefObject<{ x: number; y: number }>;
  scroll: MutableRefObject<number>;
  amp: number;
  src: string;
}) {
  const loaded = useLoader(THREE.TextureLoader, src);
  const { size } = useThree();
  const mat = useRef<THREE.ShaderMaterial>(null!);
  const smooth = useRef(new THREE.Vector2(0.62, 0.55));

  const uniforms = useMemo(() => {
    // Configure a clone so the cached loader texture stays untouched.
    const tex = loaded.clone();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.needsUpdate = true;
    return {
      uTex: { value: tex },
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.62, 0.55) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTexRes: { value: new THREE.Vector2(tex.image.width, tex.image.height) },
      uAmp: { value: amp },
      uReveal: { value: 0 },
      uScroll: { value: 0 },
    };
  }, [loaded, amp]);

  useFrame((state, dt) => {
    const u = mat.current.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uRes.value.set(size.width, size.height);
    // Ease the lens toward the pointer so it feels like heavy glass, not a cursor.
    const sm = smooth.current;
    sm.x = THREE.MathUtils.damp(sm.x, mouse.current.x, 2.2, dt);
    sm.y = THREE.MathUtils.damp(sm.y, mouse.current.y, 2.2, dt);
    u.uMouse.value.copy(sm);
    u.uReveal.value = THREE.MathUtils.damp(u.uReveal.value, 1, 1.4, dt);
    u.uScroll.value = scroll.current;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={VERT} fragmentShader={FRAG} depthTest={false} depthWrite={false} />
    </mesh>
  );
}

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
  /** Stop rendering entirely once the hero has left the viewport. */
  paused?: boolean;
}) {
  return (
    <Canvas
      frameloop={paused ? "never" : "always"}
      dpr={[1, quality > 0.5 ? 1.5 : 1]}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance", depth: false, stencil: false }}
      orthographic
      camera={{ position: [0, 0, 1], zoom: 1 }}
      style={{ background: "#0b0806" }}
    >
      <Suspense fallback={null}>
        <Plane key={src} src={src} mouse={mouse} scroll={scroll} amp={quality > 0.5 ? 0.016 : 0.011} />
      </Suspense>
    </Canvas>
  );
}
