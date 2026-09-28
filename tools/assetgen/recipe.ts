import type { MeshBuilder } from './kit/mesh';
import type { AnimDef, JointDef, SocketDef } from './kit/gltf';
import type { AOOptions } from './kit/ao';
import type { BlendZone } from './kit/skin';

export type AssetCategory = 'structure' | 'unit' | 'environment' | 'resource' | 'dev';

export interface AssetResult {
  mesh: MeshBuilder;
  skeleton?: JointDef[];
  animations?: AnimDef[];
  sockets?: SocketDef[];
  ao?: AOOptions | false;
  /** blend zones per joint name: soft geometry gets smooth multi-joint skin weights */
  skin?: Record<string, BlendZone>;
  extras?: Record<string, unknown>;
  /** texture atlas size for painted materials (default 1024) */
  atlasSize?: number;
}

export interface Recipe {
  id: string;
  name: string;
  /** Chinese name shown in the UI / docs */
  hanzi?: string;
  category: AssetCategory;
  /** footprint in cells (structures) */
  footprint?: [number, number];
  build(): AssetResult;
}
