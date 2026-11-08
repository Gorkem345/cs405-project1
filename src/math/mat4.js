/**
 * mat4 — 4×4 matrices for Parts A and C.
 *
 * CONVENTIONS (the tests check exactly these):
 *   • A matrix is a Float32Array(16) in COLUMN-MAJOR order — the layout WebGPU
 *     expects for a mat4x4f in a uniform buffer. Element (row r, column c)
 *     lives at index  c * 4 + r.  The translation of an affine matrix is
 *     therefore at indices 12, 13, 14.
 *   • Column vectors: a point p is transformed as  M · p.
 *     multiply(A, B) returns A·B, so B is applied FIRST.
 *   • Right-handed world space. Angles in RADIANS. A positive angle rotates
 *     counter-clockwise when you look down the axis towards the origin
 *     (rotateZ(π/2) takes +x to +y).
 *   • View space: the camera sits at the origin and looks down −z, +y is up.
 *   • Clip space is WebGPU's: after the divide by w, x and y are in [−1, 1]
 *     and z is in [0, 1] (near → 0, far → 1). NOT OpenGL's [−1, 1].
 *
 * No maths libraries (no gl-matrix, no Three.js). Tests: tests/mat4.test.js
 */
import * as vec3 from './vec3.js';

/* ------------------------------------------------------------- Part A ---- */

/** The 4×4 identity. */
export function identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/** A · B (apply B first, then A). Must not modify a or b. */
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Translation by (tx, ty, tz). */
export function translate(tx, ty, tz) {
  return new Float32Array([
    1,  0,  0,  0,
    0,  1,  0,  0,
    0,  0,  1,  0,
    tx, ty, tz, 1,
  ]);
}

/** Rotation by `rad` about the x axis. */
export function rotateX(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([
    1,  0, 0, 0,
    0,  c, s, 0,
    0, -s, c, 0,
    0,  0, 0, 1,
  ]);
}

/** Rotation by `rad` about the y axis. */
export function rotateY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1,  0, 0,
    s, 0,  c, 0,
    0, 0,  0, 1,
  ]);
}

/** Rotation by `rad` about the z axis. */
export function rotateZ(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([
     c, s, 0, 0,
    -s, c, 0, 0,
     0, 0, 1, 0,
     0, 0, 0, 1,
  ]);
}

/** Non-uniform scale by (sx, sy, sz). */
export function scale(sx, sy, sz) {
  return new Float32Array([
    sx, 0,  0,  0,
    0,  sy, 0,  0,
    0,  0,  sz, 0,
    0,  0,  0,  1,
  ]);
}

/** Mᵀ */
export function transpose(m) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = m[r * 4 + c];
    }
  }
  return out;
}

/**
 * Inverse of a RIGID transform M = T·R (rotation + translation only, no scale).
 * M^-1 = [ R^T  -R^T * t ]
 *        [  0       1    ]
 */
export function invertRigid(m) {
  // Columns of R (which become rows of R^T)
  const c0x = m[0], c0y = m[1], c0z = m[2];
  const c1x = m[4], c1y = m[5], c1z = m[6];
  const c2x = m[8], c2y = m[9], c2z = m[10];

  // Translation vector t
  const tx = m[12], ty = m[13], tz = m[14];

  // -R^T * t
  const itx = -(c0x * tx + c0y * ty + c0z * tz);
  const ity = -(c1x * tx + c1y * ty + c1z * tz);
  const itz = -(c2x * tx + c2y * ty + c2z * tz);

  return new Float32Array([
    c0x, c1x, c2x, 0,
    c0y, c1y, c2y, 0,
    c0z, c1z, c2z, 0,
    itx, ity, itz, 1,
  ]);
}

/** M · v for a 4-component v = [x, y, z, w]; returns [x', y', z', w']. */
export function transformVec4(m, v) {
  const [x, y, z, w] = v;
  return [
    m[0] * x + m[4] * y + m[8]  * z + m[12] * w,
    m[1] * x + m[5] * y + m[9]  * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

/* ------------------------------------------------------------- Part C ---- */

/**
 * View matrix for a camera at `eye` looking at `target`, with `up` as the
 * approximate up direction. Built with two cross products.
 */
export function lookAt(eye, target, up) {
  // w points from target to eye (+z in view space, since camera looks down -z)
  const w = vec3.normalize(vec3.sub(eye, target));

  let rightRaw = vec3.cross(up, w);
  if (vec3.length(rightRaw) < 1e-6) {
    // Degenerate case: up is parallel to view direction w
    const fallbackUp = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    rightRaw = vec3.cross(fallbackUp, w);
  }

  const u = vec3.normalize(rightRaw);
  const v = vec3.cross(w, u);

  return new Float32Array([
    u[0], v[0], w[0], 0,
    u[1], v[1], w[1], 0,
    u[2], v[2], w[2], 0,
    -vec3.dot(u, eye), -vec3.dot(v, eye), -vec3.dot(w, eye), 1,
  ]);
}

/**
 * Perspective projection for WebGPU (depth z ∈ [0, 1]).
 */
export function perspective(fovY, aspect, near, far) {
  const f = 1.0 / Math.tan(fovY / 2.0);
  const nf = 1.0 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0,                   0,
    0,          f, 0,                   0,
    0,          0, far * nf,           -1,
    0,          0, near * far * nf,     0,
  ]);
}

/**
 * Orthographic projection for WebGPU (depth z ∈ [0, 1]) of the box
 * x ∈ [left, right], y ∈ [bottom, top], z ∈ [−near, −far] in view space.
 */
export function orthographic(left, right, bottom, top, near, far) {
  const rl = 1.0 / (right - left);
  const tb = 1.0 / (top - bottom);
  const nf = 1.0 / (near - far);

  return new Float32Array([
    2.0 * rl,                0,                       0,         0,
    0,                       2.0 * tb,                0,         0,
    0,                       0,                       nf,        0,
    -(right + left) * rl,    -(top + bottom) * tb,    near * nf, 1,
  ]);
}

/* ------------------------------------------------- provided (not graded) - */

export function format(m, digits = 2) {
  if (!m) return '(none)';
  const w = digits + 4;
  let s = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) s += (+m[c * 4 + r]).toFixed(digits).padStart(w);
    if (r < 3) s += '\n';
  }
  return s;
}
