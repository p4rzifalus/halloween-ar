import * as THREE from 'three';

// Scene is calibrated in layers.json:
//   x, y, w, h — layer position on the poster in pixels (from the Figma frame, 1190×1684)
//   z          — how far the layer floats above the paper, in poster widths
//   shadow     — strength of the shadow it casts on the paper
//   cameraDistance — typical viewing distance, in poster widths.
// Each layer is shrunk by (D − z) / D, so seen head-on from that distance
// the stack lines up exactly with the print and only separates when you move.

const ease = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

export async function buildPoster(base = './assets/') {
  const meta = await (await fetch(base + 'layers.json')).json();
  const { W, H } = meta;
  const D = meta.cameraDistance || 1.6;
  const maxZ = Math.max(...meta.layers.map((l) => l.z || 0)) || 1;
  const loader = new THREE.TextureLoader();
  const group = new THREE.Group();
  const layers = {};

  await Promise.all(meta.layers.map(async (L, i) => {
    const tex = await loader.loadAsync(base + L.file);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const w = L.w / W, h = L.h / W;
    const geo = new THREE.PlaneGeometry(w, h);
    const cx = (L.x + L.w / 2) / W - 0.5;
    const cy = -((L.y + L.h / 2) / W - (H / W) / 2);
    const isPlate = L.name === 'plate';

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: !isPlate, depthWrite: isPlate, depthTest: isPlate,
      blending: L.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, 0);
    mesh.renderOrder = i * 2 + 1;
    group.add(mesh);

    let shadow = null;
    if (L.shadow) {
      const smat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
      shadow = new THREE.Mesh(geo, smat);
      shadow.position.set(cx, cy, 0.001);
      shadow.renderOrder = 1; // shadows always land on the paper, under every layer
      group.add(shadow);
    }
    layers[L.name] = { mesh, shadow, cx, cy, z: L.z || 0, k: (D - (L.z || 0)) / D, shadowMax: L.shadow || 0,
      delay: ((L.z || 0) / maxZ) * 0.45 };
  }));

  let target = 0, progress = 0, last = 0;

  function place(L, lp, extraZ = 0) {
    const z = L.z * lp + extraZ;
    const k = 1 - (1 - L.k) * lp;               // perspective compensation grows with lift
    L.mesh.position.set(L.cx * k, L.cy * k, z);
    L.mesh.scale.set(k, k, 1);
    if (L.shadow) {
      L.shadow.material.opacity = L.shadowMax * lp;
      L.shadow.position.set(L.cx + 0.06 * L.z * lp, L.cy - 0.08 * L.z * lp, 0.001);
      L.shadow.scale.setScalar(1 + 0.15 * L.z * lp);
    }
  }

  function update(t) {
    const dt = Math.min(t - last, 0.1); last = t;
    progress += (target - progress) * Math.min(dt * 2.6, 1);
    const p = ease(progress);

    for (const [name, L] of Object.entries(layers)) {
      if (name === 'plate') continue;
      const lp = ease((progress - L.delay) / (1 - L.delay));
      let dz = 0;
      if (name === 'freddy') {
        dz = Math.sin(t * 1.3) * 0.01 * lp;
        place(L, lp, dz);
        const s = L.mesh.scale.x * (1 + Math.sin(t * 1.3) * 0.01 * lp);
        L.mesh.scale.set(s, s, 1);
        L.mesh.rotation.z = Math.sin(t * 0.7) * 0.02 * lp;
        continue;
      }
      if (name === 'claw') {
        place(L, lp, Math.sin(t * 0.9 + 0.6) * 0.012 * lp);
        continue;
      }
      place(L, lp);
      if (name === 'sparkles') {
        const c = layers.claw;
        if (c) L.mesh.position.z += c.mesh.position.z - c.z * lp;
        L.mesh.material.opacity = (0.55 + 0.45 * Math.sin(t * 5.1) * Math.sin(t * 2.3)) * lp;
      }
      if (name === 'kids') L.mesh.position.x += Math.sin(t * 0.8) * 0.003 * lp;
    }
  }

  return {
    group, update,
    reveal() { target = 1; },
    hide() { target = 0; progress = 0; },
    aspect: H / W,
  };
}
