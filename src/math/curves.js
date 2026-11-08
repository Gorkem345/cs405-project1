/**
 * curves — Part D.
 *
 * Points are plain arrays of any dimension: [x, y] in the plane of the
 * painting, or [x, y, z] in world space. Every function must work for both
 * (the tests use 2D and 3D). Return new arrays; never modify the inputs.
 *
 * A piecewise cubic Bézier curve is an array of segments, each segment being
 * four control points [P0, P1, P2, P3]. Consecutive segments share a joint:
 * segments[i][3] equals segments[i + 1][0].
 *
 * Tests: tests/curves.test.js
 */

/* ---------------------------------------------------------- Bézier ------ */

/** The four cubic Bernstein basis values [B0(t), B1(t), B2(t), B3(t)]. */
export function bernstein3(t) {
  const u = 1 - t;
  return [
    u * u * u,
    3 * u * u * t,
    3 * u * t * t,
    t * t * t,
  ];
}

/** Point on the cubic Bézier curve with control points p0..p3 at t ∈ [0, 1]. */
export function cubicBezier(p0, p1, p2, p3, t) {
  const [b0, b1, b2, b3] = bernstein3(t);
  return p0.map((_, i) => b0 * p0[i] + b1 * p1[i] + b2 * p2[i] + b3 * p3[i]);
}

/** First derivative dB/dt of the cubic Bézier at t (not normalised). */
export function cubicBezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const c0 = 3 * u * u;
  const c1 = 6 * u * t;
  const c2 = 3 * t * t;
  return p0.map(
    (_, i) => c0 * (p1[i] - p0[i]) + c1 * (p2[i] - p1[i]) + c2 * (p3[i] - p2[i])
  );
}

/**
 * de Casteljau's construction for any number of control points.
 * Returns every level:
 *   levels[0] = the input points (n points)
 *   levels[1] = n − 1 interpolated points
 *   …
 *   levels[n − 1] = [the point on the curve]
 */
export function deCasteljau(points, t) {
  const levels = [points.map((p) => [...p])];
  let current = levels[0];
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      next.push(a.map((v, d) => v + (b[d] - v) * t));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

/* ----------------------------------------------- piecewise, C¹ joints --- */

/**
 * Given the last two control points P2, P3 of one segment, return the P1 of
 * the NEXT segment that makes the joint at P3 C¹-continuous:
 *   3(P3 − P2) = 3(P1_next − P3)  ⟹  P1_next = 2·P3 − P2
 */
export function c1NextControl(p2, p3) {
  return p2.map((v, i) => 2 * p3[i] - v);
}

/**
 * Evaluate a piecewise cubic Bézier at a global parameter u ∈ [0, 1].
 */
export function evalPiecewise(segments, u) {
  const n = segments.length;
  if (u <= 0) return cubicBezier(...segments[0], 0);
  if (u >= 1) return cubicBezier(...segments[n - 1], 1);
  const s = u * n;
  const idx = Math.min(n - 1, Math.floor(s));
  const localT = s - idx;
  return cubicBezier(...segments[idx], localT);
}

/**
 * Evaluate the tangent of a piecewise cubic Bézier at global parameter u ∈ [0, 1].
 */
export function evalPiecewiseTangent(segments, u) {
  const n = segments.length;
  if (u <= 0) return cubicBezierTangent(...segments[0], 0);
  if (u >= 1) return cubicBezierTangent(...segments[n - 1], 1);
  const s = u * n;
  const idx = Math.min(n - 1, Math.floor(s));
  const localT = s - idx;
  return cubicBezierTangent(...segments[idx], localT);
}

/* ---------------------------- second curve family ----------------------- */

/**
 * Uniform Catmull–Rom: the segment between p1 and p2 (passes through both),
 * t ∈ [0, 1], with tangents (p2 − p0)/2 at p1 and (p3 − p1)/2 at p2.
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return p0.map((_, i) => {
    const a = p0[i], b = p1[i], c = p2[i], d = p3[i];
    return 0.5 * (
      2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3
    );
  });
}

/** First derivative of Uniform Catmull–Rom segment at t ∈ [0, 1]. */
export function catmullRomTangent(p0, p1, p2, p3, t) {
  const t2 = t * t;
  return p0.map((_, i) => {
    const a = p0[i], b = p1[i], c = p2[i], d = p3[i];
    return 0.5 * (
      (-a + c) +
      2 * (2 * a - 5 * b + 4 * c - d) * t +
      3 * (-a + 3 * b - 3 * c + d) * t2
    );
  });
}

/** Uniform cubic B-spline basis values [N0(t), N1(t), N2(t), N3(t)]. */
export function bsplineBasis(t) {
  const u = 1 - t;
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    (u * u * u) / 6,
    (3 * t3 - 6 * t2 + 4) / 6,
    (-3 * t3 + 3 * t2 + 3 * t + 1) / 6,
    t3 / 6,
  ];
}

/** Point on the uniform cubic B-spline segment controlled by p0..p3. */
export function bspline(p0, p1, p2, p3, t) {
  const [n0, n1, n2, n3] = bsplineBasis(t);
  return p0.map((_, i) => n0 * p0[i] + n1 * p1[i] + n2 * p2[i] + n3 * p3[i]);
}

/** First derivative of uniform cubic B-spline segment at t ∈ [0, 1]. */
export function bsplineTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const t2 = t * t;
  const d0 = -0.5 * u * u;
  const d1 = 1.5 * t2 - 2 * t;
  const d2 = -1.5 * t2 + t + 0.5;
  const d3 = 0.5 * t2;
  return p0.map((_, i) => d0 * p0[i] + d1 * p1[i] + d2 * p2[i] + d3 * p3[i]);
}

/* ---------------------------- Bonus: Least-Squares Bézier Fitting ------- */

export function fitCubicBezierSegment(points) {
  const m = points.length - 1;
  const dim = points[0].length;
  const p0 = [...points[0]];
  const p3 = [...points[m]];

  if (m < 2) {
    const p1 = p0.map((v, d) => v + (p3[d] - v) / 3);
    const p2 = p0.map((v, d) => v + (2 * (p3[d] - v)) / 3);
    return [p0, p1, p2, p3];
  }

  // 1. Chord-length parameterisation t_k ∈ [0, 1]
  const dists = [0];
  let totalLen = 0;
  for (let k = 1; k <= m; k++) {
    let sq = 0;
    for (let d = 0; d < dim; d++) {
      const diff = points[k][d] - points[k - 1][d];
      sq += diff * diff;
    }
    totalLen += Math.sqrt(sq);
    dists.push(totalLen);
  }
  const tVals = totalLen > 1e-8
    ? dists.map((d) => d / totalLen)
    : points.map((_, k) => k / m);

  // 2. Build normal equation coefficients C * [P1, P2]^T = X
  let c11 = 0, c12 = 0, c22 = 0;
  const x1 = new Array(dim).fill(0);
  const x2 = new Array(dim).fill(0);

  for (let k = 1; k < m; k++) {
    const [b0, b1, b2, b3] = bernstein3(tVals[k]);
    c11 += b1 * b1;
    c12 += b1 * b2;
    c22 += b2 * b2;
    for (let d = 0; d < dim; d++) {
      const rhs = points[k][d] - b0 * p0[d] - b3 * p3[d];
      x1[d] += b1 * rhs;
      x2[d] += b2 * rhs;
    }
  }

  const det = c11 * c22 - c12 * c12;
  if (Math.abs(det) < 1e-8) {
    const p1 = p0.map((v, d) => v + (p3[d] - v) / 3);
    const p2 = p0.map((v, d) => v + (2 * (p3[d] - v)) / 3);
    return [p0, p1, p2, p3];
  }

  const p1 = x1.map((_, d) => (c22 * x1[d] - c12 * x2[d]) / det);
  const p2 = x2.map((_, d) => (c11 * x2[d] - c12 * x1[d]) / det);
  return [p0, p1, p2, p3];
}

/**
 * Fit a 3-segment C¹-continuous piecewise cubic Bézier (10 control points)
 * to a hand-traced polyline of points.
 */
export function fitPiecewiseBezierC1(strokePoints) {
  if (strokePoints.length < 4) return null;
  const n = strokePoints.length;
  const i1 = Math.max(1, Math.floor(n / 3));
  const i2 = Math.max(i1 + 1, Math.floor((2 * n) / 3));

  const seg0 = fitCubicBezierSegment(strokePoints.slice(0, i1 + 1));
  const seg1 = fitCubicBezierSegment(strokePoints.slice(i1, i2 + 1));
  const seg2 = fitCubicBezierSegment(strokePoints.slice(i2));

  // Enforce exact C¹ continuity at the two interior knots (seg0[3] and seg1[3])
  // by averaging the fitted outgoing/incoming tangent vectors
  const k1 = seg0[3];
  const tan1 = k1.map((_, d) => 0.5 * ((k1[d] - seg0[2][d]) + (seg1[1][d] - k1[d])));
  const p2 = k1.map((v, d) => v - tan1[d]);
  const p4 = k1.map((v, d) => v + tan1[d]);

  const k2 = seg1[3];
  const tan2 = k2.map((_, d) => 0.5 * ((k2[d] - seg1[2][d]) + (seg2[1][d] - k2[d])));
  const p5 = k2.map((v, d) => v - tan2[d]);
  const p7 = k2.map((v, d) => v + tan2[d]);

  return [
    seg0[0], seg0[1], p2,
    k1, p4, p5,
    k2, p7, seg2[2],
    seg2[3],
  ];
}