import React, {useEffect, useLayoutEffect, useRef} from 'react';
import {useCurrentFrame} from 'remotion';
import {FPS, H, W} from '../lib/timeline';

type Uniforms = Record<string, number | number[]>;

const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

/**
 * Full-frame fragment shader. Rendered below output resolution (`scale`) and
 * upsampled, with an optional cheap bloom layer on top.
 */
export const ShaderCanvas: React.FC<{
  fs: string;
  uniforms: Uniforms;
  scale?: number;
  time?: number;
  bloom?: number;
  bloomBlur?: number;
  style?: React.CSSProperties;
}> = ({fs, uniforms, scale = 0.5, time, bloom = 0, bloomBlur = 3, style}) => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef<HTMLCanvasElement>(null);
  const state = useRef<{
    gl: WebGLRenderingContext;
    prog: WebGLProgram;
    locs: Map<string, WebGLUniformLocation | null>;
  } | null>(null);
  const w = Math.round(W * scale);
  const h = Math.round(H * scale);

  useLayoutEffect(() => {
    const c = ref.current!;
    if (!state.current) {
      const gl = c.getContext('webgl', {preserveDrawingBuffer: true, antialias: false, alpha: false})!;
      if (!gl) throw new Error('WebGL unavailable');
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
      gl.useProgram(prog);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      state.current = {gl, prog, locs: new Map()};
    }
    const {gl, prog, locs} = state.current;
    const loc = (n: string) => {
      if (!locs.has(n)) locs.set(n, gl.getUniformLocation(prog, n));
      return locs.get(n)!;
    };
    gl.viewport(0, 0, w, h);
    gl.uniform2f(loc('uRes'), w, h);
    gl.uniform1f(loc('uTime'), time ?? frame / FPS);
    for (const [k, v] of Object.entries(uniforms)) {
      const l = loc(k);
      if (!l) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (bloom > 0 && bloomRef.current) {
      const bc = bloomRef.current;
      const bctx = bc.getContext('2d')!;
      bctx.globalCompositeOperation = 'copy';
      bctx.filter = `blur(${bloomBlur}px) contrast(1.5)`;
      bctx.drawImage(c, 0, 0, bc.width, bc.height);
      bctx.filter = 'none';
    }
  });

  useEffect(() => {
    return () => {
      const s = state.current;
      if (s) s.gl.getExtension('WEBGL_lose_context')?.loseContext();
      state.current = null;
    };
  }, []);

  const fill: React.CSSProperties = {position: 'absolute', inset: 0, width: '100%', height: '100%'};
  return (
    <div style={{...fill, ...style}}>
      <canvas ref={ref} width={w} height={h} style={fill} />
      {bloom > 0 ? (
        <canvas
          ref={bloomRef}
          width={Math.round(W / 8)}
          height={Math.round(H / 8)}
          style={{...fill, mixBlendMode: 'screen', opacity: Math.min(1, bloom)}}
        />
      ) : null}
    </div>
  );
};
