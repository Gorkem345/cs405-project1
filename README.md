# CS405 Project 1 — Transformations, Projection & Curves from Paintings

Interactive WebGPU 3D scene built around **Şeker Ahmed Paşa — *Kavunlu Natürmort*** (from the Sakıp Sabancı Museum collection).

This application demonstrates core computer graphics concepts, including custom affine transformations, hierarchical scene graphs, camera projection and frustum culling, parametric curve evaluation with \(C^1\) continuity, and advanced procedural mesh generation.

## 1. How to Run

### Prerequisites

- **Node.js 20.19+** (`node -v`)
- A browser with WebGPU enabled (Chrome, Edge, Safari 26+, or Firefox 141+)

### Installation & Commands

```bash
npm install
npm run dev      # Starts Vite dev server at http://localhost:5173
npm test         # Runs the unit tests (vec3, mat4, node, curves)
```

## 2. Project Architecture & File Structure

The project is strictly modularized into the required directory layout:

- `src/math/vec3.js` — 3D vector math library (add, sub, scale, dot, cross, length, normalize).
- `src/math/mat4.js` — Column-major `Float32Array(16)` 4×4 transformations (identity, multiply, translate, rotateX/Y/Z, scale, transpose, invertRigid, transformVec4, lookAt, WebGPU perspective, and orthographic with depth \(z_{\text{ndc}} \in [0, 1]\)).
- `src/math/curves.js` — Cubic Bernstein basis, cubicBezier, cubicBezierTangent, deCasteljau, \(C^1\) joint mirroring (`c1NextControl`), evalPiecewise, catmullRom, bspline, and least-squares Bézier fitting.
- `src/math/quat.js` — Unit quaternion algebra and shortest-arc SLERP for smooth camera viewpoint transitions.
- `src/scene/node.js` — SceneNode hierarchy computing world matrices via recursive depth-first traversal (\(M_{\text{world}} = M_{\text{parent, world}} \cdot M_{\text{local}}\)).
- `src/scene/scene.js` — Core scene logic handling Parts A, B, D, and Bonus swept surfaces.
- `src/scene/curveExport.js` — Exports curve control points in normalized painting coordinates \(u, v \in [0, 1]\) (top-left origin).
- `src/render/primitives.js` — WebGPU lit mesh and 3D line pipelines with cofactor normal transformation and pooled per-draw uniform buffers.

## 3. Project Parts Breakdown

### Part A · Transformations (20 pts)

**Implementation:**
- Custom column-major 4×4 matrix library supporting translation, rotation, scaling, transposition, and rigid inverse (`invertRigid`).

**Composition Order:**
- Provides a live switch between \(M = T \cdot R \cdot S\) and \(M = S \cdot R \cdot T\), demonstrating non-commutativity with real-time numeric 4×4 matrix readouts on screen.

**Objects:**
- Places at least three interactive and static objects in front of the painting (\(z > 0\)).

### Part B · Scene Graph (15 pts)

**Implementation:**
- Node-based tree structure (`SceneNode`) where each node stores a local transform and computes its world matrix via traversal.

**Hierarchy:**
- Implements a 4-level, 6-node articulated lamp arm:

  `table_base → turntable → lower_arm → upper_arm → wrist → lantern_leaf`

**Animation & Debug:**
- Features continuous joint animation and an optional debug mode drawing RGB \((x, y, z)\) local coordinate axes per node.

### Part C · Camera & Projection (20 pts)

**Implementation:**
- Custom `lookAt(eye, target, up)` using two cross-product bases with safe degenerate case handling (when `up` is parallel to the view vector).

**Projection:**
- Perspective and orthographic projection matrices mapped correctly to WebGPU clip-space depth \(z_{\text{ndc}} \in [0, 1]\).

**Frustum Visualisation:**
- Includes an Inspection Camera view mode that renders the Main Camera's 3D frustum (near plane, far plane, pyramid edges, eye, and target sightline) in real time.

### Part D · Curves Over the Painting (25 pts)

**Implementation:**
- Cubic Bézier evaluation, Bernstein basis functions, tangent derivatives, and the full multi-level de Casteljau construction.

**Continuity & Families:**
- Piecewise curve with 3 segments enforcing \(C^1\) continuity at joints via `c1NextControl`, alongside support for Catmull–Rom splines and Uniform Cubic B-splines.

**Interaction & Export:**
- Mouse picking and dragging of control points in the painting's plane.
- Tangent-oriented object animation.
- JSON export in normalized coordinates \((u, v) \in [0, 1]^2\).

### Part E · Integration, UI & Performance (10 pts + 10 Report)

**Coherence:**
- Single integrated WebGPU application uniting Parts A–D without page reloads.

**UI & Metrics:**
- Built-in control panel with view switchers, reset triggers, real-time frame-time counter, and exact vertex submission counters.

### Bonus Extensions (+10 pts)

**Swept Surfaces:**
- Generates 3D lit triangle meshes via procedural extrusion and surface-of-revolution (lathe) sweeping of the active curve.

**Least-Squares Curve Fitting:**
- Supports Alt + Left-Drag freehand stroke tracing on the painting to automatically fit a \(C^1\) piecewise cubic Bézier curve via linear least squares.

**Quaternion SLERP:**
- Smooth quaternion spherical linear interpolation for animating camera viewpoints between preset angles (including a custom "Match Painting Perspective" view).

## 4. Controls Reference

### Canvas Mouse Controls

| Input | Action |
|---|---|
| Left-Click + Drag (on a control point) | Picks and drags knots or tangent handles in the \(z = 0\) painting plane. |
| Dragging a knot | Translates adjacent handles rigidly. |
| Dragging a handle | Automatically mirrors the opposite handle across the joint to maintain \(C^1\) continuity. |
| Left-Click + Drag (empty space) | Orbits the active camera around its target. |
| Right-Click + Drag (or Shift + Left-Drag) | Pans the camera target. |
| Mouse Wheel | Zooms the active camera in and out. |
| Alt + Left-Drag on Painting (Bonus) | Traces a freehand stroke and fits a Bézier curve via least-squares. |

### Control Panel (Right Sidebar)

#### Painting

- Selects between the SSM museum collection paintings.

#### Part C · Camera & Projection

- **Active view:** Toggles between Main Camera and Inspection Camera (shows Frustum).
- **Projection:** Switches between perspective and orthographic projections at runtime.
- **fovY (°), near, far:** Adjusts frustum parameters live.
- **SLERP viewpoint (Bonus):** Interpolates camera angles smoothly using quaternion SLERP.

#### Scene & Debug

- **Debug local axes:** Toggles local coordinate frame visualization across scene nodes and objects.

#### Part A · Transformations

- **Use T·R·S (off = S·R·T):** Toggles matrix composition order and inspects live matrices.

#### Part B · Scene Graph

- **Animate hierarchy:** Toggles joint animation and live leaf-node matrix readouts.

#### Part D · Curves

- **Curve family:** Switches between Bézier (\(C^1\)), Catmull–Rom, and B-spline.
- **de Casteljau construction:** Toggles intermediate subdivision polygons.
- **Export curve JSON:** Downloads the control points as a `.json` file.

#### Bonus · Swept Surface & Curve Fit

- **Swept surface:** Renders 3D extruded ribbons or lathe revolution vessels.

#### View

- **Reset scene & camera:** Restores initial default states.