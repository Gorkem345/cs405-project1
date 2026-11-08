/**
 * Curve export — Part D.
 */

/**
 * Convert world-space curve data on the painting quad (x ∈ [−a, a], y ∈ [−1, 1])
 * into normalised painting coordinates u, v ∈ [0, 1] (top-left origin).
 *
 * @param {object} curve
 * @param {string} curve.painting   painting id (e.g. 'kavunlu')
 * @param {string} curve.kind       'bezier-c1' | 'catmull-rom' | 'bspline'
 * @param {number} [curve.aspect=1] painting width / height
 * @param {Array}  [curve.segments] array of 4-point segments (in world [x,y] or normalised)
 * @param {Array}  [curve.points]   array of points (in world [x,y] or normalised)
 * @param {boolean} [curve.alreadyNormalised=false]
 */
export function curveToJSON(curve) {
  const a = curve.aspect || 1;
  const normPt = (p) => {
    if (curve.alreadyNormalised) {
      return [+p[0].toFixed(4), +p[1].toFixed(4)];
    }
    const u = (p[0] + a) / (2 * a);
    const v = (1 - p[1]) / 2;
    return [+u.toFixed(4), +v.toFixed(4)];
  };

  const out = {
    painting: curve.painting ?? 'kavunlu',
    kind: curve.kind ?? 'bezier-c1',
  };

  if (curve.segments) {
    out.segments = curve.segments.map((seg) => seg.map(normPt));
  }
  if (curve.points) {
    out.points = curve.points.map(normPt);
  }
  return out;
}

/** Provided: save any object as a .json download in the browser. */
export function downloadJSON(obj, filename = 'curve.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}