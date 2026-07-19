const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const DEBUG_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_velocity;
in vec2 v_uv;
out vec4 color;
void main() {
  ivec2 size = textureSize(u_velocity, 0);
  ivec2 p = ivec2(clamp(v_uv, vec2(0.0), vec2(0.999999)) * vec2(size));
  vec4 state = texelFetch(u_velocity, p, 0);
  float speed = state.a;
  float shade = clamp(speed / 0.08, 0.0, 1.0);
  color = vec4(vec3(shade), 1.0);
}`;

const VORTICITY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_velocity;
uniform sampler2D u_solid;
uniform float u_scale;
in vec2 v_uv;
out vec4 color;
void main() {
  ivec2 size = textureSize(u_velocity, 0);
  ivec2 p = ivec2(clamp(v_uv, vec2(0.0), vec2(0.999999)) * vec2(size));
  if (texelFetch(u_solid, p, 0).r > 0.75) { color = vec4(0.18, 0.20, 0.25, 1.0); return; }
  ivec2 xr = ivec2(min(p.x + 1, size.x - 1), p.y);
  ivec2 xl = ivec2(max(p.x - 1, 0), p.y);
  ivec2 yu = ivec2(p.x, min(p.y + 1, size.y - 1));
  ivec2 yd = ivec2(p.x, max(p.y - 1, 0));
  float dvdx = 0.5 * (texelFetch(u_velocity, xr, 0).b - texelFetch(u_velocity, xl, 0).b);
  float dudy = 0.5 * (texelFetch(u_velocity, yu, 0).g - texelFetch(u_velocity, yd, 0).g);
  float vort = dvdx - dudy;
  float t = clamp(vort / u_scale, -1.0, 1.0);
  float a = pow(abs(t), 0.55);            // steeper than before: cores punch through faster
  a = clamp(a * 1.2 - 0.08, 0.0, 1.0);    // extra contrast: crush the low end, boost the highs
  vec3 bg = vec3(0.012, 0.016, 0.03);     // richer near-black so glow reads as luminous
  vec3 warm = mix(vec3(1.0, 0.32, 0.02), vec3(1.0, 0.97, 0.55), smoothstep(0.35, 1.0, a));
  vec3 cool = mix(vec3(0.02, 0.48, 1.0), vec3(0.55, 0.99, 1.0), smoothstep(0.35, 1.0, a));
  vec3 glow = t >= 0.0 ? warm : cool;
  color = vec4(mix(bg, glow, a), 1.0);
}`;

// Single-tile variants of the debug/vorticity views: same math, but sample only the
// requested tile's region of the shared textures and fill the whole viewport with it.
// Compute keeps stepping all 16 tiles regardless of which one is displayed here — view is
// decoupled from compute (Phase 6 spec). Neighbor lookups clamp to the tile's own bounds
// (not the full 4x4 texture) so edge gradients never leak in a neighboring tile's data.
const DEBUG_TILE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_velocity;
uniform int u_tileIndex;
uniform int u_tileW;
uniform int u_tileH;
uniform int u_gridX;
in vec2 v_uv;
out vec4 color;
void main() {
  int tx = u_tileIndex % u_gridX;
  int ty = u_tileIndex / u_gridX;
  ivec2 origin = ivec2(tx * u_tileW, ty * u_tileH);
  ivec2 local = ivec2(clamp(v_uv, vec2(0.0), vec2(0.999999)) * vec2(u_tileW, u_tileH));
  vec4 state = texelFetch(u_velocity, origin + local, 0);
  float speed = state.a;
  float shade = clamp(speed / 0.08, 0.0, 1.0);
  color = vec4(vec3(shade), 1.0);
}`;

const VORTICITY_TILE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_velocity;
uniform sampler2D u_solid;
uniform float u_scale;
uniform int u_tileIndex;
uniform int u_tileW;
uniform int u_tileH;
uniform int u_gridX;
in vec2 v_uv;
out vec4 color;
void main() {
  int tx = u_tileIndex % u_gridX;
  int ty = u_tileIndex / u_gridX;
  ivec2 origin = ivec2(tx * u_tileW, ty * u_tileH);
  ivec2 local = ivec2(clamp(v_uv, vec2(0.0), vec2(0.999999)) * vec2(u_tileW, u_tileH));
  ivec2 p = origin + local;
  if (texelFetch(u_solid, p, 0).r > 0.75) { color = vec4(0.18, 0.20, 0.25, 1.0); return; }
  ivec2 xr = origin + ivec2(min(local.x + 1, u_tileW - 1), local.y);
  ivec2 xl = origin + ivec2(max(local.x - 1, 0), local.y);
  ivec2 yu = origin + ivec2(local.x, min(local.y + 1, u_tileH - 1));
  ivec2 yd = origin + ivec2(local.x, max(local.y - 1, 0));
  float dvdx = 0.5 * (texelFetch(u_velocity, xr, 0).b - texelFetch(u_velocity, xl, 0).b);
  float dudy = 0.5 * (texelFetch(u_velocity, yu, 0).g - texelFetch(u_velocity, yd, 0).g);
  float vort = dvdx - dudy;
  float t = clamp(vort / u_scale, -1.0, 1.0);
  float a = pow(abs(t), 0.55);
  a = clamp(a * 1.2 - 0.08, 0.0, 1.0);
  vec3 bg = vec3(0.012, 0.016, 0.03);
  vec3 warm = mix(vec3(1.0, 0.32, 0.02), vec3(1.0, 0.97, 0.55), smoothstep(0.35, 1.0, a));
  vec3 cool = mix(vec3(0.02, 0.48, 1.0), vec3(0.55, 0.99, 1.0), smoothstep(0.35, 1.0, a));
  vec3 glow = t >= 0.0 ? warm : cool;
  color = vec4(mix(bg, glow, a), 1.0);
}`;

// Momentum-exchange force per boundary-fluid cell: for each link into a BODY solid
// (tile walls excluded by position), accumulate c_i*(f_i + f_ī) with post-collision f.
const FORCE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_f0;
uniform sampler2D u_f1;
uniform sampler2D u_f2;
uniform sampler2D u_solid;
uniform int u_tileH;
uniform bool u_fp16;
out vec4 outForce;
const ivec2 C[9] = ivec2[9](
  ivec2(0, 0), ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1),
  ivec2(1, 1), ivec2(-1, 1), ivec2(-1, -1), ivec2(1, -1));
const int OPP[9] = int[9](0, 2, 1, 4, 3, 7, 8, 5, 6);
const float W[9] = float[9](
  4.0 / 9.0,
  1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0
);
// Momentum exchange needs the true f_i; in fp16 mode the distribution textures hold the
// deviation g_i = f_i - W[i] (see lbm_collide.glsl), so add the weight back on read.
float loadF(ivec2 p, int i) {
  float raw;
  if (i < 4) raw = texelFetch(u_f0, p, 0)[i];
  else if (i < 8) raw = texelFetch(u_f1, p, 0)[i - 4];
  else raw = texelFetch(u_f2, p, 0).r;
  return u_fp16 ? raw + W[i] : raw;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float cellv = texelFetch(u_solid, p, 0).r;
  if (cellv < 0.25 || cellv > 0.75) { outForce = vec4(0.0); return; }  // only boundary-fluid
  int base = (p.y / u_tileH) * u_tileH;
  vec2 f = vec2(0.0);
  for (int i = 1; i < 9; ++i) {
    ivec2 q = p + C[i];
    if (texelFetch(u_solid, q, 0).r <= 0.75) continue;      // neighbor not solid
    int nLocalY = q.y - base;
    if (nLocalY == 0 || nLocalY == u_tileH - 1) continue;   // tile wall, not the body
    f += vec2(C[i]) * (loadF(p, i) + loadF(p, OPP[i]));
  }
  // Sign: the raw momentum-exchange sum points upstream for drag; negate so a body in +x
  // flow reads positive drag (verified against the cylinder — Cd was -0.49 before the flip).
  outForce = vec4(-f, 0.0, 0.0);                            // (drag Fx, lift Fy)
}`;

// Reduction pass 1: sum each tile column over its local Y into a W x GRID_Y strip.
const REDUCE_Y_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_force;
uniform int u_tileH;
out vec4 outRow;
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  int base = fc.y * u_tileH;
  vec2 s = vec2(0.0);
  for (int j = 0; j < u_tileH; ++j) s += texelFetch(u_force, ivec2(fc.x, base + j), 0).rg;
  outRow = vec4(s, 0.0, 0.0);
}`;

// Reduction pass 2: sum each tile row over local X, one texel per tile, written straight
// into the current sample's history column. Row r maps to tile (r % GRID_X, r / GRID_X).
const REDUCE_X_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_row;
uniform int u_tileW;
uniform int u_gridX;
out vec4 outHist;
void main() {
  int r = int(gl_FragCoord.y);
  int base = (r % u_gridX) * u_tileW;
  int ty = r / u_gridX;
  vec2 s = vec2(0.0);
  for (int j = 0; j < u_tileW; ++j) s += texelFetch(u_row, ivec2(base + j, ty), 0).rg;
  outHist = vec4(s.y, s.x, 0.0, 0.0);   // R = lift, G = drag (spec order)
}`;

// Log2 max-downsample of the velocity texture's speed (.a) channel. First pass reads the
// RGBA velocity texture directly; later passes read the single-channel (.r) intermediate
// levels produced by earlier passes. No readback here — getMaxMach() reads back the final
// 1x1 level only when called, never per step.
const MAX_REDUCE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_src;
uniform int u_srcW;
uniform int u_srcH;
uniform bool u_firstPass;
out vec4 outMax;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  float m = 0.0;
  for (int dy = 0; dy < 2; ++dy) {
    for (int dx = 0; dx < 2; ++dx) {
      ivec2 q = ivec2(min(p.x + dx, u_srcW - 1), min(p.y + dy, u_srcH - 1));
      float v = u_firstPass ? texelFetch(u_src, q, 0).a : texelFetch(u_src, q, 0).r;
      m = max(m, v);
    }
  }
  outMax = vec4(m, 0.0, 0.0, 0.0);
}`;

function fail(message) {
  throw new Error(`LBM: ${message}`);
}

function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    fail(`${label} shader failed to compile:\n${log}`);
  }
  return shader;
}

function createProgram(gl, fragmentSource, label) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX, `${label} vertex`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    fail(`${label} program failed to link:\n${log}`);
  }
  return program;
}

function loadShaderSource(relativeUrl) {
  // SPEC-GAP: the frozen synchronous constructor leaves no asynchronous shader-loading hook.
  const request = new XMLHttpRequest();
  request.open('GET', new URL(relativeUrl, import.meta.url), false);
  request.send();
  if (request.status !== 200 && request.status !== 0) {
    fail(`could not load ${relativeUrl} (HTTP ${request.status})`);
  }
  return request.responseText;
}

const D2Q9_WEIGHTS = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];

function equilibrium(uIn) {
  const cx = [0, 1, -1, 0, 0, 1, -1, -1, 1];
  return D2Q9_WEIGHTS.map((weight, i) => {
    const cu = cx[i] * uIn;
    return weight * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * uIn * uIn);
  });
}

export class LBM {
  constructor(gl, cfg) {
    if (!(gl instanceof WebGL2RenderingContext)) fail('WebGL2 is required');
    if (!gl.getExtension('EXT_color_buffer_float')) fail('EXT_color_buffer_float is required');

    this.gl = gl;
    this.cfg = cfg;
    this.width = cfg.TILE_W * cfg.GRID_X;
    this.height = cfg.TILE_H * cfg.GRID_Y;
    this._readSet = 0;
    this._sampleCount = cfg.EVAL_STEPS / cfg.SAMPLE_EVERY;

    // fp16 bandwidth experiment. Default OFF => byte-identical RGBA32F behavior. When ON, the
    // 3 distribution textures switch to RGBA16F storing the deviation g_i = f_i - W[i]
    // (see lbm_collide.glsl); trivially revertible by flipping this flag back to false/omitted.
    // Enable via cfg.FP16_DISTRIBUTIONS or the URL (?fp16) so it can be A/B-tested without
    // editing the frozen cfg object.
    const fp16Url = typeof location !== 'undefined' && /[?&]fp16(=(1|true|on))?(&|$)/i.test(location.search);
    this.fp16 = !!cfg.FP16_DISTRIBUTIONS || fp16Url;
    this._distributionFormat = this.fp16 ? gl.RGBA16F : gl.RGBA32F;

    // Stage 0: optional per-pass GPU timing via EXT_disjoint_timer_query_webgl2. Absent on
    // some browsers (e.g. Safari) — degrade gracefully, never crash or stall a frame for it.
    this._timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this._timingEvery = cfg.TIMING_EVERY || 60;
    // Per-pass timer queries are unreliable on some drivers (Chrome/macOS-Metal reports
    // uniform ~frame-sized garbage). Keep the console breakdown opt-in via ?timing; the
    // app HUD steps/s (wall-clock) is the trustworthy throughput signal.
    this._timingVerbose = typeof location !== 'undefined' && /[?&]timing(=|&|$)/.test(location.search);
    this._timerActivePass = null;
    this._timingPending = [];
    this._timingLatest = { collideMs: null, forceMs: null, reduceYMs: null, reduceXMs: null };
    this._timingEMA = { collideMs: null, forceMs: null, reduceYMs: null, reduceXMs: null };

    console.log(
      `[LBM] distributions: ${this.fp16 ? 'RGBA16F (fp16, deviation-stored)' : 'RGBA32F (fp32)'}` +
      ` | GPU timer queries: ${this._timerExt ? 'supported' : 'UNSUPPORTED on this browser'}` +
      `${this.fp16 ? '' : '  — add ?fp16 to the URL to try half-precision'}`
    );

    const tauMinus = 0.5 + cfg.MAGIC / (cfg.TAU_PLUS - 0.5);
    this.omegaPlus = 1 / cfg.TAU_PLUS;
    this.omegaMinus = 1 / tauMinus;

    if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 3) fail('three draw buffers are required');
    if (gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) < 3) fail('three color attachments are required');

    this._vao = gl.createVertexArray();
    this._program = createProgram(gl, loadShaderSource('./shaders/lbm_collide.glsl'), 'collision');
    this._debugProgram = createProgram(gl, DEBUG_FRAGMENT, 'debug');
    this._vorticityProgram = createProgram(gl, VORTICITY_FRAGMENT, 'vorticity');
    this._debugTileProgram = createProgram(gl, DEBUG_TILE_FRAGMENT, 'debug-tile');
    this._vorticityTileProgram = createProgram(gl, VORTICITY_TILE_FRAGMENT, 'vorticity-tile');
    this._textures = [this._createStateSet(), this._createStateSet()];
    this._framebuffers = [this._createFramebuffer(this._textures[0]), this._createFramebuffer(this._textures[1])];
    this._solidMask = this._createMaskTexture();

    gl.useProgram(this._program);
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_f0'), 0);
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_f1'), 1);
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_f2'), 2);
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_solid'), 3);
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_tileW'), cfg.TILE_W);
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_tileH'), cfg.TILE_H);
    gl.uniform1f(gl.getUniformLocation(this._program, 'u_uIn'), cfg.U_IN);
    gl.uniform1f(gl.getUniformLocation(this._program, 'u_omegaPlus'), this.omegaPlus);
    gl.uniform1f(gl.getUniformLocation(this._program, 'u_omegaMinus'), this.omegaMinus);
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_fp16'), this.fp16 ? 1 : 0);

    gl.useProgram(this._debugProgram);
    gl.uniform1i(gl.getUniformLocation(this._debugProgram, 'u_velocity'), 0);

    gl.useProgram(this._vorticityProgram);
    gl.uniform1i(gl.getUniformLocation(this._vorticityProgram, 'u_velocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this._vorticityProgram, 'u_solid'), 1);
    gl.uniform1f(gl.getUniformLocation(this._vorticityProgram, 'u_scale'), 0.013);

    // Single-tile views: tile geometry (size/grid) is fixed for the run, only the tile
    // index changes per frame, so those uniforms are set once here.
    gl.useProgram(this._debugTileProgram);
    gl.uniform1i(gl.getUniformLocation(this._debugTileProgram, 'u_velocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this._debugTileProgram, 'u_tileW'), cfg.TILE_W);
    gl.uniform1i(gl.getUniformLocation(this._debugTileProgram, 'u_tileH'), cfg.TILE_H);
    gl.uniform1i(gl.getUniformLocation(this._debugTileProgram, 'u_gridX'), cfg.GRID_X);
    this._debugTileIndexLoc = gl.getUniformLocation(this._debugTileProgram, 'u_tileIndex');

    gl.useProgram(this._vorticityTileProgram);
    gl.uniform1i(gl.getUniformLocation(this._vorticityTileProgram, 'u_velocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this._vorticityTileProgram, 'u_solid'), 1);
    gl.uniform1f(gl.getUniformLocation(this._vorticityTileProgram, 'u_scale'), 0.013);
    gl.uniform1i(gl.getUniformLocation(this._vorticityTileProgram, 'u_tileW'), cfg.TILE_W);
    gl.uniform1i(gl.getUniformLocation(this._vorticityTileProgram, 'u_tileH'), cfg.TILE_H);
    gl.uniform1i(gl.getUniformLocation(this._vorticityTileProgram, 'u_gridX'), cfg.GRID_X);
    this._vorticityTileIndexLoc = gl.getUniformLocation(this._vorticityTileProgram, 'u_tileIndex');

    // --- Phase 3: momentum-exchange force pipeline ---
    this._sampleSlots = this._sampleCount;   // last EVAL_STEPS/SAMPLE_EVERY samples kept
    this._sampleIndex = 0;
    this._stepCounter = 0;

    this._forceProgram = createProgram(gl, FORCE_FRAGMENT, 'force');
    this._reduceYProgram = createProgram(gl, REDUCE_Y_FRAGMENT, 'reduceY');
    this._reduceXProgram = createProgram(gl, REDUCE_X_FRAGMENT, 'reduceX');

    this._forceTex = this._createTextureSized(gl.RGBA32F, this.width, this.height);
    this._rowTex = this._createTextureSized(gl.RGBA32F, this.width, cfg.GRID_Y);
    this._historyTex = this._createTextureSized(gl.RGBA32F, this._sampleSlots, 16);
    this._forceFBO = this._createSingleFBO(this._forceTex);
    this._rowFBO = this._createSingleFBO(this._rowTex);
    this._historyFBO = this._createSingleFBO(this._historyTex);

    gl.useProgram(this._forceProgram);
    gl.uniform1i(gl.getUniformLocation(this._forceProgram, 'u_f0'), 0);
    gl.uniform1i(gl.getUniformLocation(this._forceProgram, 'u_f1'), 1);
    gl.uniform1i(gl.getUniformLocation(this._forceProgram, 'u_f2'), 2);
    gl.uniform1i(gl.getUniformLocation(this._forceProgram, 'u_solid'), 3);
    gl.uniform1i(gl.getUniformLocation(this._forceProgram, 'u_tileH'), cfg.TILE_H);
    gl.uniform1i(gl.getUniformLocation(this._forceProgram, 'u_fp16'), this.fp16 ? 1 : 0);

    gl.useProgram(this._reduceYProgram);
    gl.uniform1i(gl.getUniformLocation(this._reduceYProgram, 'u_force'), 0);
    gl.uniform1i(gl.getUniformLocation(this._reduceYProgram, 'u_tileH'), cfg.TILE_H);

    gl.useProgram(this._reduceXProgram);
    gl.uniform1i(gl.getUniformLocation(this._reduceXProgram, 'u_row'), 0);
    gl.uniform1i(gl.getUniformLocation(this._reduceXProgram, 'u_tileW'), cfg.TILE_W);
    gl.uniform1i(gl.getUniformLocation(this._reduceXProgram, 'u_gridX'), cfg.GRID_X);

    // --- Max-Mach reduction pipeline: fixed chain of log2-halving levels, allocated once.
    this._CS = 1 / Math.sqrt(3);   // lattice speed of sound
    this._maxReduceProgram = createProgram(gl, MAX_REDUCE_FRAGMENT, 'maxReduce');
    this._maxReduceUniforms = {
      srcW: gl.getUniformLocation(this._maxReduceProgram, 'u_srcW'),
      srcH: gl.getUniformLocation(this._maxReduceProgram, 'u_srcH'),
      firstPass: gl.getUniformLocation(this._maxReduceProgram, 'u_firstPass'),
    };
    gl.useProgram(this._maxReduceProgram);
    gl.uniform1i(gl.getUniformLocation(this._maxReduceProgram, 'u_src'), 0);
    this._maxLevels = [];
    {
      let w = this.width;
      let h = this.height;
      while (w > 1 || h > 1) {
        w = Math.max(1, Math.ceil(w / 2));
        h = Math.max(1, Math.ceil(h / 2));
        const texture = this._createTextureSized(gl.RGBA32F, w, h);
        const levelFBO = this._createSingleFBO(texture);
        this._maxLevels.push({ w, h, texture, fbo: levelFBO });
      }
    }
    this._maxMachReadback = new Float32Array(4);

    this.reset();
  }

  // Phase-2 test fixture: tile walls (solid top/bottom rows per sub-domain) plus a
  // centered cylinder ~1/3 chord back from each inlet. Real masks come from raster.js later.
  static debugMask(cfg) {
    const width = cfg.TILE_W * cfg.GRID_X;
    const height = cfg.TILE_H * cfg.GRID_Y;
    const mask = new Uint8Array(width * height);
    const radius = cfg.CHORD / 2;
    const cx = Math.round(cfg.TILE_W / 3);
    // +2 cells (~1% of tile height) breaks mirror symmetry so shedding starts promptly
    // instead of waiting on round-off; negligible physically, replaced by raster.js later.
    const cy = Math.round(cfg.TILE_H / 2) + 2;
    for (let y = 0; y < height; ++y) {
      const localY = y % cfg.TILE_H;
      const wallRow = localY === 0 || localY === cfg.TILE_H - 1;
      for (let x = 0; x < width; ++x) {
        const localX = x % cfg.TILE_W;
        let solid = wallRow;
        const dx = localX - cx;
        const dy = localY - cy;
        if (dx * dx + dy * dy < radius * radius) solid = true;
        if (solid) mask[y * width + x] = 255;
      }
    }
    return mask;
  }

  _createTexture(internalFormat, format, type) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, this.width, this.height);
    return texture;
  }

  _createTextureSized(internalFormat, w, h) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
    return texture;
  }

  _createSingleFBO(texture) {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      fail('reduction framebuffer is incomplete');
    }
    return framebuffer;
  }

  _createStateSet() {
    const gl = this.gl;
    return Array.from({ length: 3 }, () => this._createTexture(this._distributionFormat, gl.RGBA, gl.FLOAT));
  }

  _createMaskTexture() {
    const gl = this.gl;
    return this._createTexture(gl.R8, gl.RED, gl.UNSIGNED_BYTE);
  }

  _createFramebuffer(textures) {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    textures.forEach((texture, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
    });
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      fail('state framebuffer is incomplete');
    }
    return framebuffer;
  }

  setSolidMask(uint8Array) {
    if (!(uint8Array instanceof Uint8Array) || uint8Array.length !== this.width * this.height) {
      fail(`solid mask must be a Uint8Array of length ${this.width * this.height}`);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._solidMask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RED, gl.UNSIGNED_BYTE, this._deriveBoundary(uint8Array));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this._clearForceHistory();
  }

  // Accepts any 0/255 solid mask (debug fixture or raster.js) and tags fluid cells that
  // touch a solid as 128, so the collision shader can fast-path pure fluid. Same physics.
  _deriveBoundary(src) {
    const w = this.width;
    const h = this.height;
    const out = new Uint8Array(src);
    for (let y = 0; y < h; ++y) {
      for (let x = 0; x < w; ++x) {
        const idx = y * w + x;
        if (src[idx] === 255) continue;
        let adjacent = false;
        for (let dy = -1; dy <= 1 && !adjacent; ++dy) {
          for (let dx = -1; dx <= 1; ++dx) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            if (src[ny * w + nx] === 255) { adjacent = true; break; }
          }
        }
        if (adjacent) out[idx] = 128;
      }
    }
    return out;
  }

  reset() {
    const gl = this.gl;
    const f = equilibrium(this.cfg.U_IN);
    // fp16 mode stores g_i = f_i - W[i]; clear with the same encoding the shader reads/writes.
    const stored = this.fp16 ? f.map((v, i) => v - D2Q9_WEIGHTS[i]) : f;
    const clears = [
      new Float32Array(stored.slice(0, 4)),
      new Float32Array(stored.slice(4, 8)),
      new Float32Array([stored[8], this.cfg.U_IN, 0, Math.abs(this.cfg.U_IN)]),
    ];
    for (const framebuffer of this._framebuffers) {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      clears.forEach((value, i) => gl.clearBufferfv(gl.COLOR, i, value));
    }
    this._readSet = 0;
    this._clearForceHistory();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _clearForceHistory() {
    const gl = this.gl;
    this._sampleIndex = 0;
    this._stepCounter = 0;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._historyFBO);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 0]));
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  step(n = 1) {
    if (!Number.isInteger(n) || n < 0) fail('step count must be a non-negative integer');
    const gl = this.gl;
    gl.useProgram(this._program);
    gl.bindVertexArray(this._vao);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // The solid mask is constant across the batch and each FBO already carries its
    // drawBuffers state from creation — bind the mask once, skip per-step reissue.
    gl.activeTexture(gl.TEXTURE0 + 3);
    gl.bindTexture(gl.TEXTURE_2D, this._solidMask);

    for (let step = 0; step < n; ++step) {
      const timed = !!this._timerExt && (this._stepCounter + 1) % this._timingEvery === 0;
      const writeSet = 1 - this._readSet;
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._framebuffers[writeSet]);
      for (let i = 0; i < 3; ++i) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, this._textures[this._readSet][i]);
      }
      const collideQuery = timed ? this._beginTimer('collideMs') : null;
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (collideQuery) this._endTimer(collideQuery);
      this._readSet = writeSet;

      if (++this._stepCounter % this.cfg.SAMPLE_EVERY === 0) {
        this._sample(timed);
        // _sample rebinds program/viewport/targets; restore the collision pipeline.
        gl.useProgram(this._program);
        gl.viewport(0, 0, this.width, this.height);
        gl.activeTexture(gl.TEXTURE0 + 3);
        gl.bindTexture(gl.TEXTURE_2D, this._solidMask);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._pollTimers();
  }

  // --- Stage 0: per-pass GPU timing (EXT_disjoint_timer_query_webgl2) ---
  // Only one TIME_ELAPSED_EXT query may be active at a time, so passes are timed
  // sequentially (begin/end fully before the next begins) and results are polled a few
  // frames later without ever blocking on gl.getQueryParameter.
  _beginTimer(pass) {
    if (!this._timerExt || this._timerActivePass) return null;
    const gl = this.gl;
    const query = gl.createQuery();
    gl.beginQuery(this._timerExt.TIME_ELAPSED_EXT, query);
    this._timerActivePass = pass;
    return query;
  }

  _endTimer(query) {
    if (!query) return;
    const gl = this.gl;
    gl.endQuery(this._timerExt.TIME_ELAPSED_EXT);
    this._timingPending.push({ query, pass: this._timerActivePass });
    this._timerActivePass = null;
  }

  _pollTimers() {
    if (!this._timerExt || this._timingPending.length === 0) return;
    const gl = this.gl;
    const ext = this._timerExt;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const still = [];
    let updated = false;
    for (const item of this._timingPending) {
      if (disjoint) { gl.deleteQuery(item.query); continue; }  // discard: result untrustworthy
      if (gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) {
        const ns = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
        const ms = ns / 1e6;
        this._timingLatest[item.pass] = ms;
        const prevEma = this._timingEMA[item.pass];
        this._timingEMA[item.pass] = prevEma == null ? ms : prevEma * 0.9 + ms * 0.1;
        gl.deleteQuery(item.query);
        updated = true;
      } else {
        still.push(item);
      }
    }
    this._timingPending = still;
    if (updated) this._logTimingSummary();
  }

  _logTimingSummary() {
    if (!this._timingVerbose) return;
    const t = this._timingEMA;
    const collide = t.collideMs;
    const reduceTotal = (t.forceMs || 0) + (t.reduceYMs || 0) + (t.reduceXMs || 0);
    const stepsPerSec = collide ? 1000 / collide : null;
    const fmt = (v) => (v == null ? 'n/a' : v.toFixed(3));
    console.log(
      `[LBM timing ${this.fp16 ? 'fp16' : 'fp32'}] collide=${fmt(collide)}ms force=${fmt(t.forceMs)}ms ` +
      `reduceY=${fmt(t.reduceYMs)}ms reduceX=${fmt(t.reduceXMs)}ms ` +
      `reduceTotal=${reduceTotal.toFixed(3)}ms ` +
      `steps/s=${stepsPerSec ? stepsPerSec.toFixed(0) : 'n/a'}`
    );
  }

  // Public read-out of the latest timing sample (EMA-smoothed). Returns supported:false and
  // null timings when EXT_disjoint_timer_query_webgl2 is unavailable.
  getTimings() {
    if (!this._timerExt) {
      return { supported: false, collideMs: null, forceMs: null, reduceYMs: null, reduceXMs: null, stepsPerSec: null };
    }
    const t = this._timingEMA;
    const stepsPerSec = t.collideMs ? 1000 / t.collideMs : null;
    return {
      supported: true,
      collideMs: t.collideMs,
      forceMs: t.forceMs,
      reduceYMs: t.reduceYMs,
      reduceXMs: t.reduceXMs,
      stepsPerSec,
    };
  }

  // Force -> per-tile reduction -> append one column to the ring history texture. Runs on
  // the GPU; no readback here. Called from step() every SAMPLE_EVERY steps.
  _sample(timed = false) {
    const gl = this.gl;
    gl.bindVertexArray(this._vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(this._forceProgram);
    gl.viewport(0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._forceFBO);
    for (let i = 0; i < 3; ++i) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this._textures[this._readSet][i]);
    }
    gl.activeTexture(gl.TEXTURE0 + 3);
    gl.bindTexture(gl.TEXTURE_2D, this._solidMask);
    let query = timed ? this._beginTimer('forceMs') : null;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (query) this._endTimer(query);

    gl.useProgram(this._reduceYProgram);
    gl.viewport(0, 0, this.width, this.cfg.GRID_Y);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._rowFBO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._forceTex);
    query = timed ? this._beginTimer('reduceYMs') : null;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (query) this._endTimer(query);

    const col = this._sampleIndex % this._sampleSlots;
    gl.useProgram(this._reduceXProgram);
    gl.viewport(col, 0, 1, 16);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._historyFBO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._rowTex);
    query = timed ? this._beginTimer('reduceXMs') : null;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (query) this._endTimer(query);

    this._sampleIndex += 1;
  }

  // One readPixels of the tiny history texture; unrotates the ring into chronological,
  // tile-major order (tile t, sample k at index t*slots + k). channel 0 = lift, 1 = drag.
  _readHistoryChannel(channel) {
    const gl = this.gl;
    const slots = this._sampleSlots;
    const buf = new Float32Array(slots * 16 * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._historyFBO);
    gl.readPixels(0, 0, slots, 16, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    const out = new Float32Array(slots * 16);
    const start = this._sampleIndex % slots;
    for (let t = 0; t < 16; ++t) {
      for (let k = 0; k < slots; ++k) {
        const col = (start + k) % slots;
        out[t * slots + k] = buf[(t * slots + col) * 4 + channel];
      }
    }
    return out;
  }

  readLiftHistory() {
    return this._readHistoryChannel(0);
  }

  readDragHistory() {
    return this._readHistoryChannel(1);
  }

  // Per-tile drag coefficient and Strouhal number over the retained window. Cd uses
  // 0.5*rho*U^2*D with rho=1; St from zero-crossings of the mean-subtracted lift signal.
  diagnostics() {
    const cfg = this.cfg;
    const slots = this._sampleSlots;
    const lift = this.readLiftHistory();
    const drag = this.readDragHistory();
    const q = 0.5 * cfg.U_IN * cfg.U_IN * cfg.CHORD;
    const windowSteps = slots * cfg.SAMPLE_EVERY;
    const cd = new Float32Array(16);
    const st = new Float32Array(16);
    const cl = new Float32Array(16);       // mean lift coefficient (~0 for a symmetric body)
    const clRms = new Float32Array(16);    // fluctuating lift amplitude — the shed-load signal
    for (let t = 0; t < 16; ++t) {
      let sumDrag = 0;
      let sumLift = 0;
      for (let k = 0; k < slots; ++k) {
        sumDrag += drag[t * slots + k];
        sumLift += lift[t * slots + k];
      }
      const md = sumDrag / slots;
      const ml = sumLift / slots;
      cd[t] = md / q;
      cl[t] = ml / q;
      let crossings = 0;
      let sumSq = 0;
      let prev = lift[t * slots] - ml;
      sumSq += prev * prev;
      for (let k = 1; k < slots; ++k) {
        const v = lift[t * slots + k] - ml;
        sumSq += v * v;
        if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) crossings += 1;
        prev = v;
      }
      clRms[t] = Math.sqrt(sumSq / slots) / q;
      st[t] = ((crossings / 2) / windowSteps) * cfg.CHORD / cfg.U_IN;
    }
    return { cd, st, cl, clRms, maxMach: this.getMaxMach() };
  }

  // Max Mach over the whole domain: log2 GPU max-reduction of the velocity texture's speed
  // (.a) channel, then a single 1x1 readback. Solid cells store velocity (0,0) (see
  // lbm_collide.glsl), so no explicit fluid mask is needed. Call this periodically (once per
  // generation, once per HUD tick) — never per step, since the final readback is a GPU sync.
  getMaxMach() {
    const gl = this.gl;
    gl.bindVertexArray(this._vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this._maxReduceProgram);

    let srcTex = this.velocityTexture;
    let srcW = this.width;
    let srcH = this.height;
    let firstPass = true;
    for (const level of this._maxLevels) {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, level.fbo);
      gl.viewport(0, 0, level.w, level.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this._maxReduceUniforms.srcW, srcW);
      gl.uniform1i(this._maxReduceUniforms.srcH, srcH);
      gl.uniform1i(this._maxReduceUniforms.firstPass, firstPass ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      srcTex = level.texture;
      srcW = level.w;
      srcH = level.h;
      firstPass = false;
    }

    const last = this._maxLevels[this._maxLevels.length - 1];
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, last.fbo);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this._maxMachReadback);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return this._maxMachReadback[0] / this._CS;
  }

  get velocityTexture() {
    return this._textures[this._readSet][2];
  }

  get vorticityTexture() {
    return null;
  }

  renderDebug() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this._debugProgram);
    gl.bindVertexArray(this._vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderVorticity() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this._vorticityProgram);
    gl.bindVertexArray(this._vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._solidMask);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Single-tile fullscreen views (Phase 6): crop the shared velocity/solid textures to one
  // tile's region and stretch it to fill the viewport. Compute is untouched — all 16 tiles
  // keep stepping regardless of which one is displayed.
  renderDebugTile(tileIndex) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this._debugTileProgram);
    gl.bindVertexArray(this._vao);
    gl.uniform1i(this._debugTileIndexLoc, tileIndex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderVorticityTile(tileIndex) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this._vorticityTileProgram);
    gl.bindVertexArray(this._vao);
    gl.uniform1i(this._vorticityTileIndexLoc, tileIndex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._solidMask);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
