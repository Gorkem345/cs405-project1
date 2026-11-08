/**
 * Entry point: wires GPU, painting, camera, scene and UI together and runs
 * the render loop. Includes Bonus Quaternion SLERP viewpoint interpolation
 * and Alt+Drag freehand curve tracing.
 *
 *   p_clip = P · V · M · p_object
 */
import './ui/style.css';
import { initWebGPU, showFatal } from './render/gpu.js';
import { Renderer } from './render/renderer.js';
import { Painting } from './render/painting.js';
import { createCamera, viewProjection } from './scene/camera.js';
import { createScene } from './scene/scene.js';
import { createPanel } from './ui/panel.js';
import { Stats } from './ui/stats.js';
import { attachPointer } from './ui/input.js';
import { PAINTINGS, DEFAULT_PAINTING, paintingURL } from './config.js';
import * as mat4 from './math/mat4.js';
import * as vec3 from './math/vec3.js';
import * as quat from './math/quat.js';

function intersectPaintingPlane(cam, ndc, aspect) {
  const forward = vec3.normalize(vec3.sub(cam.target, cam.eye));
  let rightRaw = vec3.cross(forward, cam.up);
  if (vec3.length(rightRaw) < 1e-6) {
    const fb = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    rightRaw = vec3.cross(forward, fb);
  }
  const right = vec3.normalize(rightRaw);
  const up = vec3.cross(right, forward);

  let origin, dir;
  if (cam.projection === 'orthographic') {
    const halfH = cam.orthoHeight / 2;
    const halfW = halfH * aspect;
    origin = vec3.add(
      cam.eye,
      vec3.add(vec3.scale(right, ndc[0] * halfW), vec3.scale(up, ndc[1] * halfH))
    );
    dir = forward;
  } else {
    const tanH = Math.tan(cam.fovY / 2);
    origin = cam.eye;
    dir = vec3.add(
      forward,
      vec3.add(
        vec3.scale(right, ndc[0] * aspect * tanH),
        vec3.scale(up, ndc[1] * tanH)
      )
    );
  }

  if (Math.abs(dir[2]) < 1e-6) return null;
  const s = -origin[2] / dir[2];
  if (s <= 0) return null;
  return [origin[0] + s * dir[0], origin[1] + s * dir[1]];
}

async function main() {
  const canvas = document.getElementById('gfx');
  const gpu = await initWebGPU(canvas);
  const renderer = new Renderer(gpu);
  const painting = new Painting(gpu);

  const params = new URLSearchParams(location.search);
  let current = PAINTINGS.find((p) => p.id === params.get('painting'))
    ?? PAINTINGS.find((p) => p.id === DEFAULT_PAINTING);
  await painting.load(paintingURL(current));

  /* ---------------- UI ---------------- */
  const panelRoot = document.getElementById('panel');
  const panel = createPanel(panelRoot);
  const title = document.createElement('h1');
  title.textContent = 'CS405 · Project 1';
  panelRoot.appendChild(title);
  const stats = new Stats(panelRoot);

  const pf = panel.folder('Painting');
  pf.select(
    'painting',
    PAINTINGS.map((p) => ({ value: p.id, label: `${p.artist} — ${p.title}` })),
    current.id,
    async (id) => {
      current = PAINTINGS.find((p) => p.id === id);
      await painting.load(paintingURL(current));
      history.replaceState(null, '', `?painting=${id}`);
    }
  );

  /* ---------------- Cameras (Part C + Bonus Quaternion SLERP) ---------------- */
  const camera = createCamera();
  camera.near = 0.25;
  camera.far = 12.0;

  const defaultOrbit = {
    yaw: 0.0,
    pitch: 0.0,
    dist: 2.8,
    fovDeg: 45,
    activeView: 'main',
    orientationQuat: quat.fromYawPitch(0, 0),
  };
  const camControl = { ...defaultOrbit };

  // Smooth SLERP transition state
  let slerpAnim = null;

  const VIEWPOINT_PRESETS = {
    front: {
      yaw: 0.0,
      pitch: 0.0,
      dist: 2.8,
      fovDeg: 45,
      target: [0, 0, 0],
    },
    paintedPerspective: {
      // Matches the elevated ~16° table-top viewing angle and ~38° FOV of Şeker Ahmed Paşa's still life
      yaw: -0.06,
      pitch: 0.28,
      dist: 3.15,
      fovDeg: 38,
      target: [0.0, -0.12, 0.0],
    },
    hierarchyFocus: {
      yaw: 0.58,
      pitch: 0.24,
      dist: 2.35,
      fovDeg: 45,
      target: [0.75, -0.25, 0.35],
    },
    obliqueOverview: {
      yaw: -0.55,
      pitch: 0.35,
      dist: 3.6,
      fovDeg: 50,
      target: [-0.1, -0.15, 0.2],
    },
  };

  function startSlerpToPreset(presetKey) {
    const p = VIEWPOINT_PRESETS[presetKey];
    if (!p) return;
    camControl.activeView = 'main';
    viewSel.set('main');
    slerpAnim = {
      elapsed: 0,
      duration: 0.85,
      qStart: quat.fromYawPitch(camControl.yaw, camControl.pitch),
      qEnd: quat.fromYawPitch(p.yaw, p.pitch),
      distStart: camControl.dist,
      distEnd: p.dist,
      fovStart: camControl.fovDeg,
      fovEnd: p.fovDeg,
      targetStart: [...camera.target],
      targetEnd: [...p.target],
    };
  }

  const inspectionCam = {
    eye: [3.4, 2.1, 4.2],
    target: [0, -0.1, 0.8],
    up: [0, 1, 0],
    fovY: (50 * Math.PI) / 180,
    near: 0.1,
    far: 40.0,
    projection: 'perspective',
    orthoHeight: 4.5,
  };
  const inspectOrbit = { yaw: 0.72, pitch: 0.42, dist: 5.2 };

  function syncCameraFromOrbit() {
    camera.fovY = (camControl.fovDeg * Math.PI) / 180;
    const q = quat.fromYawPitch(camControl.yaw, camControl.pitch);
    camControl.orientationQuat = q;
    const offset = quat.rotateVec3(q, [0, 0, camControl.dist]);
    camera.eye = vec3.add(camera.target, offset);
  }

  function syncInspectionFromOrbit() {
    const q = quat.fromYawPitch(inspectOrbit.yaw, inspectOrbit.pitch);
    const offset = quat.rotateVec3(q, [0, 0, inspectOrbit.dist]);
    inspectionCam.eye = vec3.add(inspectionCam.target, offset);
  }

  syncCameraFromOrbit();
  syncInspectionFromOrbit();

  const cf = panel.folder('Part C · Camera & Projection');
  const camStatus = cf.text('');
  const viewSel = cf.select(
    'active view',
    [
      { value: 'main', label: 'Main Camera (Camera 1)' },
      { value: 'inspection', label: 'Inspection Camera (shows Frustum)' },
    ],
    camControl.activeView,
    (v) => { camControl.activeView = v; }
  );
  const projSel = cf.select(
    'projection',
    ['perspective', 'orthographic'],
    camera.projection,
    (v) => { camera.projection = v; }
  );
  const fovSlider = cf.slider('fovY (°)', camControl, 'fovDeg', 15, 100, 1, () => syncCameraFromOrbit());
  const nearSlider = cf.slider('near', camera, 'near', 0.1, 3.0, 0.05);
  const farSlider = cf.slider('far', camera, 'far', 3.0, 25.0, 0.5);
  cf.select(
    'SLERP viewpoint (Bonus)',
    [
      { value: 'front', label: 'Front Painting View' },
      { value: 'paintedPerspective', label: 'Match Painting Perspective (~16° tilt)' },
      { value: 'hierarchyFocus', label: 'Scene Graph Arm Close-Up' },
      { value: 'obliqueOverview', label: 'Oblique 3D Scene Overview' },
    ],
    'front',
    (v) => startSlerpToPreset(v)
  );
  const camReadout = cf.text('');

  const scene = createScene({
    gpu,
    renderer,
    painting,
    panel,
    getPaintingId: () => current.id,
  });

  const vf = panel.folder('View');
  vf.button('reset scene & camera', () => {
    slerpAnim = null;
    Object.assign(camera, createCamera());
    camera.near = 0.25;
    camera.far = 12.0;
    Object.assign(camControl, defaultOrbit);
    Object.assign(inspectOrbit, { yaw: 0.72, pitch: 0.42, dist: 5.2 });
    syncCameraFromOrbit();
    syncInspectionFromOrbit();
    viewSel.set(camControl.activeView);
    projSel.set(camera.projection);
    fovSlider.update();
    nearSlider.update();
    farSlider.update();
    scene.reset();
  });
  vf.note(gpu.encodeSRGB ? 'sRGB: encoded in shader (fallback)' : 'sRGB: canvas -srgb view');

  /* -------------- Input --------------- */
  let draggingCurvePoint = false;
  let tracingFreehand = false;

  attachPointer(canvas, {
    down(e) {
      const activeCam = camControl.activeView === 'inspection' ? inspectionCam : camera;
      const aspect = canvas.width / canvas.height;

      // Bonus: Alt + Left-Drag traces a freehand shape on the painting for Least-Squares fit
      if (e.button === 0 && e.alt) {
        const hitXY = intersectPaintingPlane(activeCam, e.ndc, aspect);
        if (hitXY) {
          tracingFreehand = true;
          scene.startFreehandTrace(hitXY);
          return;
        }
      }

      if (e.button === 0 && !e.shift && !e.alt) {
        const hitXY = intersectPaintingPlane(activeCam, e.ndc, aspect);
        if (hitXY && scene.pickControlPoint(hitXY)) {
          draggingCurvePoint = true;
          return;
        }
      }
      draggingCurvePoint = false;
      tracingFreehand = false;
    },

    drag(e) {
      const activeCam = camControl.activeView === 'inspection' ? inspectionCam : camera;
      const aspect = canvas.width / canvas.height;

      if (tracingFreehand) {
        const hitXY = intersectPaintingPlane(activeCam, e.ndc, aspect);
        if (hitXY) scene.appendFreehandTrace(hitXY);
        return;
      }

      if (draggingCurvePoint) {
        const hitXY = intersectPaintingPlane(activeCam, e.ndc, aspect);
        if (hitXY) scene.dragControlPoint(hitXY);
        return;
      }

      slerpAnim = null;

      if (camControl.activeView === 'inspection') {
        inspectOrbit.yaw -= e.dx * 0.007;
        inspectOrbit.pitch = Math.max(-1.45, Math.min(1.45, inspectOrbit.pitch + e.dy * 0.007));
        syncInspectionFromOrbit();
        return;
      }

      if (e.button === 2 || e.shift) {
        const panScale = 0.0025 * camControl.dist;
        camera.target[0] -= e.dx * panScale;
        camera.target[1] += e.dy * panScale;
      } else {
        camControl.yaw -= e.dx * 0.007;
        camControl.pitch = Math.max(-1.55, Math.min(1.55, camControl.pitch + e.dy * 0.007));
      }
      syncCameraFromOrbit();
    },

    up() {
      if (tracingFreehand) {
        scene.finishFreehandTrace();
        tracingFreehand = false;
      }
      if (draggingCurvePoint) {
        scene.releaseControlPoint();
        draggingCurvePoint = false;
      }
    },

    wheel(e) {
      slerpAnim = null;
      if (camControl.activeView === 'inspection') {
        inspectOrbit.dist = Math.max(1.5, Math.min(20, inspectOrbit.dist * (1 + e.delta * 0.001)));
        syncInspectionFromOrbit();
      } else {
        camControl.dist = Math.max(0.6, Math.min(15, camControl.dist * (1 + e.delta * 0.001)));
        camera.orthoHeight = Math.max(0.5, Math.min(10, camControl.dist * 0.8));
        syncCameraFromOrbit();
      }
    },
  });

  /* ------------ Render Loop ----------- */
  let last = performance.now();
  function frame(now) {
    stats.begin(now);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // Bonus: Quaternion SLERP camera interpolation
    if (slerpAnim) {
      slerpAnim.elapsed += dt;
      const rawT = Math.min(1, slerpAnim.elapsed / slerpAnim.duration);
      // Smoothstep easing for natural acceleration/deceleration
      const u = rawT * rawT * (3 - 2 * rawT);
      const qCur = quat.slerp(slerpAnim.qStart, slerpAnim.qEnd, u);
      const [yaw, pitch] = quat.toYawPitch(qCur);
      camControl.yaw = yaw;
      camControl.pitch = pitch;
      camControl.dist = slerpAnim.distStart + (slerpAnim.distEnd - slerpAnim.distStart) * u;
      camControl.fovDeg = slerpAnim.fovStart + (slerpAnim.fovEnd - slerpAnim.fovStart) * u;
      camera.target = slerpAnim.targetStart.map(
        (v, i) => v + (slerpAnim.targetEnd[i] - v) * u
      );
      fovSlider.update();
      syncCameraFromOrbit();
      if (rawT >= 1) slerpAnim = null;
    }

    scene.update(dt, now / 1000);

    const aspect = canvas.width / canvas.height;
    const renderCam = camControl.activeView === 'inspection' ? inspectionCam : camera;
    const vp = viewProjection(renderCam, aspect, painting.aspect);

    camStatus.set(
      vp.fallback
        ? `PLACEHOLDER view (no camera yet)\n${vp.missing}`
        : `view: ${camControl.activeView === 'inspection' ? 'Inspection Camera' : 'Main Camera'} (${camera.projection})`
    );
    camStatus.el.classList.toggle('warn', vp.fallback);
    const q = camControl.orientationQuat;
    camReadout.set(
      `eye    ${camera.eye.map((x) => x.toFixed(2)).join(', ')}\n` +
      `target ${camera.target.map((x) => x.toFixed(2)).join(', ')}\n` +
      `fovY   ${(camera.fovY * 180 / Math.PI).toFixed(1)}°  near ${camera.near.toFixed(2)}  far ${camera.far.toFixed(1)}\n` +
      `quat   [${q.map((x) => x.toFixed(2)).join(', ')}]`
    );

    const paintingMVP = vp.fallback ? vp.matrix : mat4.multiply(vp.matrix, painting.model);
    renderer.render((pass) => {
      painting.draw(pass, paintingMVP, renderer);
      scene.draw(pass, vp.matrix);
      if (!vp.fallback && camControl.activeView === 'inspection') {
        scene.drawCameraFrustum(pass, vp.matrix, camera, aspect);
      }
    });

    stats.end(renderer.stats);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  showFatal(e.message ?? String(e));
});