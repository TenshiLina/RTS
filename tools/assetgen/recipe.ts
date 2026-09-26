import type { MeshBuilder } from './kit/mesh';
import type { AnimDef, JointDef, SocketDef } from './kit/gltf';
import type { AOOptions } from './kit/ao';

export type AssetCategory = 'structure' | 'unit' | 'environment' | 'resource';

export interface AssetResult {
  mesh: MeshBuilder;
  skeleton?: JointDef[];
  animations?: AnimDef[];
  sockets?: SocketDef[];
  ao?: AOOptions | false;
  extras?: Record<string, unknown>;
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
