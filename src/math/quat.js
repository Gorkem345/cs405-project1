/**
 * Unit quaternions q = [x, y, z, w] for Bonus Quaternion Camera & SLERP.
 */
import * as vec3 from './vec3.js';

export function identity() {
  return [0, 0, 0, 1];
}

export function normalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-8) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Hamilton product a * b */
export function multiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Unit quaternion from axis [x, y, z] and angle in radians. */
export function fromAxisAngle(axis, rad) {
  const n = vec3.normalize(axis);
  const half = rad * 0.5;
  const s = Math.sin(half);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(half)];
}

/** Build orientation quaternion from camera yaw (around Y) and pitch (around local X). */
export function fromYawPitch(yaw, pitch) {
  const qYaw = fromAxisAngle([0, 1, 0], yaw);
  const qPitch = fromAxisAngle([1, 0, 0], -pitch);
  return normalize(multiply(qYaw, qPitch));
}

/** Extract [yaw, pitch] from a camera orientation quaternion. */
export function toYawPitch(q) {
  // Rotate local +Z offset vector [0, 0, 1] by q
  const dir = rotateVec3(q, [0, 0, 1]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
  const yaw = Math.atan2(dir[0], dir[2]);
  return [yaw, pitch];
}

/** Rotate a 3D vector v by unit quaternion q: v' = q * v * q^-1 */
export function rotateVec3(q, v) {
  const [qx, qy, qz, qw] = q;
  const uv = vec3.cross([qx, qy, qz], v);
  const uuv = vec3.cross([qx, qy, qz], uv);
  return [
    v[0] + 2 * (qw * uv[0] + uuv[0]),
    v[1] + 2 * (qw * uv[1] + uuv[1]),
    v[2] + 2 * (qw * uv[2] + uuv[2]),
  ];
}

/** Spherical Linear Interpolation (SLERP) along the shortest arc on S^3. */
export function slerp(q0, q1, t) {
  let [x0, y0, z0, w0] = normalize(q0);
  let [x1, y1, z1, w1] = normalize(q1);

  let cosTheta = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
  if (cosTheta < 0) {
    cosTheta = -cosTheta;
    x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1;
  }

  if (cosTheta > 0.9995) {
    return normalize([
      x0 + t * (x1 - x0),
      y0 + t * (y1 - y0),
      z0 + t * (z1 - z0),
      w0 + t * (w1 - w0),
    ]);
  }

  const theta = Math.acos(Math.min(1, cosTheta));
  const sinTheta = Math.sin(theta);
  const s0 = Math.sin((1 - t) * theta) / sinTheta;
  const s1 = Math.sin(t * theta) / sinTheta;

  return [
    s0 * x0 + s1 * x1,
    s0 * y0 + s1 * y1,
    s0 * z0 + s1 * z1,
    s0 * w0 + s1 * w1,
  ];
}