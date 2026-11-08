/**
 * Used AI assistance to complete scene.js
 * Complete Scene implementation covering Parts A, B, C (frustum visualiser),
 * Part D (interactive curves over the painting), and Bonus extensions
 * (Surface of Revolution, Extruded Ribbon Mesh, and Least-Squares Bézier Fitting).
 */
import * as mat4 from '../math/mat4.js';
import * as vec3 from '../math/vec3.js';
import * as curves from '../math/curves.js';
import { SceneNode } from './node.js';
import { PrimitiveRenderer } from '../render/primitives.js';
import { curveToJSON, downloadJSON } from './curveExport.js';

function initialControlPoints() {
  const pts = [
    [-0.65, -0.38], // 0: Knot 0
    [-0.45, -0.05], // 1: Handle
    [-0.22,  0.14], // 2: Handle
    [-0.02,  0.18], // 3: Knot 1 (Joint)
    [ 0.18,  0.22], // 4: Handle (C¹ mirror of 2 across 3)
    [ 0.42,  0.12], // 5: Handle
    [ 0.60, -0.08], // 6: Knot 2 (Joint)
    [ 0.78, -0.28], // 7: Handle (C¹ mirror of 5 across 6)
    [ 0.84, -0.46], // 8: Handle
    [ 0.72, -0.64], // 9: Knot 3
  ];
  pts[4] = curves.c1NextControl(pts[2], pts[3]);
  pts[7] = curves.c1NextControl(pts[5], pts[6]);
  return pts;
}

export function createScene({ gpu, renderer, painting, panel, getPaintingId }) {
  const prims = new PrimitiveRenderer(gpu, renderer);

  const defaults = {
    debugAxes: true,
    // Part A state
    trsOrder: true,
    tx: -0.85,
    ty: -0.45,
    tz: 0.45,
    rx: 0.25,
    ry: 0.60,
    rz: 0.35,
    scale: 0.32,
    // Part B state
    animateGraph: true,
    baseYaw: 0.4,
    joint1Angle: -0.45,
    joint2Angle: 0.65,
    wristSpin: 0.0,
    // Part D state
    curveKind: 'bezier-c1',
    paramT: 0.45,
    animateCurve: true,
    showDeCasteljau: true,
    showControlPoly: true,
    // Bonus state
    surfaceMode: 'off', // 'off' | 'extrusion' | 'revolution'
    extrudeDepth: 0.22,
  };

  const state = { ...defaults };
  let controlPoints = initialControlPoints();
  let freehandStroke = [];

  /* =======================================================================
   * PART B: Scene Graph Construction (4 levels, 6 nodes)
   * ======================================================================= */
  const rootNode = new SceneNode('table_base');
  const turntableNode = rootNode.addChild(new SceneNode('turntable'));
  const lowerArmNode = turntableNode.addChild(new SceneNode('lower_arm'));
  const upperArmNode = lowerArmNode.addChild(new SceneNode('upper_arm'));
  const wristNode = upperArmNode.addChild(new SceneNode('wrist'));
  const lanternLeafNode = wristNode.addChild(new SceneNode('lantern_leaf'));

  function updateSceneGraphMatrices() {
    rootNode.local = mat4.translate(0.95, -0.75, 0.50);
    turntableNode.local = mat4.multiply(
      mat4.translate(0, 0.12, 0),
      mat4.rotateY(state.baseYaw)
    );
    lowerArmNode.local = mat4.multiply(
      mat4.translate(0, 0.08, 0),
      mat4.rotateZ(state.joint1Angle)
    );
    upperArmNode.local = mat4.multiply(
      mat4.translate(0, 0.45, 0),
      mat4.rotateZ(state.joint2Angle)
    );
    wristNode.local = mat4.multiply(
      mat4.translate(0, 0.38, 0),
      mat4.rotateY(state.wristSpin)
    );
    lanternLeafNode.local = mat4.translate(0.18, -0.12, 0);

    rootNode.updateWorld();
  }

  /* =======================================================================
   * UI Panel Controls
   * ======================================================================= */
  const uiControllers = [];
  const track = (ctrl) => { uiControllers.push(ctrl); return ctrl; };

  const fScene = panel.folder('Scene & Debug');
  track(fScene.toggle('debug local axes', state, 'debugAxes'));

  const fA = panel.folder('Part A · Transformations');
  track(fA.toggle('use T·R·S (off = S·R·T)', state, 'trsOrder'));
  track(fA.slider('translate x', state, 'tx', -1.8, 1.8, 0.02));
  track(fA.slider('translate y', state, 'ty', -1.2, 1.2, 0.02));
  track(fA.slider('translate z', state, 'tz', 0.1, 1.5, 0.02));
  track(fA.slider('rotate x (rad)', state, 'rx', -Math.PI, Math.PI, 0.02));
  track(fA.slider('rotate y (rad)', state, 'ry', -Math.PI, Math.PI, 0.02));
  track(fA.slider('rotate z (rad)', state, 'rz', -Math.PI, Math.PI, 0.02));
  track(fA.slider('scale', state, 'scale', 0.1, 0.8, 0.01));
  const matReadoutA = fA.text('');

  const fB = panel.folder('Part B · Scene Graph');
  track(fB.toggle('animate hierarchy', state, 'animateGraph'));
  track(fB.slider('turntable yaw', state, 'baseYaw', -Math.PI, Math.PI, 0.02));
  track(fB.slider('lower arm z', state, 'joint1Angle', -1.4, 1.4, 0.02));
  track(fB.slider('upper arm z', state, 'joint2Angle', -1.6, 1.6, 0.02));
  const matReadoutB = fB.text('');

  const fD = panel.folder('Part D · Curves');
  const kindSel = fD.select(
    'curve family',
    [
      { value: 'bezier-c1', label: 'Piecewise Cubic Bézier (C¹)' },
      { value: 'catmull-rom', label: 'Catmull–Rom Spline' },
      { value: 'bspline', label: 'Uniform Cubic B-Spline' },
    ],
    state.curveKind,
    (v) => { state.curveKind = v; }
  );
  const tSlider = track(fD.slider('parameter t', state, 'paramT', 0, 1, 0.005));
  track(fD.toggle('animate object on curve', state, 'animateCurve'));
  track(fD.toggle('de Casteljau construction', state, 'showDeCasteljau'));
  track(fD.toggle('show control polygon', state, 'showControlPoly'));

  const curveReadout = fD.text('');
  fD.button('export curve JSON', () => {
    const json = buildExportJSON();
    curveReadout.set(JSON.stringify(json, null, 2));
    downloadJSON(json, `${json.painting}-${json.kind}.json`);
  });

  // Bonus Folder
  const fBonus = panel.folder('Bonus · Swept Surface & Curve Fit');
  const surfSel = fBonus.select(
    'swept surface',
    [
      { value: 'off', label: 'Off' },
      { value: 'extrusion', label: '3D Extruded Ribbon on Painting' },
      { value: 'revolution', label: '3D Surface of Revolution (Lathe)' },
    ],
    state.surfaceMode,
    (v) => { state.surfaceMode = v; }
  );
  track(fBonus.slider('extrusion depth', state, 'extrudeDepth', 0.05, 0.5, 0.01));
  fBonus.note('Hold Alt + Left-Drag on the painting to trace a shape by hand and fit a Least-Squares C¹ Bézier curve.');

  /* =======================================================================
   * Part D & Bonus Curve Helpers
   * ======================================================================= */
  function getBezierSegments() {
    const segs = [];
    for (let i = 0; i + 3 < controlPoints.length; i += 3) {
      segs.push([
        controlPoints[i],
        controlPoints[i + 1],
        controlPoints[i + 2],
        controlPoints[i + 3],
      ]);
    }
    return segs;
  }

  function evaluateCurveAndTangent(u) {
    const clampedU = Math.max(0, Math.min(1, u));
    if (state.curveKind === 'bezier-c1') {
      const segs = getBezierSegments();
      return {
        point: curves.evalPiecewise(segs, clampedU),
        tangent: curves.evalPiecewiseTangent(segs, clampedU),
      };
    }

    const pts = controlPoints;
    if (state.curveKind === 'catmull-rom') {
      const knots = [pts[0], pts[3], pts[6], pts[9]];
      const padded = [knots[0], ...knots, knots[knots.length - 1]];
      const spans = knots.length - 1;
      const s = Math.min(spans - 1e-7, clampedU * spans);
      const i = Math.floor(s);
      const localT = s - i;
      return {
        point: curves.catmullRom(padded[i], padded[i + 1], padded[i + 2], padded[i + 3], localT),
        tangent: curves.catmullRomTangent(padded[i], padded[i + 1], padded[i + 2], padded[i + 3], localT),
      };
    }

    const spans = pts.length - 3;
    const s = Math.min(spans - 1e-7, clampedU * spans);
    const i = Math.floor(s);
    const localT = s - i;
    return {
      point: curves.bspline(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], localT),
      tangent: curves.bsplineTangent(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], localT),
    };
  }

  function buildExtrudedRibbonMesh(steps = 70) {
    const out = [];
    const z0 = 0.015;
    const z1 = z0 + state.extrudeDepth;
    const samples = [];
    for (let i = 0; i <= steps; i++) {
      const { point, tangent } = evaluateCurveAndTangent(i / steps);
      const nx = -tangent[1];
      const ny = tangent[0];
      const len = Math.hypot(nx, ny) || 1;
      samples.push({ p: point, n: [nx / len, ny / len, 0] });
    }
    for (let i = 0; i < steps; i++) {
      const A = samples[i], B = samples[i + 1];
      const p00 = [A.p[0], A.p[1], z0], p01 = [A.p[0], A.p[1], z1];
      const p10 = [B.p[0], B.p[1], z0], p11 = [B.p[0], B.p[1], z1];
      out.push(
        ...p00, ...A.n, ...p10, ...B.n, ...p11, ...B.n,
        ...p00, ...A.n, ...p11, ...B.n, ...p01, ...A.n
      );
    }
    return new Float32Array(out);
  }

  function buildRevolutionMesh(uSteps = 36, thetaSteps = 28) {
    const out = [];
    // Revolve the curve's radial profile around a local vertical Y axis
    const xCenter =
      controlPoints.reduce((acc, p) => acc + p[0], 0) / controlPoints.length;
    const yCenter =
      controlPoints.reduce((acc, p) => acc + p[1], 0) / controlPoints.length;

    const profile = [];
    for (let i = 0; i <= uSteps; i++) {
      const { point, tangent } = evaluateCurveAndTangent(i / uSteps);
      const r = Math.max(0.03, Math.abs(point[0] - xCenter) * 0.45);
      const y = (point[1] - yCenter) * 0.65;
      const dr = (point[0] >= xCenter ? 1 : -1) * tangent[0] * 0.45;
      const dy = tangent[1] * 0.65;
      const nLen = Math.hypot(dy, -dr) || 1;
      profile.push({ r, y, nr: dy / nLen, ny: -dr / nLen });
    }

    for (let i = 0; i < uSteps; i++) {
      const pA = profile[i], pB = profile[i + 1];
      for (let j = 0; j < thetaSteps; j++) {
        const a0 = (j / thetaSteps) * Math.PI * 2;
        const a1 = ((j + 1) / thetaSteps) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);

        const v00 = [pA.r * c0, pA.y, pA.r * s0], n00 = [pA.nr * c0, pA.ny, pA.nr * s0];
        const v01 = [pA.r * c1, pA.y, pA.r * s1], n01 = [pA.nr * c1, pA.ny, pA.nr * s1];
        const v10 = [pB.r * c0, pB.y, pB.r * s0], n10 = [pB.nr * c0, pB.ny, pB.nr * s0];
        const v11 = [pB.r * c1, pB.y, pB.r * s1], n11 = [pB.nr * c1, pB.ny, pB.nr * s1];

        out.push(
          ...v00, ...n00, ...v10, ...n10, ...v11, ...n11,
          ...v00, ...n00, ...v11, ...n11, ...v01, ...n01
        );
      }
    }
    return new Float32Array(out);
  }

  function enforceC1FromMovedIndex(movedIdx) {
    for (const k of [3, 6]) {
      if (movedIdx === k - 1) {
        controlPoints[k + 1] = curves.c1NextControl(controlPoints[k - 1], controlPoints[k]);
      } else if (movedIdx === k + 1) {
        controlPoints[k - 1] = curves.c1NextControl(controlPoints[k + 1], controlPoints[k]);
      }
    }
  }

  function buildExportJSON() {
    const paintingId = getPaintingId ? getPaintingId() : 'kavunlu';
    if (state.curveKind === 'bezier-c1') {
      return curveToJSON({
        painting: paintingId,
        kind: 'bezier-c1',
        aspect: painting.aspect,
        segments: getBezierSegments(),
      });
    }
    const exportedPts =
      state.curveKind === 'catmull-rom'
        ? [controlPoints[0], controlPoints[3], controlPoints[6], controlPoints[9]]
        : controlPoints;
    return curveToJSON({
      painting: paintingId,
      kind: state.curveKind,
      aspect: painting.aspect,
      points: exportedPts,
    });
  }

  let draggedPointIndex = -1;

  function pickControlPoint(worldXY) {
    const thresholdSq = 0.065 * 0.065;
    let bestIdx = -1;
    let bestDistSq = thresholdSq;
    controlPoints.forEach((p, idx) => {
      if (state.curveKind === 'catmull-rom' && idx % 3 !== 0) return;
      const dx = p[0] - worldXY[0];
      const dy = p[1] - worldXY[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = idx;
      }
    });
    draggedPointIndex = bestIdx;
    return bestIdx !== -1;
  }

  function dragControlPoint(worldXY) {
    if (draggedPointIndex < 0) return false;
    const idx = draggedPointIndex;
    const prev = controlPoints[idx];
    const dx = worldXY[0] - prev[0];
    const dy = worldXY[1] - prev[1];

    controlPoints[idx] = [worldXY[0], worldXY[1]];

    if (state.curveKind === 'bezier-c1' && idx % 3 === 0) {
      if (idx - 1 >= 0) {
        controlPoints[idx - 1] = [
          controlPoints[idx - 1][0] + dx,
          controlPoints[idx - 1][1] + dy,
        ];
      }
      if (idx + 1 < controlPoints.length) {
        controlPoints[idx + 1] = [
          controlPoints[idx + 1][0] + dx,
          controlPoints[idx + 1][1] + dy,
        ];
      }
    } else if (state.curveKind === 'bezier-c1') {
      enforceC1FromMovedIndex(idx);
    }
    return true;
  }

  function releaseControlPoint() {
    draggedPointIndex = -1;
  }

  /* ---- Bonus Freehand Least-Squares Tracing ---- */
  function startFreehandTrace(worldXY) {
    freehandStroke = [[worldXY[0], worldXY[1]]];
  }

  function appendFreehandTrace(worldXY) {
    if (!freehandStroke.length) return;
    const last = freehandStroke[freehandStroke.length - 1];
    if (Math.hypot(worldXY[0] - last[0], worldXY[1] - last[1]) > 0.015) {
      freehandStroke.push([worldXY[0], worldXY[1]]);
    }
  }

  function finishFreehandTrace() {
    if (freehandStroke.length >= 6) {
      const fitted = curves.fitPiecewiseBezierC1(freehandStroke);
      if (fitted) {
        controlPoints = fitted;
        state.curveKind = 'bezier-c1';
        kindSel.set('bezier-c1');
      }
    }
    freehandStroke = [];
  }

  /* =======================================================================
   * Part C Helper: Draw Camera Frustum in World Space
   * ======================================================================= */
  function drawCameraFrustum(pass, viewProj, cam, aspect) {
    const forward = vec3.normalize(vec3.sub(cam.target, cam.eye));
    let rightRaw = vec3.cross(forward, cam.up);
    if (vec3.length(rightRaw) < 1e-6) {
      const fb = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      rightRaw = vec3.cross(forward, fb);
    }
    const right = vec3.normalize(rightRaw);
    const up = vec3.cross(right, forward);

    const cornerAt = (dist, sx, sy) => {
      const halfH =
        cam.projection === 'orthographic'
          ? cam.orthoHeight / 2
          : Math.tan(cam.fovY / 2) * dist;
      const halfW = halfH * aspect;
      const center = vec3.add(cam.eye, vec3.scale(forward, dist));
      return vec3.add(
        center,
        vec3.add(vec3.scale(right, sx * halfW), vec3.scale(up, sy * halfH))
      );
    };

    const nearCorners = [
      cornerAt(cam.near, -1, -1),
      cornerAt(cam.near,  1, -1),
      cornerAt(cam.near,  1,  1),
      cornerAt(cam.near, -1,  1),
    ];
    const farCorners = [
      cornerAt(cam.far, -1, -1),
      cornerAt(cam.far,  1, -1),
      cornerAt(cam.far,  1,  1),
      cornerAt(cam.far, -1,  1),
    ];

    const lines = [];
    const pushSeg = (a, b, col) => {
      lines.push(a[0], a[1], a[2], col[0], col[1], col[2]);
      lines.push(b[0], b[1], b[2], col[0], col[1], col[2]);
    };

    const colNear = [1.0, 0.45, 0.15];
    const colFar  = [0.25, 0.75, 1.0];
    const colEdge = [0.95, 0.75, 0.25];
    const colRay  = [0.4, 0.95, 0.45];

    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      pushSeg(nearCorners[i], nearCorners[next], colNear);
      pushSeg(farCorners[i], farCorners[next], colFar);
      pushSeg(nearCorners[i], farCorners[i], colEdge);
      pushSeg(cam.eye, nearCorners[i], [0.7, 0.35, 0.2]);
    }
    pushSeg(cam.eye, cam.target, colRay);

    prims.drawLines(pass, viewProj, new Float32Array(lines));
    prims.drawCube(
      pass,
      viewProj,
      mat4.multiply(mat4.translate(...cam.eye), mat4.scale(0.08, 0.08, 0.08)),
      [1.0, 0.3, 0.1]
    );
    prims.drawCube(
      pass,
      viewProj,
      mat4.multiply(mat4.translate(...cam.target), mat4.scale(0.06, 0.06, 0.06)),
      [0.2, 0.9, 0.3]
    );
  }

  /* =======================================================================
   * Update & Draw Loop
   * ======================================================================= */
  let partAMatTRS = mat4.identity();
  let partAMatSRT = mat4.identity();
  let partAActiveModel = mat4.identity();

  updateSceneGraphMatrices();

  return {
    state,
    pickControlPoint,
    dragControlPoint,
    releaseControlPoint,
    startFreehandTrace,
    appendFreehandTrace,
    finishFreehandTrace,
    drawCameraFrustum,

    update(dt, time) {
      const T = mat4.translate(state.tx, state.ty, state.tz);
      const R = mat4.multiply(
        mat4.rotateZ(state.rz),
        mat4.multiply(mat4.rotateY(state.ry), mat4.rotateX(state.rx))
      );
      const S = mat4.scale(state.scale, state.scale, state.scale);

      partAMatTRS = mat4.multiply(T, mat4.multiply(R, S));
      partAMatSRT = mat4.multiply(S, mat4.multiply(R, T));
      partAActiveModel = state.trsOrder ? partAMatTRS : partAMatSRT;

      matReadoutA.set(
        `Active: ${state.trsOrder ? 'M = T · R · S' : 'M = S · R · T'}\n` +
        `--- M = T · R · S ---\n${mat4.format(partAMatTRS)}\n\n` +
        `--- M = S · R · T ---\n${mat4.format(partAMatSRT)}`
      );

      if (state.animateGraph) {
        state.joint1Angle = Math.sin(time * 1.4) * 0.55;
        state.joint2Angle = Math.cos(time * 1.9) * 0.75;
        state.wristSpin = time * 1.8;
      }
      updateSceneGraphMatrices();

      const leafPos = mat4.transformVec4(lanternLeafNode.world, [0, 0, 0, 1]);
      matReadoutB.set(
        `Hierarchy (4 levels, 6 nodes):\n` +
        `table_base → turntable → lower_arm\n` +
        `  → upper_arm → wrist → lantern_leaf\n` +
        `--- world(lantern_leaf) ---\n${mat4.format(lanternLeafNode.world)}\n` +
        `leaf pos: (${leafPos[0].toFixed(2)}, ${leafPos[1].toFixed(2)}, ${leafPos[2].toFixed(2)})`
      );

      if (state.animateCurve) {
        state.paramT = (state.paramT + dt * 0.18) % 1.0;
        tSlider.update();
      }
      const { point: cp } = evaluateCurveAndTangent(state.paramT);
      curveReadout.set(
        `family: ${state.curveKind}  (t = ${state.paramT.toFixed(3)})\n` +
        `C(t) world: (${cp[0].toFixed(3)}, ${cp[1].toFixed(3)}, 0.000)`
      );
    },

    draw(pass, viewProj) {
      prims.beginFrame();

      /* ---- PART A: Three objects in front of the painting (z > 0) ---- */
      prims.drawCube(pass, viewProj, partAActiveModel, [0.85, 0.32, 0.14]);
      if (state.debugAxes) prims.drawAxes(pass, viewProj, partAActiveModel);

      const obj2Model = mat4.multiply(
        mat4.translate(-1.25, -0.68, 0.30),
        mat4.multiply(mat4.rotateY(0.45), mat4.scale(0.26, 0.26, 0.26))
      );
      prims.drawCube(pass, viewProj, obj2Model, [0.16, 0.48, 0.72]);
      if (state.debugAxes) prims.drawAxes(pass, viewProj, obj2Model);

      const obj3Model = mat4.multiply(
        mat4.translate(-0.15, -0.82, 0.35),
        mat4.multiply(mat4.rotateY(-0.3), mat4.scale(0.38, 0.16, 0.24))
      );
      prims.drawCube(pass, viewProj, obj3Model, [0.25, 0.62, 0.32]);
      if (state.debugAxes) prims.drawAxes(pass, viewProj, obj3Model);

      /* ---- PART B: Scene Graph Drawing (6 nodes across 4 levels) ---- */
      prims.drawCube(
        pass,
        viewProj,
        mat4.multiply(rootNode.world, mat4.scale(0.42, 0.10, 0.42)),
        [0.45, 0.42, 0.38]
      );
      prims.drawCube(
        pass,
        viewProj,
        mat4.multiply(turntableNode.world, mat4.scale(0.26, 0.08, 0.26)),
        [0.65, 0.55, 0.20]
      );
      prims.drawCube(
        pass,
        viewProj,
        mat4.multiply(
          lowerArmNode.world,
          mat4.multiply(mat4.translate(0, 0.225, 0), mat4.scale(0.09, 0.45, 0.09))
        ),
        [0.18, 0.46, 0.68]
      );
      prims.drawCube(
        pass,
        viewProj,
        mat4.multiply(
          upperArmNode.world,
          mat4.multiply(mat4.translate(0, 0.19, 0), mat4.scale(0.075, 0.38, 0.075))
        ),
        [0.78, 0.32, 0.18]
      );
      prims.drawCube(
        pass,
        viewProj,
        mat4.multiply(wristNode.world, mat4.scale(0.36, 0.05, 0.07)),
        [0.82, 0.68, 0.18]
      );
      prims.drawCube(
        pass,
        viewProj,
        mat4.multiply(lanternLeafNode.world, mat4.scale(0.12, 0.18, 0.12)),
        [0.95, 0.78, 0.22]
      );

      if (state.debugAxes) {
        rootNode.traverse((node) => {
          prims.drawAxes(pass, viewProj, node.world);
        });
      }

      /* ---- BONUS: Swept Surface Mesh (Extrusion or Surface of Revolution) ---- */
      if (state.surfaceMode === 'extrusion') {
        const meshData = buildExtrudedRibbonMesh();
        prims.drawDynamicMesh(pass, viewProj, mat4.identity(), meshData, [0.92, 0.62, 0.18]);
      } else if (state.surfaceMode === 'revolution') {
        const meshData = buildRevolutionMesh();
        const revModel = mat4.translate(0.32, -0.55, 0.55);
        prims.drawDynamicMesh(pass, viewProj, revModel, meshData, [0.82, 0.52, 0.22]);
        if (state.debugAxes) prims.drawAxes(pass, viewProj, revModel);
      }

      /* ---- PART D: Curves Over the Painting (at z = 0.012 offset) ---- */
      const zCurve = 0.012;
      const lineVerts = [];
      const addLine = (pA, pB, col, z = zCurve) => {
        lineVerts.push(pA[0], pA[1], z, col[0], col[1], col[2]);
        lineVerts.push(pB[0], pB[1], z, col[0], col[1], col[2]);
      };

      const samples = 180;
      const curveColor = [1.0, 0.84, 0.15];
      let prevPt = evaluateCurveAndTangent(0).point;
      for (let i = 1; i <= samples; i++) {
        const curPt = evaluateCurveAndTangent(i / samples).point;
        addLine(prevPt, curPt, curveColor, zCurve);
        prevPt = curPt;
      }

      // Freehand stroke preview while Alt+Dragging
      if (freehandStroke.length > 1) {
        for (let i = 0; i < freehandStroke.length - 1; i++) {
          addLine(freehandStroke[i], freehandStroke[i + 1], [0.2, 1.0, 0.5], zCurve + 0.01);
        }
      }

      if (state.showControlPoly && state.curveKind !== 'catmull-rom') {
        const polyCol = [0.75, 0.78, 0.82];
        for (let i = 0; i < controlPoints.length - 1; i++) {
          addLine(controlPoints[i], controlPoints[i + 1], polyCol, zCurve - 0.003);
        }
      }

      if (state.showDeCasteljau && state.curveKind === 'bezier-c1') {
        const segs = getBezierSegments();
        const n = segs.length;
        const s = Math.min(n - 1e-7, state.paramT * n);
        const segIdx = Math.floor(s);
        const localT = s - segIdx;
        const levels = curves.deCasteljau(segs[segIdx], localT);
        const levelCols = [
          [0.35, 0.75, 0.95],
          [0.40, 0.90, 0.45],
          [1.00, 0.45, 0.25],
        ];
        for (let lv = 1; lv < levels.length; lv++) {
          const pts = levels[lv];
          const col = levelCols[lv - 1] ?? [1, 1, 1];
          for (let k = 0; k < pts.length - 1; k++) {
            addLine(pts[k], pts[k + 1], col, zCurve + 0.004 * lv);
          }
          for (const p of pts) {
            const m = mat4.multiply(
              mat4.translate(p[0], p[1], zCurve + 0.004 * lv),
              mat4.scale(0.022, 0.022, 0.022)
            );
            prims.drawCube(pass, viewProj, m, col);
          }
        }
      }

      prims.drawLines(pass, viewProj, new Float32Array(lineVerts));

      controlPoints.forEach((p, i) => {
        const isKnot = i % 3 === 0;
        if (state.curveKind === 'catmull-rom' && !isKnot) return;
        const sz = isKnot ? 0.036 : 0.025;
        const col = isKnot ? [0.90, 0.28, 0.12] : [0.92, 0.94, 0.98];
        const m = mat4.multiply(
          mat4.translate(p[0], p[1], zCurve + 0.005),
          mat4.scale(sz, sz, sz)
        );
        prims.drawCube(pass, viewProj, m, col);
      });

      const { point: cp, tangent: ct } = evaluateCurveAndTangent(state.paramT);
      const angle = Math.atan2(ct[1], ct[0]);
      const travelerModel = mat4.multiply(
        mat4.translate(cp[0], cp[1], zCurve + 0.03),
        mat4.multiply(mat4.rotateZ(angle), mat4.scale(0.09, 0.042, 0.042))
      );
      prims.drawCube(pass, viewProj, travelerModel, [1.0, 0.82, 0.12]);
      if (state.debugAxes) {
        prims.drawAxes(
          pass,
          viewProj,
          mat4.multiply(
            mat4.translate(cp[0], cp[1], zCurve + 0.03),
            mat4.rotateZ(angle)
          )
        );
      }
    },

    reset() {
      Object.assign(state, defaults);
      controlPoints = initialControlPoints();
      freehandStroke = [];
      kindSel.set(state.curveKind);
      surfSel.set(state.surfaceMode);
      for (const c of uiControllers) c.update?.();
      updateSceneGraphMatrices();
    },
  };
}