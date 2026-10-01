import * as THREE from 'three';

// Scene is calibrated in layers.json:
//   x, y, w, h — layer position on the poster in pixels (from the Figma frame, 1190×1684)
//   z          — how far the layer floats above the paper, in poster widths
//   shadow     — strength of the shadow it casts on the paper
//   bulge      — how much the middle of the layer swells toward the viewer, in poster widths
//   thickness  — depth of the cut-out's side wall, in poster widths
//   cameraDistance — typical viewing distance, in poster widths.
// Each layer is shrunk by (D − z) / D, so seen head-on from that distance
// the stack lines up exactly with the print and only separates when you move.
//
// Options:
//   plate — draw the background layer. Off in AR, where the real print is the background.
//   idle  — gentle floating motion. Off in AR, so the scene stays locked to the poster.

const ease = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const REVEAL_SPEED = 4.5;   // higher = layers pop out faster
const SLICES = 10;          // copies stacked to build the side wall of a thick layer

// Plane that swells into a soft dome. The dome is zero on the layer's edges,
// and each vertex is pulled toward the poster centre by z / D so the swollen
// part still lines up with the print when seen head-on.
function domeGeometry(w, h, cx, cy, bulge, D) {
  const geo = new THREE.PlaneGeometry(w, h, 32, 32);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const u = x / (w / 2), v = y / (h / 2);
    const z = bulge * (1 - u * u) * (1 - v * v);
    const k = z / D;
    pos.setXYZ(i, x - (cx + x) * k, y - (cy + y) * k, z);
  }
  pos.needsUpdate = true;
  return geo;
}

export async function buildPoster(base = './assets/', { plate = true, idle = true } = {}) {
  const meta = await (await fetch(base + 'layers.json')).json();
  const { W, H } = meta;
  const D = meta.cameraDistance || 1.6;
  const maxZ = Math.max(...meta.layers.map((l) => l.z || 0)) || 1;
  const loader = new THREE.TextureLoader();
  const group = new THREE.Group();
  const layers = {};

  await Promise.all(meta.layers.map(async (L, i) => {
    const isPlate = L.name === 'plate';
    if (isPlate && !plate) return;
    const tex = await loader.loadAsync(base + L.file);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const w = L.w / W, h = L.h / W;
    const cx = (L.x + L.w / 2) / W - 0.5;
    const cy = -((L.y + L.h / 2) / W - (H / W) / 2);
    const flat = new THREE.PlaneGeometry(w, h);
    const geo = L.bulge ? domeGeometry(w, h, cx, cy, L.bulge, D) : flat;
    const order = 10 + i * 100;

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: !isPlate, depthWrite: isPlate, depthTest: isPlate,
      blending: L.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, 0);
    mesh.renderOrder = order + SLICES;
    group.add(mesh);

    // side wall: darkened copies behind the layer, revealed when you look from an angle
    const slices = [];
    if (L.thickness) {
      for (let j = 1; j <= SLICES; j++) {
        const shade = 0.55 - 0.35 * (j / SLICES);
        const smat = new THREE.MeshBasicMaterial({
          map: tex, color: new THREE.Color(shade, shade * 0.85, shade * 0.8),
          transparent: true, depthWrite: false, depthTest: false,
        });
        const s = new THREE.Mesh(geo, smat);
        s.renderOrder = order + SLICES - j;   // farthest slice first
        mesh.add(s);
        slices.push({ mesh: s, f: j / SLICES });
      }
    }

    let shadow = null;
    if (L.shadow) {
      const smat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
      shadow = new THREE.Mesh(flat, smat);
      shadow.position.set(cx, cy, 0.001);
      shadow.renderOrder = 1; // shadows always land on the paper, under every layer
      group.add(shadow);
    }
    layers[L.name] = { mesh, shadow, slices, thickness: L.thickness || 0, cx, cy, z: L.z || 0,
      k: (D - (L.z || 0)) / D, shadowMax: L.shadow || 0, delay: ((L.z || 0) / maxZ) * 0.45 };
  }));

  let target = 0, progress = 0, last = 0;

  function place(L, lp, extraZ = 0) {
    const z = L.z * lp + extraZ;
    const k = 1 - (1 - L.k) * lp;               // perspective compensation grows with lift
    L.mesh.position.set(L.cx * k, L.cy * k, z);
    L.mesh.scale.set(k, k, 1);
    for (const s of L.slices) s.mesh.position.z = -L.thickness * s.f * lp;
    if (L.shadow) {
      L.shadow.material.opacity = L.shadowMax * lp;
      L.shadow.position.set(L.cx + 0.06 * L.z * lp, L.cy - 0.08 * L.z * lp, 0.001);
      L.shadow.scale.setScalar(1 + 0.15 * L.z * lp);
    }
  }

  function update(t) {
    const dt = Math.min(t - last, 0.1); last = t;
    progress += (target - progress) * Math.min(dt * REVEAL_SPEED, 1);
    const a = idle ? 1 : 0;   // amplitude of the floating motion

    for (const [name, L] of Object.entries(layers)) {
      if (name === 'plate') continue;
      const lp = ease((progress - L.delay) / (1 - L.delay));
      if (name === 'freddy') {
        place(L, lp, Math.sin(t * 1.3) * 0.01 * lp * a);
        const s = L.mesh.scale.x * (1 + Math.sin(t * 1.3) * 0.01 * lp * a);
        L.mesh.scale.set(s, s, 1);
        L.mesh.rotation.z = Math.sin(t * 0.7) * 0.02 * lp * a;
        continue;
      }
      if (name === 'claw') {
        place(L, lp, Math.sin(t * 0.9 + 0.6) * 0.012 * lp * a);
        continue;
      }
      place(L, lp);
      if (name === 'sparkles') {
        const c = layers.claw;
        if (c) L.mesh.position.z += c.mesh.position.z - c.z * lp;
        L.mesh.material.opacity = (0.55 + 0.45 * Math.sin(t * 5.1) * Math.sin(t * 2.3)) * lp;
      }
      if (name === 'kids') L.mesh.position.x += Math.sin(t * 0.8) * 0.003 * lp * a;
    }
  }

  return {
    group, update,
    reveal() { target = 1; },
    hide() { target = 0; progress = 0; },
    aspect: H / W,
  };
}
