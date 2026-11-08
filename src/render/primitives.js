/**
 * Used AI assistance to create primitives.js
 * WebGPU pipelines for 3D lit meshes (cubes) and 3D coloured lines (axes,
 * frustums, curves). Allocates a pool of uniform buffers so multiple objects
 * drawn in the same frame never overwrite each other's uniforms.
 */
import { createShader, fragmentConstants } from './shader.js';
import { DEPTH_FORMAT } from './renderer.js';
import { cube, axes } from '../scene/geometry.js';
import * as mat4 from '../math/mat4.js';

const MESH_WGSL = /* wgsl */ `
struct Uniforms {
  mvp   : mat4x4f,
  model : mat4x4f,
  color : vec4f,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) pos    : vec4f,
  @location(0)       normal : vec3f,
};

@vertex
fn vs(@location(0) pos : vec3f, @location(1) normal : vec3f) -> VSOut {
  var out : VSOut;
  out.pos = u.mvp * vec4f(pos, 1.0);

  // Cofactor (adjugate transpose) of the upper-left 3x3 transforms normals
  // properly even under non-uniform scaling or S·R·T.
  let c0 = u.model[0].xyz;
  let c1 = u.model[1].xyz;
  let c2 = u.model[2].xyz;
  let adjT = mat3x3f(
    cross(c1, c2),
    cross(c2, c0),
    cross(c0, c1)
  );
  let worldN = adjT * normal;
  let len = length(worldN);
  out.normal = select(normal, worldN / len, len > 1e-6);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let L1 = normalize(vec3f(0.55, 0.75, 0.65));
  let L2 = normalize(vec3f(-0.4, 0.25, 0.5));
  let diff1 = max(dot(N, L1), 0.0);
  let diff2 = max(dot(N, L2), 0.0) * 0.25;
  let hemi  = 0.22 + 0.10 * (N.y * 0.5 + 0.5);
  let linear = u.color.rgb * (hemi + 0.68 * diff1 + diff2);
  return toOutput(vec4f(linear, u.color.a));
}
`;

const LINE_WGSL = /* wgsl */ `
struct LineUniforms {
  mvp : mat4x4f,
};

@group(0) @binding(0) var<uniform> u : LineUniforms;

struct VSOut {
  @builtin(position) pos   : vec4f,
  @location(0)       color : vec3f,
};

@vertex
fn vs(@location(0) pos : vec3f, @location(1) color : vec3f) -> VSOut {
  var out : VSOut;
  out.pos = u.mvp * vec4f(pos, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  return toOutput(vec4f(in.color, 1.0));
}
`;

export class PrimitiveRenderer {
  constructor(gpu, renderer) {
    this.gpu = gpu;
    this.renderer = renderer;
    const { device } = gpu;

    /* ---- Cube static vertex buffer ---- */
    const cubeData = cube();
    this.cubeVertexCount = cubeData.length / 6; // 36
    this.cubeBuffer = device.createBuffer({
      label: 'unit cube vertices',
      size: cubeData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.cubeBuffer, 0, cubeData);

    /* ---- Axes static vertex buffer ---- */
    const axesData = axes(0.45);
    this.axesVertexCount = axesData.length / 6; // 6
    this.axesBuffer = device.createBuffer({
      label: 'local axes vertices',
      size: axesData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.axesBuffer, 0, axesData);

    /* ---- Dynamic line vertex buffer (for frustum, curves, de Casteljau) ---- */
    this.maxDynamicLineVertices = 16384;
    this.dynamicLineBuffer = device.createBuffer({
      label: 'dynamic lines',
      size: this.maxDynamicLineVertices * 6 * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    /* ---- Dynamic triangle mesh buffer (for Bonus swept surfaces) ---- */
    this.maxDynamicMeshVertices = 24576;
    this.dynamicMeshBuffer = device.createBuffer({
      label: 'dynamic surface mesh',
      size: this.maxDynamicMeshVertices * 6 * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    /* ---- Mesh pipeline ---- */
    const meshModule = createShader(device, MESH_WGSL, 'mesh');
    this.meshPipeline = device.createRenderPipeline({
      label: 'lit mesh pipeline',
      layout: 'auto',
      vertex: {
        module: meshModule,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 6 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0,     format: 'float32x3' }, // position
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, // normal
          ],
        }],
      },
      fragment: {
        module: meshModule,
        entryPoint: 'fs',
        targets: [{ format: gpu.viewFormat }],
        constants: fragmentConstants(gpu),
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    /* ---- Line pipeline ---- */
    const lineModule = createShader(device, LINE_WGSL, 'line');
    this.linePipeline = device.createRenderPipeline({
      label: 'line pipeline',
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 6 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0,     format: 'float32x3' }, // position
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, // color
          ],
        }],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fs',
        targets: [{ format: gpu.viewFormat }],
        constants: fragmentConstants(gpu),
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
    });

    /* ---- Per-draw uniform pools ---- */
    this.meshPool = [];
    this.meshCursor = 0;
    this.linePool = [];
    this.lineCursor = 0;
  }

  /** Call once at the start of scene.draw() to reset uniform buffer cursors. */
  beginFrame() {
    this.meshCursor = 0;
    this.lineCursor = 0;
  }

  _getMeshSlot() {
    if (this.meshCursor < this.meshPool.length) {
      return this.meshPool[this.meshCursor++];
    }
    const { device } = this.gpu;
    const buffer = device.createBuffer({
      label: `mesh uniform #${this.meshPool.length}`,
      size: 144, // 2 * mat4x4f (128B) + vec4f (16B) = 144B
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: this.meshPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });
    const data = new Float32Array(36);
    const slot = { buffer, bindGroup, data };
    this.meshPool.push(slot);
    this.meshCursor++;
    return slot;
  }

  _getLineSlot() {
    if (this.lineCursor < this.linePool.length) {
      return this.linePool[this.lineCursor++];
    }
    const { device } = this.gpu;
    const buffer = device.createBuffer({
      label: `line uniform #${this.linePool.length}`,
      size: 64, // 1 * mat4x4f
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });
    const slot = { buffer, bindGroup };
    this.linePool.push(slot);
    this.lineCursor++;
    return slot;
  }

  /**
   * Draw a unit cube transformed by `model` with linear RGB `color` = [r, g, b].
   */
  drawCube(pass, viewProj, model, color = [0.8, 0.35, 0.15]) {
    const slot = this._getMeshSlot();
    const mvp = mat4.multiply(viewProj, model);
    slot.data.set(mvp, 0);
    slot.data.set(model, 16);
    slot.data[32] = color[0];
    slot.data[33] = color[1];
    slot.data[34] = color[2];
    slot.data[35] = color[3] ?? 1.0;

    this.gpu.device.queue.writeBuffer(slot.buffer, 0, slot.data);
    pass.setPipeline(this.meshPipeline);
    pass.setBindGroup(0, slot.bindGroup);
    pass.setVertexBuffer(0, this.cubeBuffer);
    pass.draw(this.cubeVertexCount);
    this.renderer.countDraw(this.cubeVertexCount);
  }

  /**
   * Draw RGB coordinate axes for a given `model` (or `world`) matrix.
   */
  drawAxes(pass, viewProj, model) {
    const slot = this._getLineSlot();
    const mvp = mat4.multiply(viewProj, model);
    this.gpu.device.queue.writeBuffer(slot.buffer, 0, mvp);
    pass.setPipeline(this.linePipeline);
    pass.setBindGroup(0, slot.bindGroup);
    pass.setVertexBuffer(0, this.axesBuffer);
    pass.draw(this.axesVertexCount);
    this.renderer.countDraw(this.axesVertexCount);
  }

  /**
   * Draw arbitrary 3D line-list segments in world space.
   * @param {Float32Array} vertexData  interleaved [x, y, z, r, g, b, ...]
   */
  drawLines(pass, viewProj, vertexData) {
    const vertexCount = Math.min(
      Math.floor(vertexData.length / 6),
      this.maxDynamicLineVertices
    );
    if (vertexCount < 2) return;

    const slot = this._getLineSlot();
    this.gpu.device.queue.writeBuffer(slot.buffer, 0, viewProj);
    this.gpu.device.queue.writeBuffer(
      this.dynamicLineBuffer,
      0,
      vertexData.buffer,
      vertexData.byteOffset,
      vertexCount * 6 * 4
    );

    pass.setPipeline(this.linePipeline);
    pass.setBindGroup(0, slot.bindGroup);
    pass.setVertexBuffer(0, this.dynamicLineBuffer);
    pass.draw(vertexCount);
    this.renderer.countDraw(vertexCount);
  }
  /**
   * Draw a dynamically generated triangle-list mesh [x, y, z, nx, ny, nz, ...].
   */
  drawDynamicMesh(pass, viewProj, model, vertexData, color = [0.85, 0.55, 0.20]) {
    const vertexCount = Math.min(
      Math.floor(vertexData.length / 6),
      this.maxDynamicMeshVertices
    );
    if (vertexCount < 3) return;

    const slot = this._getMeshSlot();
    const mvp = mat4.multiply(viewProj, model);
    slot.data.set(mvp, 0);
    slot.data.set(model, 16);
    slot.data[32] = color[0];
    slot.data[33] = color[1];
    slot.data[34] = color[2];
    slot.data[35] = color[3] ?? 1.0;

    this.gpu.device.queue.writeBuffer(slot.buffer, 0, slot.data);
    this.gpu.device.queue.writeBuffer(
      this.dynamicMeshBuffer,
      0,
      vertexData.buffer,
      vertexData.byteOffset,
      vertexCount * 6 * 4
    );

    pass.setPipeline(this.meshPipeline);
    pass.setBindGroup(0, slot.bindGroup);
    pass.setVertexBuffer(0, this.dynamicMeshBuffer);
    pass.draw(vertexCount);
    this.renderer.countDraw(vertexCount);
  }
}