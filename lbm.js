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
  float a = pow(abs(t), 0.65);            // brighten mid-range so shed cores read
  vec3 bg = vec3(0.03, 0.04, 0.06);
  vec3 warm = mix(vec3(0.95, 0.42, 0.12), vec3(1.0, 0.93, 0.66), smoothstep(0.5, 1.0, a));
  vec3 cool = mix(vec3(0.12, 0.55, 0.98), vec3(0.66, 0.94, 1.0), smoothstep(0.5, 1.0, a));
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
out vec4 outForce;
const ivec2 C[9] = ivec2[9](
  ivec2(0, 0), ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1),
  ivec2(1, 1), ivec2(-1, 1), ivec2(-1, -1), ivec2(1, -1));
const int OPP[9] = int[9](0, 2, 1, 4, 3, 7, 8, 5, 6);
float loadF(ivec2 p, int i) {
  if (i < 4) return texelFetch(u_f0, p, 0)[i];
  if (i < 8) return texelFetch(u_f1, p, 0)[i - 4];
  return texelFetch(u_f2, p, 0).r;
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

function equilibrium(uIn) {
  const cx = [0, 1, -1, 0, 0, 1, -1, -1, 1];
  const weights = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
  return weights.map((weight, i) => {
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

    const tauMinus = 0.5 + cfg.MAGIC / (cfg.TAU_PLUS - 0.5);
    this.omegaPlus = 1 / cfg.TAU_PLUS;
    this.omegaMinus = 1 / tauMinus;

    if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 3) fail('three draw buffers are required');
    if (gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) < 3) fail('three color attachments are required');

    this._vao = gl.createVertexArray();
    this._program = createProgram(gl, loadShaderSource('./shaders/lbm_collide.glsl'), 'collision');
    this._debugProgram = createProgram(gl, DEBUG_FRAGMENT, 'debug');
    this._vorticityProgram = createProgram(gl, VORTICITY_FRAGMENT, 'vorticity');
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

    gl.useProgram(this._debugProgram);
    gl.uniform1i(gl.getUniformLocation(this._debugProgram, 'u_velocity'), 0);

    gl.useProgram(this._vorticityProgram);
    gl.uniform1i(gl.getUniformLocation(this._vorticityProgram, 'u_velocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this._vorticityProgram, 'u_solid'), 1);
    gl.uniform1f(gl.getUniformLocation(this._vorticityProgram, 'u_scale'), 0.013);

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

    gl.useProgram(this._reduceYProgram);
    gl.uniform1i(gl.getUniformLocation(this._reduceYProgram, 'u_force'), 0);
    gl.uniform1i(gl.getUniformLocation(this._reduceYProgram, 'u_tileH'), cfg.TILE_H);

    gl.useProgram(this._reduceXProgram);
    gl.uniform1i(gl.getUniformLocation(this._reduceXProgram, 'u_row'), 0);
    gl.uniform1i(gl.getUniformLocation(this._reduceXProgram, 'u_tileW'), cfg.TILE_W);
    gl.uniform1i(gl.getUniformLocation(this._reduceXProgram, 'u_gridX'), cfg.GRID_X);

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
    return Array.from({ length: 3 }, () => this._createTexture(gl.RGBA32F, gl.RGBA, gl.FLOAT));
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
    const clears = [
      new Float32Array(f.slice(0, 4)),
      new Float32Array(f.slice(4, 8)),
      new Float32Array([f[8], this.cfg.U_IN, 0, Math.abs(this.cfg.U_IN)]),
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
      const writeSet = 1 - this._readSet;
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._framebuffers[writeSet]);
      for (let i = 0; i < 3; ++i) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, this._textures[this._readSet][i]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this._readSet = writeSet;

      if (++this._stepCounter % this.cfg.SAMPLE_EVERY === 0) {
        this._sample();
        // _sample rebinds program/viewport/targets; restore the collision pipeline.
        gl.useProgram(this._program);
        gl.viewport(0, 0, this.width, this.height);
        gl.activeTexture(gl.TEXTURE0 + 3);
        gl.bindTexture(gl.TEXTURE_2D, this._solidMask);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Force -> per-tile reduction -> append one column to the ring history texture. Runs on
  // the GPU; no readback here. Called from step() every SAMPLE_EVERY steps.
  _sample() {
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this._reduceYProgram);
    gl.viewport(0, 0, this.width, this.cfg.GRID_Y);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._rowFBO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._forceTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const col = this._sampleIndex % this._sampleSlots;
    gl.useProgram(this._reduceXProgram);
    gl.viewport(col, 0, 1, 16);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._historyFBO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._rowTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

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
    return { cd, st, cl, clRms };
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
}
