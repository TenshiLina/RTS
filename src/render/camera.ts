import { V3, M4, DEG, m4LookAt, m4Perspective, ClipConvention, clamp, add, sub, normalize, cross, m4Invert, m4Mul, m4TransformPoint } from '../core/math';
import type { Camera } from './renderer';

/** RTS-style orbit camera: fixed-ish pitch, looks at a ground target. */
export class OrbitCamera {
  target: V3 = [0, 0, 0];
  yaw = 45 * DEG;
  pitch = 52 * DEG;
  distance = 60;
  fov = 30 * DEG;
  minDist = 4;
  maxDist = 180;

  eye(): V3 {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + Math.sin(this.yaw) * cp * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + Math.cos(this.yaw) * cp * this.distance,
    ];
  }

  build(aspect: number, cc: ClipConvention, shadowRadius?: number): Camera {
    const pos = this.eye();
    const view = m4LookAt(pos, this.target, [0, 1, 0]);
    const near = Math.max(0.3, this.distance * 0.05);
    const far = this.distance * 6 + 200;
    const proj = m4Perspective(this.fov, aspect, near, far, cc);
    return { view, proj, pos, target: [...this.target] as V3, shadowRadius: shadowRadius ?? clamp(this.distance * 0.75, 12, 110) };
  }

  /** Move target in the camera's ground plane (screen-space pan). */
  pan(dx: number, dz: number) {
    const f = normalize([-Math.sin(this.yaw), 0, -Math.cos(this.yaw)] as V3);
    const r = cross(f, [0, 1, 0]);
    this.target = add(this.target, add([r[0] * dx, 0, r[2] * dx], [f[0] * dz, 0, f[2] * dz]));
  }

  zoom(steps: number) {
    this.distance = clamp(this.distance * Math.pow(1.12, steps), this.minDist, this.maxDist);
  }
}

/** Screen pixel → world ray. */
export function screenRay(cam: Camera, x: number, y: number, w: number, h: number): { o: V3; d: V3 } {
  const inv = m4Invert(m4Mul(cam.proj, cam.view));
  const nx = (x / w) * 2 - 1, ny = 1 - (y / h) * 2;
  const a = m4TransformPoint(inv, [nx, ny, -1]);
  const b = m4TransformPoint(inv, [nx, ny, 1]);
  return { o: a, d: normalize(sub(b, a)) };
}

export type { M4 };
