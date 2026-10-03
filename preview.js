import * as THREE from 'three';
import { buildPoster } from './poster3d.js';

export async function startPreviewScene(container, base = './assets/') {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 50);
  const poster = await buildPoster(base);
  const pivot = new THREE.Group();
  pivot.add(poster.group);
  scene.add(pivot);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // fit the poster with a margin
    const fitH = poster.aspect * 1.25, fitW = 1.25;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / Math.tan(vFov / 2) / camera.aspect;
    camera.position.set(0, 0, Math.max(distH, distW));
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  // pointer / tilt parallax
  let tx = 0, ty = 0, active = 0;
  addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
    active = 3;
  });
  addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    tx = Math.max(-1, Math.min(1, e.gamma / 25));
    ty = Math.max(-1, Math.min(1, (e.beta - 45) / 25));
    active = 3;
  });

  const hint = document.createElement('div');
  hint.textContent = 'Двигай мышью или наклоняй телефон · клик — заново';
  Object.assign(hint.style, {
    position: 'fixed', left: '50%', bottom: 'calc(max(16px, calc(env(safe-area-inset-bottom) + 8px)) + 64px)', transform: 'translateX(-50%)',
    padding: '10px 18px', borderRadius: '999px', background: 'rgba(7,18,26,.72)',
    color: '#f1e6cf', font: '14px "Helvetica Neue", Arial, sans-serif', whiteSpace: 'nowrap', zIndex: 5,
  });
  document.body.appendChild(hint);

  renderer.domElement.addEventListener('click', async () => {
    // iOS needs permission for tilt
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try { await DeviceOrientationEvent.requestPermission(); } catch {}
    }
    poster.hide(); setTimeout(() => poster.reveal(), 350);
  });

  setTimeout(() => poster.reveal(), 500);
  const clock = new THREE.Clock();
  let rx = 0, ry = 0, last = 0;
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime(); const dt = t - last; last = t;
    active = Math.max(0, active - dt);
    const idle = active === 0;
    const gx = idle ? Math.sin(t * 0.5) * 0.7 : tx;
    const gy = idle ? Math.sin(t * 0.37) * 0.35 : ty;
    ry += (gx * 0.38 - ry) * 0.06;
    rx += (gy * 0.28 - rx) * 0.06;
    pivot.rotation.set(rx, ry, 0);
    poster.update(t);
    renderer.render(scene, camera);
  });
}
