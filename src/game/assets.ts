// Model loading + cameo (build-portrait) rendering, shared by the game client.

import type { Platform } from '../platform/platform';
import type { Renderer, GpuModel } from '../render/renderer';
import type { Texture } from '../render/rhi/types';
import { parseGLB } from '../assets/gltf';
import { DEG, m4FromTRS, quatAxisAngle, V3, M4 } from '../core/math';
import { OrbitCamera } from '../render/camera';

export interface ManifestEntry {
  id: string;
  name: string;
  hanzi?: string;
  category: string;
  footprint?: [number, number];
  file: string;
  triangles: number;
  bounds: { min: V3; max: V3 };
  animations: string[];
}

export interface ModelLibrary {
  models: Map<string, GpuModel>;
  manifest: Map<string, ManifestEntry>;
}

export async function loadModels(platform: Platform, renderer: Renderer, onProgress?: (done: number, total: number) => void): Promise<ModelLibrary> {
  const manifest: { assets: ManifestEntry[] } = JSON.parse(await platform.loadText('assets/models/manifest.json'));
  const models = new Map<string, GpuModel>();
  let done = 0;
  await Promise.all(
    manifest.assets.map(async (a) => {
      const data = parseGLB(await platform.loadBinary(`assets/models/${a.file}`), a.id);
      models.set(a.id, renderer.createModel(data));
      onProgress?.(++done, manifest.assets.length);
    }),
  );
  return { models, manifest: new Map(manifest.assets.map((a) => [a.id, a])) };
}

/** Render a model into a small texture for the sidebar (the C&C "cameo"). */
export function renderCameo(renderer: Renderer, lib: ModelLibrary, id: string, w: number, h: number, team: number, teamColors: number[]): Texture {
  const out = renderer.createOutputTexture(w, h);
  const a = lib.manifest.get(id)!;
  const m = lib.models.get(id)!;
  const b = a.bounds;
  const cam = new OrbitCamera();
  const size = Math.max(b.max[0] - b.min[0], (b.max[1] - b.min[1]) * 0.85, b.max[2] - b.min[2]);
  cam.target = [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) * 0.42, (b.max[2] + b.min[2]) / 2];
  cam.fov = 22 * DEG;
  cam.distance = size * 2.7 + 0.4;
  cam.pitch = (a.category === 'unit' ? 16 : 30) * DEG;
  cam.yaw = 32 * DEG;
  const camera = cam.build(w / h, renderer.device.caps.clip, size * 1.2 + 2);
  const matrix: M4 = m4FromTRS([0, 0, 0], quatAxisAngle([0, 1, 0], 0), [1, 1, 1]);
  renderer.render(
    {
      camera,
      instances: [{ model: m, matrix, team, anim: a.animations.includes('idle') ? 'idle' : a.animations[0], animTime: 0.6 }],
      time: 1,
      terrain: null,
      sky: false,
      teamColors,
      clearColor: [0.07, 0.085, 0.11],
    },
    out,
  );
  return out;
}
