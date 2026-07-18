#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_f0;
uniform sampler2D u_f1;
uniform sampler2D u_f2;
uniform sampler2D u_solid;
uniform int u_tileW;
uniform int u_tileH;
uniform float u_uIn;
uniform float u_omegaPlus;
uniform float u_omegaMinus;

layout(location = 0) out vec4 outF0;
layout(location = 1) out vec4 outF1;
layout(location = 2) out vec4 outF2;

const ivec2 C[9] = ivec2[9](
  ivec2(0, 0), ivec2(1, 0), ivec2(-1, 0),
  ivec2(0, 1), ivec2(0, -1),
  ivec2(1, 1), ivec2(-1, 1), ivec2(-1, -1), ivec2(1, -1)
);
const int OPP[9] = int[9](0, 2, 1, 4, 3, 7, 8, 5, 6);
const float W[9] = float[9](
  4.0 / 9.0,
  1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
  1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0
);

float loadF(ivec2 p, int i) {
  if (i < 4) return texelFetch(u_f0, p, 0)[i];
  if (i < 8) return texelFetch(u_f1, p, 0)[i - 4];
  return texelFetch(u_f2, p, 0).r;
}

bool isSolid(ivec2 p) {
  return texelFetch(u_solid, p, 0).r > 0.75;
}

void storeF(float f[9], vec2 velocity) {
  outF0 = vec4(f[0], f[1], f[2], f[3]);
  outF1 = vec4(f[4], f[5], f[6], f[7]);
  // The state needs only R here; G/B are free diagnostics for velocityTexture.
  outF2 = vec4(f[8], velocity, length(velocity));
}

void equilibrium(float rho, vec2 u, out float f[9]) {
  float u2 = dot(u, u);
  for (int i = 0; i < 9; ++i) {
    float cu = dot(vec2(C[i]), u);
    f[i] = W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * u2);
  }
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int localX = p.x % u_tileW;

  // Mask is three-valued: >0.75 solid, ~0.5 fluid-adjacent-to-solid, 0 open fluid.
  // Solid nodes hold rest state; their f is never read by fluid neighbors — halfway
  // bounce-back reflects populations at the fluid node instead.
  float cell = texelFetch(u_solid, p, 0).r;
  if (cell > 0.75) {
    float rest[9];
    equilibrium(1.0, vec2(0.0), rest);
    storeF(rest, vec2(0.0));
    return;
  }

  if (localX == 0) {
    float inlet[9];
    equilibrium(1.0, vec2(u_uIn, 0.0), inlet);
    storeF(inlet, vec2(u_uIn, 0.0));
    return;
  }

  if (localX == u_tileW - 1) {
    ivec2 q = ivec2(p.x - 1, p.y);
    float outlet[9];
    float rho = 0.0;
    vec2 momentum = vec2(0.0);
    for (int i = 0; i < 9; ++i) {
      outlet[i] = loadF(q, i);
      rho += outlet[i];
      momentum += outlet[i] * vec2(C[i]);
    }
    storeF(outlet, momentum / max(rho, 1e-20));
    return;
  }

  // Stream-gather. For direction i the population arrives from q = p - c_i; if that
  // neighbor is solid the wall reflects this node's opposite post-collision population
  // back into slot i (equivalent to Sol's f_ī(x)=f_i*(x) push form). Only cells flagged
  // adjacent to solid run the per-link solid test; open fluid pure-streams (no extra fetch).
  float streamed[9];
  float rho = 0.0;
  vec2 momentum = vec2(0.0);
  if (cell > 0.25) {
    for (int i = 0; i < 9; ++i) {
      ivec2 q = p - C[i];
      streamed[i] = isSolid(q) ? loadF(p, OPP[i]) : loadF(q, i);
      rho += streamed[i];
      momentum += streamed[i] * vec2(C[i]);
    }
  } else {
    for (int i = 0; i < 9; ++i) {
      streamed[i] = loadF(p - C[i], i);
      rho += streamed[i];
      momentum += streamed[i] * vec2(C[i]);
    }
  }

  vec2 u = momentum / max(rho, 1e-20);
  float feq[9];
  equilibrium(rho, u, feq);

  float collided[9];
  for (int i = 0; i < 9; ++i) {
    int opposite = OPP[i];
    float fPlus = 0.5 * (streamed[i] + streamed[opposite]);
    float fMinus = 0.5 * (streamed[i] - streamed[opposite]);
    float eqPlus = 0.5 * (feq[i] + feq[opposite]);
    float eqMinus = 0.5 * (feq[i] - feq[opposite]);
    collided[i] = streamed[i]
      - u_omegaPlus * (fPlus - eqPlus)
      - u_omegaMinus * (fMinus - eqMinus);
  }
  storeF(collided, u);
}
