/** Shared GLSL: hashing, value noise, fbm, tone mapping. */
export const NOISE = /* glsl */ `
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float v = 0.; float a = .5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return v; }
float fbm4(vec3 p){ float v = 0.; float a = .5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return v; }
float ridged(vec3 p){ float v = 0.; float a = .5; for (int i = 0; i < 5; i++){ float n = 1. - abs(vnoise(p) * 2. - 1.); v += a * n * n; p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= .5; } return v; }
vec3 tonemap(vec3 c){ return 1. - exp(-c); }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

/** A glowing sphere with turbulent surface and corona. */
export const STAR_FS = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec2 uC; uniform float uR; uniform vec3 uCol; uniform float uI; uniform float uCorona; uniform float uSeed; uniform float uTurb;
${NOISE}
void main(){
  vec2 p = (gl_FragCoord.xy - uC * uRes) / uRes.y;
  float r = length(p) / uR;
  vec3 col = vec3(0.);
  if (r < 1.) {
    float z = sqrt(1. - r * r);
    vec3 n = vec3(p / uR, z);
    n.xz = rot2(uTime * .04) * n.xz;
    float g = fbm3(n * 4. + uSeed + vec3(0., 0., uTime * .05));
    float g2 = fbm4(n * 14. + uSeed * 2. + vec3(uTime * .25, 0., 0.));
    float gran = .45 + .7 * g + .45 * g2 * uTurb;
    float limb = pow(z, .55);
    vec3 c = uCol * gran * (.35 + .9 * limb);
    c += vec3(1.) * pow(max(g2 - .5, 0.), 2.) * 3. * limb * uTurb;
    c += vec3(1., .95, .9) * pow(limb, 3.) * .35;
    col = c * uI * 1.6;
  }
  float d = max(r - 1., 0.);
  float ang = atan(p.y, p.x);
  float streak = fbm4(vec3(cos(ang) * 2.5, sin(ang) * 2.5, d * 1.5 - uTime * .15 + uSeed));
  float glow = exp(-d * 9.) * 1.2 + exp(-d * 2.2) * .4 * (.4 + streak) + exp(-d * .6) * .08;
  col += uCol * glow * uCorona * uI * (r > 1. ? 1. : .5);
  gl_FragColor = vec4(tonemap(col), 1.);
}`;

/** Expanding filamentary shell: supernova remnant / nebula. */
export const NEBULA_FS = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec2 uC; uniform float uR; uniform float uW; uniform float uI; uniform vec3 uColA; uniform vec3 uColB; uniform float uSeed; uniform float uCore; uniform float uFill;
${NOISE}
void main(){
  vec2 p = (gl_FragCoord.xy - uC * uRes) / uRes.y;
  float d = length(p) / max(uR, 1e-3);
  vec3 q = vec3(p / max(uR, 1e-3) * 1.6, uSeed + uTime * .02);
  float n = fbm3(q * 1.7 + 3.);
  float f = ridged(q * 2.2 + vec3(n * 1.4));
  float shell = exp(-pow((d - 1. + .25 * (n - .5)) / uW, 2.));
  float inner = smoothstep(1.05, .1, d) * uFill;
  float dens = (shell * (.25 + 2.2 * f * f) + inner * (.15 + 1.2 * f * f)) * (.5 + .9 * n);
  vec3 col = mix(uColB, uColA, smoothstep(.55, 1.1, d + .3 * (n - .5))) * dens * uI;
  col += vec3(1., .95, .9) * exp(-length(p) / (.004 + uR * .06)) * uCore;
  gl_FragColor = vec4(tonemap(col), 1.);
}`;

/** Black dwarf: a cold, dark sphere that can dissolve (proton decay). */
export const DWARF_FS = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec2 uC; uniform float uR; uniform float uDissolve; uniform float uRim; uniform float uI;
${NOISE}
void main(){
  vec2 p = (gl_FragCoord.xy - uC * uRes) / uRes.y;
  float r = length(p) / uR;
  vec3 col = vec3(0.);
  if (r < 1.) {
    float z = sqrt(1. - r * r);
    vec3 n = vec3(p / uR, z);
    vec3 m = n; m.xz = rot2(uTime * .03) * m.xz;
    float tex = fbm3(m * 5.);
    vec3 L = normalize(vec3(-.6, .5, .6));
    float diff = max(dot(n, L), 0.);
    col = vec3(.018, .022, .03) * (.6 + tex) + vec3(.05, .06, .08) * diff * (.5 + tex);
    col += pow(1. - z, 3.5) * vec3(.25, .4, .8) * uRim;
    float k = fbm3(m * 3.2 + 7.) + .22 * fbm4(m * 13.);
    float thr = mix(.3, .82, uDissolve) + step(.999, uDissolve);
    if (k < thr) {
      col = vec3(0.);
    } else {
      float e = smoothstep(thr + .09, thr, k) * step(.001, uDissolve);
      vec3 ec = mix(vec3(.2, .8, 1.), vec3(1., .3, .8), vnoise(m * 9. + uTime));
      col += ec * e * 3.5 + vec3(1.) * pow(e, 6.) * 3.;
    }
  }
  gl_FragColor = vec4(tonemap(col * uI), 1.);
}`;

/** Milky Way band for the final night sky. */
export const MILKYWAY_FS = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uI;
${NOISE}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes.y;
  vec2 c = vec2(.5 * uRes.x / uRes.y, .5);
  vec2 p = uv - c;
  p = rot2(-.55) * p;
  float bend = .08 * p.x * p.x;
  float t = p.y - bend;
  float s = p.x;
  float w = .13 + .05 * fbm4(vec3(s * 2., 1., 3.));
  float band = exp(-t * t / (w * w));
  float clouds = fbm3(vec3(s * 3.5, t * 7., 1.3));
  float fine = fbm4(vec3(s * 14., t * 22., 4.));
  float core = exp(-pow((s + .35) / .45, 2.));
  float dens = band * (.25 + 1.2 * clouds * clouds + .5 * fine) * (.6 + 1.3 * core);
  float dust = smoothstep(.45, .75, ridged(vec3(s * 4., t * 10., 9.))) * exp(-t * t / (w * w * .25));
  dens *= 1. - .85 * dust;
  vec3 col = mix(vec3(.35, .45, .75), vec3(1., .78, .5), core * .9) * dens;
  col += vec3(.9, .4, .5) * pow(fine, 3.) * band * .6;
  float air = smoothstep(.45, .0, uv.y);
  col += vec3(.04, .1, .12) * air;
  gl_FragColor = vec4(tonemap(col * uI * .9), 1.);
}`;

/**
 * Ray-traced Schwarzschild black hole with a thin accretion disk.
 * Photon paths bend with the classic d²x/dt² = -1.5·h²·x/r⁵ (units of Rs = 1),
 * so the shadow, photon ring and lensed disk image all fall out of the integration.
 */
export const BLACKHOLE_FS = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform float uRs; uniform float uDisk; uniform float uHawk; uniform vec3 uHawkCol;
uniform float uCamDist; uniform float uTilt; uniform float uYaw; uniform float uBg; uniform float uFlash; uniform float uRoll;
${NOISE}
vec3 background(vec3 d){
  vec3 col = vec3(0.);
  for (int L = 0; L < 2; L++) {
    float K = L == 0 ? 70. : 170.;
    float th = L == 0 ? .955 : .92;
    vec3 q = d * K; vec3 id = floor(q); vec3 f = fract(q) - .5;
    float h = hash13(id + float(L) * 17.);
    if (h > th) {
      vec3 o = (hash33(id) - .5) * .5;
      vec3 e = f - o;
      float s = exp(-dot(e, e) * 160.);
      float b = (h - th) / (1. - th);
      vec3 sc = mix(vec3(1., .72, .48), vec3(.68, .8, 1.), hash13(id + 5.));
      col += sc * s * b * b * (L == 0 ? 5. : 2.);
    }
  }
  float n = fbm3(d * 2.2 + 4.);
  float n2 = fbm4(d * 5. + 9.);
  col += vec3(.26, .08, .32) * pow(n, 3.) * 1.6 + vec3(.04, .13, .24) * pow(n2, 3.) * 2.2;
  return col * uBg;
}
vec4 disk(vec3 c, vec3 rd){
  float rc = length(c.xz);
  float phi = atan(c.z, c.x);
  float w = pow(rc, -1.5);
  float ang = phi - uTime * w * 2.4;
  vec2 q = vec2(cos(ang), sin(ang)) * rc;
  float n = fbm3(vec3(q * .85, rc * .35));
  float s = fbm4(vec3(rc * 3.4, q * .35));
  float dens = smoothstep(2.35, 3.3, rc) * smoothstep(15., 5., rc);
  dens *= (.2 + 1.25 * n * n + 1.1 * s * s);
  float T = pow(3.2 / rc, .9);
  vec3 col = mix(vec3(1., .3, .05), vec3(1., .8, .5), smoothstep(.25, .9, T));
  col = mix(col, vec3(.95, .96, 1.), smoothstep(.8, 1.05, T) * .65);
  vec3 vel = vec3(-c.z, 0., c.x) / rc;
  float beta = clamp(sqrt(.5 / max(rc - 1., .3)), 0., .7);
  float D = sqrt(1. - beta * beta) / (1. - beta * dot(vel, -rd));
  float g = sqrt(max(1. - 1. / rc, 0.));
  col *= pow(D, 3.) * g;
  col = mix(col, col * vec3(.75, .9, 1.35), clamp(D - 1., 0., 1.) * .6);
  float a = clamp(dens * 1.15, 0., 1.);
  return vec4(col * dens * 1.55, a) * uDisk;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  uv = rot2(uRoll) * uv;
  vec3 ro = vec3(0., sin(uTilt), -cos(uTilt)) * uCamDist;
  ro.xz = rot2(uYaw) * ro.xz;
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(vec3(0., 1., 0.), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(fw * 1.55 + uv.x * rt + uv.y * up);
  vec3 p = ro / uRs; vec3 v = rd;
  float r0 = length(p);
  vec3 hh = cross(p, v); float h2 = dot(hh, hh);
  vec3 col = vec3(0.); float trans = 1.; float rmin = 1e9; bool hit = false;
  float rEsc = max(r0 * 1.02, 40.);
  for (int i = 0; i < 280; i++) {
    float r = length(p);
    rmin = min(rmin, r);
    if (r < 1.) { hit = true; break; }
    if (r > rEsc && dot(p, v) > 0.) break;
    if (trans < .01) break;
    float dt = max(.018, .055 * r) * (r < 4. ? .55 : 1.);
    vec3 acc = -1.5 * h2 * p / pow(r, 5.);
    v += acc * dt;
    vec3 pn = p + v * dt;
    if (p.y * pn.y < 0.) {
      vec3 c = mix(p, pn, p.y / (p.y - pn.y));
      float rc = length(c.xz);
      if (rc > 2.2 && rc < 16.) {
        vec4 dc = disk(c, normalize(v));
        col += trans * dc.rgb;
        trans *= 1. - dc.a;
      }
    }
    p = pn;
  }
  if (!hit) col += trans * background(normalize(v));
  float halo = exp(-(rmin - 1.) * 2.6);
  col += uHawkCol * (hit ? max(uHawk - 1.2, 0.) * .9 : uHawk * halo * .9);
  col += uHawkCol * uHawk * .12 * exp(-rmin * .08);
  col += vec3(uFlash);
  gl_FragColor = vec4(tonemap(col * 1.15), 1.);
}`;
