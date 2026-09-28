// Asset viewer / diorama. A web-only dev tool built on the portable engine layers.
// URL params (used by screenshot automation):
//   ?mode=gallery|diorama  &asset=<id>  &yaw=<deg> &pitch=<deg> &dist=<m>  &team=<0-7>
//   &rotate=0|1  &ui=0  &time=<s>  &anim=<name>  &tx,tz=<target>

import { WebPlatform } from '../../platform/web/webPlatform';
import { WebGL2Device } from '../../render/rhi/webgl2/device';
import { Renderer, GpuModel, RenderInstance, DEFAULT_LIGHTING } from '../../render/renderer';
import { OrbitCamera } from '../../render/camera';
import { parseGLB } from '../../assets/gltf';
import { buildTerrainGpu, TerrainGpu } from '../../render/terrainRenderer';
import { generatePeachValley, heightAt, TerrainData, flattenRect, CELL_SIZE } from '../../world/terrain';
import { DEG, m4FromTRS, quatAxisAngle, rng, V3, clamp } from '../../core/math';
import { TEAM_COLORS } from '../../core/materialModel';

interface ManifestEntry {
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

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? parseFloat(params.get(k)!) : d);
const errorEl = document.getElementById('error')!;
const showError = (e: unknown) => {
  errorEl.style.display = 'block';
  errorEl.textContent = String((e as Error)?.stack ?? e);
  (window as any).__viewer = { ...(window as any).__viewer, error: String(e) };
};
window.addEventListener('error', (e) => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

async function main() {
  if (params.get('ui') === '0') document.body.classList.add('noui');
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const platform = new WebPlatform(canvas);
  const device = new WebGL2Device(canvas, { preserveDrawingBuffer: params.has('capture') });
  platform.surface.onResize((w, h) => device.resize(w, h));
  device.resize(platform.surface.width, platform.surface.height);
  const renderer = new Renderer(device, { samples: 4 });

  const manifest: { assets: ManifestEntry[] } = JSON.parse(await platform.loadText('assets/models/manifest.json'));
  const models = new Map<string, GpuModel>();
  await Promise.all(
    manifest.assets.map(async (a) => {
      const data = parseGLB(await platform.loadBinary(`assets/models/${a.file}`), a.id);
      const images = await Promise.all(data.images.map((im) => platform.decodeImage(im.bytes, im.mime)));
      models.set(a.id, renderer.createModel(data, images));
    }),
  );

  // ---------------------------------------------------------------- world
  const terrain: TerrainData = generatePeachValley(56, 7);
  const layout = buildDiorama(manifest.assets, terrain);
  let terrainGpu: TerrainGpu = buildTerrainGpu(device, terrain);

  // ---------------------------------------------------------------- state
  const cam = new OrbitCamera();
  let mode: 'gallery' | 'diorama' = (params.get('mode') as any) ?? (params.has('asset') ? 'gallery' : 'diorama');
  // cameo: C&C-style build-sidebar portrait (no terrain, tight framing)
  const cameo = params.get('cameo') === '1';
  if (cameo) document.body.classList.add('noui');
  let selected = params.get('asset') ?? manifest.assets.find((a) => a.category === 'structure')?.id ?? manifest.assets[0].id;
  let team = num('team', 0);
  let turntable = params.has('rotate') ? params.get('rotate') !== '0' : mode === 'gallery';
  let showGrid = false;
  let animOverride: string | null = params.get('anim');
  const teamKeys = Object.keys(TEAM_COLORS);
  const teamColors = teamKeys.map((k) => TEAM_COLORS[k]);

  const frameGallery = (id: string) => {
    const a = manifest.assets.find((m) => m.id === id)!;
    const b = a.bounds;
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    cam.target = [0, (b.max[1] + b.min[1]) * 0.42, 0];
    cam.distance = a.category === 'unit' ? clamp(size * 1.7 + 1.2, 3.2, 12) : clamp(size * 2.3 + 1.5, 3.5, 90);
    cam.pitch = a.category === 'unit' ? 22 * DEG : 34 * DEG;
    cam.fov = 30 * DEG;
  };
  const frameDiorama = () => {
    cam.target = [2, 0, 2];
    cam.distance = 105;
    cam.pitch = 48 * DEG;
    cam.yaw = 38 * DEG;
  };
  if (mode === 'gallery') frameGallery(selected);
  else frameDiorama();
  if (cameo) {
    const a = manifest.assets.find((m) => m.id === selected)!;
    const b = a.bounds;
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1] * 0.8, b.max[2] - b.min[2]);
    cam.target = [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) * 0.45, (b.max[2] + b.min[2]) / 2];
    cam.fov = 22 * DEG;
    cam.distance = size * 2.9 + 0.3;
    cam.pitch = (a.category === 'unit' ? 18 : 32) * DEG;
    cam.yaw = 35 * DEG;
  }
  cam.yaw = num('yaw', cam.yaw / DEG) * DEG;
  cam.pitch = num('pitch', cam.pitch / DEG) * DEG;
  cam.distance = num('dist', cam.distance);
  if (params.has('tx')) cam.target = [num('tx', 0), num('ty', cam.target[1]), num('tz', 0)];
  if (params.has('fov')) cam.fov = num('fov', 30) * DEG;

  // ---------------------------------------------------------------- UI
  const modesEl = document.getElementById('modes')!;
  const listEl = document.getElementById('list')!;
  const infoEl = document.getElementById('info')!;
  const statsEl = document.getElementById('stats')!;
  const renderModes = () => {
    modesEl.innerHTML = '';
    for (const m of ['diorama', 'gallery'] as const) {
      const b = document.createElement('button');
      b.textContent = m === 'diorama' ? 'Diorama' : 'Gallery';
      b.className = mode === m ? 'on' : '';
      b.onclick = () => {
        mode = m;
        if (m === 'gallery') {
          frameGallery(selected);
          turntable = true;
        } else {
          frameDiorama();
          turntable = false;
        }
        refreshUI();
      };
      modesEl.appendChild(b);
    }
  };
  const teamsEl = document.getElementById('teams')!;
  teamColors.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'sw' + (i === team ? ' on' : '');
    s.style.background = '#' + c.toString(16).padStart(6, '0');
    s.title = teamKeys[i];
    s.onclick = () => {
      team = i;
      [...teamsEl.children].forEach((c2, j) => c2.classList.toggle('on', j === i));
    };
    teamsEl.appendChild(s);
  });
  const rotateBtn = document.getElementById('rotate')!;
  rotateBtn.onclick = () => {
    turntable = !turntable;
    refreshUI();
  };
  const gridBtn = document.getElementById('grid')!;
  gridBtn.onclick = () => {
    showGrid = !showGrid;
    refreshUI();
  };
  const CAT_LABEL: Record<string, string> = { structure: 'Structures', unit: 'Units', environment: 'Environment', resource: 'Resources' };
  const refreshUI = () => {
    renderModes();
    rotateBtn.className = turntable ? 'on' : '';
    gridBtn.className = showGrid ? 'on' : '';
    listEl.innerHTML = '';
    for (const cat of ['structure', 'unit', 'resource', 'environment']) {
      const items = manifest.assets.filter((a) => a.category === cat);
      if (!items.length) continue;
      const h = document.createElement('h3');
      h.textContent = CAT_LABEL[cat];
      listEl.appendChild(h);
      for (const a of items) {
        const d = document.createElement('div');
        d.className = 'item' + (a.id === selected && mode === 'gallery' ? ' on' : '');
        d.innerHTML = `<span>${a.name}</span><span class="hz">${a.hanzi ?? ''}</span>`;
        d.onclick = () => {
          selected = a.id;
          mode = 'gallery';
          animOverride = null;
          turntable = true;
          frameGallery(a.id);
          refreshUI();
        };
        listEl.appendChild(d);
      }
    }
    const a = manifest.assets.find((m) => m.id === selected)!;
    if (mode === 'gallery' && a) {
      infoEl.style.display = 'block';
      infoEl.innerHTML = `<div><span class="name">${a.name}</span><span class="hz">${a.hanzi ?? ''}</span></div>
        <div class="meta">${CAT_LABEL[a.category] ?? a.category}${a.footprint ? ` · footprint ${a.footprint[0]}×${a.footprint[1]} cells (${a.footprint[0] * CELL_SIZE}×${a.footprint[1] * CELL_SIZE} m)` : ''}<br>${a.triangles.toLocaleString()} triangles</div>
        <div class="anims">${a.animations.map((n) => `<button data-anim="${n}" class="${(animOverride ?? a.animations[0]) === n ? 'on' : ''}">${n}</button>`).join('')}</div>`;
      infoEl.querySelectorAll('button[data-anim]').forEach((b) => ((b as HTMLButtonElement).onclick = () => {
        animOverride = (b as HTMLElement).dataset.anim!;
        refreshUI();
      }));
    } else infoEl.style.display = 'none';
  };
  refreshUI();
  document.getElementById('loading')!.remove();

  // ---------------------------------------------------------------- loop
  const fixedTime = params.has('time') ? num('time', 0) : null;
  const t0 = platform.now();
  let frames = 0;
  let last = platform.now();
  let fpsAcc = 0, fpsN = 0, fps = 0;
  const input = platform.input;

  const frame = () => {
    const now = platform.now();
    const dt = Math.min(0.05, now - last);
    last = now;
    const time = fixedTime ?? now - t0;

    // controls
    const p = input.pointer;
    if (p.buttons & 1) {
      cam.yaw -= p.dx * 0.005;
      cam.pitch = clamp(cam.pitch + p.dy * 0.004, 8 * DEG, 85 * DEG);
      if (Math.abs(p.dx) > 0) turntable = false;
    }
    if (p.buttons & 6) cam.pan(-p.dx * cam.distance * 0.0012, -p.dy * cam.distance * 0.0016);
    if (p.wheel) cam.zoom(p.wheel);
    const k = input.keys;
    const sp = cam.distance * 0.9 * dt;
    if (k.has('KeyW') || k.has('ArrowUp')) cam.pan(0, sp);
    if (k.has('KeyS') || k.has('ArrowDown')) cam.pan(0, -sp);
    if (k.has('KeyA') || k.has('ArrowLeft')) cam.pan(-sp, 0);
    if (k.has('KeyD') || k.has('ArrowRight')) cam.pan(sp, 0);
    if (k.has('KeyQ')) cam.yaw += dt * 1.2;
    if (k.has('KeyE')) cam.yaw -= dt * 1.2;
    if (input.pressed.has('KeyG')) {
      showGrid = !showGrid;
      refreshUI();
    }
    if (turntable && fixedTime === null) cam.yaw += dt * 0.25;
    input.endFrame();

    // scene
    const instances: RenderInstance[] = [];
    if (mode === 'gallery') {
      const m = models.get(selected)!;
      const e = manifest.assets.find((a) => a.id === selected)!;
      instances.push({ model: m, matrix: m4FromTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]), team, anim: animOverride ?? e.animations[0], animTime: time });
    } else {
      for (const it of layout.items) {
        const m = models.get(it.id);
        if (!m) continue;
        let pos = it.pos;
        let yaw = it.yaw;
        let anim = it.anim;
        if (it.path) {
          const s = it.path.sample(time * (it.speed ?? 1.2) + (it.phase ?? 0));
          pos = [s.x, heightAt(terrain, s.x, s.z), s.z];
          yaw = s.yaw;
          anim = s.moving ? it.anim : it.idleAnim ?? it.anim;
        }
        instances.push({
          model: m,
          matrix: m4FromTRS(pos, quatAxisAngle([0, 1, 0], yaw), [it.scale ?? 1, it.scale ?? 1, it.scale ?? 1]),
          team: it.team ?? team,
          anim,
          animTime: time + (it.phase ?? 0),
        });
      }
    }

    const aspect = device.backbufferWidth / device.backbufferHeight;
    const camera = cam.build(aspect, device.caps.clip, mode === 'gallery' ? Math.max(12, cam.distance * 0.9) : undefined);
    renderer.render({
      camera,
      instances,
      time,
      terrain: cameo ? null : terrainGpu,
      sky: !cameo,
      clearColor: cameo ? [0.08, 0.1, 0.13] : undefined,
      lighting: DEFAULT_LIGHTING,
      teamColors,
      grid: showGrid ? { cell: CELL_SIZE, opacity: 0.35 } : undefined,
    });

    frames++;
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc > 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
      const s = renderer.stats;
      statsEl.textContent = `${fps.toFixed(0)} fps · ${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · ${s.instances} inst · ${device.caps.backend}`;
    }
    (window as any).__viewer = { ready: frames > 3, frames, error: null };
    platform.requestFrame(frame);
  };
  platform.requestFrame(frame);
  void terrainGpu;
  (window as any).__rebuildTerrain = () => (terrainGpu = buildTerrainGpu(device, terrain));
}

// ------------------------------------------------------------------ diorama layout
interface PathSampler {
  sample(t: number): { x: number; z: number; yaw: number; moving: boolean };
}
interface LayoutItem {
  id: string;
  pos: V3;
  yaw: number;
  team?: number;
  scale?: number;
  anim?: string;
  idleAnim?: string;
  path?: PathSampler;
  speed?: number;
  phase?: number;
}

function loopPath(pts: [number, number][], pause = 0): PathSampler {
  const segs: { a: [number, number]; b: [number, number]; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len });
    total += len;
  }
  const cycle = total + pause * pts.length;
  return {
    sample(t: number) {
      let d = ((t % cycle) + cycle) % cycle;
      for (const s of segs) {
        if (d < pause) return { x: s.a[0], z: s.a[1], yaw: Math.atan2(s.b[0] - s.a[0], s.b[1] - s.a[1]), moving: false };
        d -= pause;
        if (d <= s.len) {
          const f = d / s.len;
          return { x: s.a[0] + (s.b[0] - s.a[0]) * f, z: s.a[1] + (s.b[1] - s.a[1]) * f, yaw: Math.atan2(s.b[0] - s.a[0], s.b[1] - s.a[1]), moving: true };
        }
        d -= s.len;
      }
      return { x: pts[0][0], z: pts[0][1], yaw: 0, moving: false };
    },
  };
}

function buildDiorama(assets: ManifestEntry[], terrain: TerrainData) {
  const has = new Set(assets.map((a) => a.id));
  const items: LayoutItem[] = [];
  const add = (id: string, x: number, z: number, yawDeg = 0, extra: Partial<LayoutItem> = {}) => {
    if (!has.has(id)) return;
    const e = assets.find((a) => a.id === id)!;
    let y = heightAt(terrain, x, z);
    if (e.category === 'structure' && e.footprint) y = flattenRect(terrain, x, z, e.footprint[0] * CELL_SIZE + 1, e.footprint[1] * CELL_SIZE + 1, 3);
    items.push({ id, pos: [x, y, z], yaw: yawDeg * DEG, ...extra });
  };
  // --- the base (Azure Dynasty, player team)
  add('azure_command_hall', 0, -4, 0);
  add('azure_qi_shrine', -15, -9, 0);
  add('azure_qi_shrine', -15, -1, 0);
  add('azure_barracks', 14, -6, 0);
  add('azure_jade_refinery', 16, 12, -90);
  add('azure_workshop', -16, 13, 90);
  add('azure_arrow_tower', -8, 22, 0);
  add('azure_arrow_tower', 8, 22, 0);
  add('azure_arrow_tower', 22, -10, 0);
  for (let x = -4.5; x <= 4.5; x += 3) add('azure_wall', x, 22, 0);
  // --- units
  const R = rng(42);
  // halberdier drill formation in front of the barracks
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) add('azure_halberdier', 9 + j * 1.6, 3 + i * 1.6, 180, { anim: i === 1 ? 'attack' : 'idle', phase: R.next() * 2 });
  // archers practising
  for (let i = 0; i < 4; i++) add('azure_archer', 22 + i * 1.5, -1, 200, { anim: 'attack', phase: i * 0.37 });
  // daoists at the shrines
  add('azure_daoist', -10.5, -5, -90, { anim: 'attack', phase: 0.3 });
  add('azure_daoist', -10.5, -3, -90, { anim: 'idle', phase: 1.1 });
  // patrol along the wall
  for (let i = 0; i < 4; i++) {
    items.push({ id: 'azure_halberdier', pos: [0, 0, 0], yaw: 0, anim: 'walk', idleAnim: 'idle', path: loopPath([[-11, 15.5], [11, 15.5], [11, 19], [-11, 19]], 1.5), speed: 1.4, phase: i * 1.4 });
  }
  // wooden ox harvesting run between refinery dock and the jade field
  for (let i = 0; i < 2; i++) {
    items.push({ id: 'azure_wooden_ox', pos: [0, 0, 0], yaw: 0, anim: 'walk', idleAnim: 'harvest', path: loopPath([[20, 5], [26, -8], [28, -22], [26, -8]], 3), speed: 2.2, phase: i * 18 });
  }
  // --- resources & environment
  const J = rng(9);
  for (let i = 0; i < 22; i++) {
    const a = J.next() * Math.PI * 2, r = Math.sqrt(J.next()) * 8;
    const x = 28 + Math.cos(a) * r, z = -24 + Math.sin(a) * r;
    add(J.next() < 0.3 ? 'res_jade_large' : 'res_jade_small', x, z, J.next() * 360, { scale: 0.8 + J.next() * 0.5 });
  }
  const T = rng(3);
  const size = terrain.cellsX * terrain.cellSize;
  const isFree = (x: number, z: number, r: number) => {
    if (Math.hypot(x, z - 2) < 30) return false;
    if (Math.hypot(x - 28, z + 24) < 12) return false;
    const h = heightAt(terrain, x, z);
    if (h < terrain.waterLevel + 0.5) return false;
    return !items.some((it) => Math.hypot(it.pos[0] - x, it.pos[2] - z) < r);
  };
  const scatter = (id: string, count: number, minR: number, clusterFn?: (x: number, z: number) => number) => {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 40) {
      tries++;
      const x = (T.next() - 0.5) * size * 0.96, z = (T.next() - 0.5) * size * 0.96;
      if (clusterFn && T.next() > clusterFn(x, z)) continue;
      if (!isFree(x, z, minR)) continue;
      add(id, x, z, T.next() * 360, { scale: 0.8 + T.next() * 0.45, phase: T.next() * 10 });
      placed++;
    }
  };
  const grove = (cx: number, cz: number, r: number) => (x: number, z: number) => Math.max(0, 1 - Math.hypot(x - cx, z - cz) / r);
  scatter('env_pine', 70, 3.2, (x, z) => Math.max(grove(-40, -40, 28)(x, z), grove(45, 30, 25)(x, z), grove(-50, 0, 18)(x, z), 0.15));
  scatter('env_bamboo', 40, 2.2, (x, z) => Math.max(grove(-22, 44, 18)(x, z), grove(40, -50, 14)(x, z), 0.05));
  scatter('env_peach_tree', 22, 3.5, (x, z) => Math.max(grove(-18, 32, 16)(x, z), grove(30, 36, 14)(x, z), 0.08));
  scatter('env_rock', 30, 2.5, (x, z) => Math.max(grove(38, -40, 16)(x, z), 0.2));
  scatter('env_scholar_rock', 4, 4, (x, z) => grove(-30, 20, 20)(x, z));
  return { items };
}

main().catch(showError);
