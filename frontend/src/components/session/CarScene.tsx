import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CarSceneProps {
  /** SoC reportado por el cargador; sin dato la batería se muestra vacía y apagada. */
  soc?: number;
  /** El conector está entregando energía (anima cable, puerto y LED). */
  charging: boolean;
  /** Hay un vehículo conectado (si no, no se dibuja el cable). */
  plugged: boolean;
}

const CELLS = 14;
const PARTICLES = 9;
const CAMERA_HOME = new THREE.Vector3(5.4, 2.7, 6.6);
const TARGET = new THREE.Vector3(0.5, 0.65, 0.35);

/** Lee un token de color de styles/tokens.css para que la escena siga el tema. */
const token = (name: string, fallback: string) =>
  new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/** Silueta lateral propia (sedán genérico), con pasos de rueda. Eje X = largo, Y = alto. */
const bodyShape = () => {
  const s = new THREE.Shape();
  s.moveTo(-2.25, 0.36);
  s.lineTo(-2.3, 0.72);
  s.quadraticCurveTo(-2.3, 0.96, -2.05, 0.99);
  s.lineTo(-1.55, 1.03);
  s.quadraticCurveTo(-1.0, 1.42, -0.3, 1.46);
  s.lineTo(0.35, 1.45);
  s.quadraticCurveTo(0.92, 1.41, 1.36, 1.01);
  s.lineTo(2.05, 0.87);
  s.quadraticCurveTo(2.36, 0.8, 2.32, 0.56);
  s.lineTo(2.25, 0.36);
  s.lineTo(1.93, 0.36);
  s.absarc(1.45, 0.36, 0.48, 0, Math.PI, false);
  s.lineTo(-0.97, 0.36);
  s.absarc(-1.45, 0.36, 0.48, 0, Math.PI, false);
  s.lineTo(-2.25, 0.36);
  return s;
};

const glassShape = () => {
  const s = new THREE.Shape();
  s.moveTo(-1.42, 1.06);
  s.quadraticCurveTo(-0.95, 1.37, -0.3, 1.4);
  s.lineTo(0.33, 1.39);
  s.quadraticCurveTo(0.86, 1.35, 1.24, 1.04);
  s.lineTo(-1.42, 1.06);
  return s;
};

const extrude = (shape: THREE.Shape, depth: number, bevel: number) => {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments: 28,
  });
  g.translate(0, 0, -depth / 2);
  return g;
};

/**
 * Escena 3D (three.js) con vehículo, batería visible a través de la carrocería
 * translúcida, poste de carga y cable. Arrastrar orbita la cámara, rueda = zoom,
 * doble clic vuelve a la vista inicial. Todo el modelo es geometría propia.
 */
export const CarScene = ({ soc, charging, plugged }: CarSceneProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const props = useRef<CarSceneProps>({ soc, charging, plugged });
  props.current = { soc, charging, plugged };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const colors = {
      carHi: token('--car-hi', '#8fb8ff'),
      carLine: token('--car-line', '#a0c4ff'),
      ok: token('--ok', '#3ddc97'),
      accent: token('--accent', '#4f9cff'),
      danger: token('--danger', '#f06464'),
      muted: token('--muted', '#7d8692'),
      surface: token('--surface-2', '#151a20'),
    };

    // ── Renderer, cámara, controles ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.copy(CAMERA_HOME);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(TARGET);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 13;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.45;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.5;
    controls.addEventListener('start', () => (controls.autoRotate = false));
    const onDoubleClick = () => {
      camera.position.copy(CAMERA_HOME);
      controls.target.copy(TARGET);
    };
    renderer.domElement.addEventListener('dblclick', onDoubleClick);

    // ── Luces ──
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x0a0c10, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    scene.add(key);
    const rim = new THREE.DirectionalLight(colors.accent, 1.4);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    // ── Suelo ──
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 64),
      new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.2, 96),
      new THREE.MeshBasicMaterial({ color: colors.accent, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.005;
    scene.add(halo);

    // ── Vehículo ──
    const car = new THREE.Group();
    scene.add(car);

    const bodyGeo = extrude(bodyShape(), 1.74, 0.08);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: colors.carHi,
      metalness: 0.35,
      roughness: 0.22,
      clearcoat: 1,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.renderOrder = 2;
    car.add(body);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo, 28),
      new THREE.LineBasicMaterial({ color: colors.carLine, transparent: true, opacity: 0.55 }),
    );
    car.add(edges);

    const glass = new THREE.Mesh(
      extrude(glassShape(), 1.88, 0.02),
      new THREE.MeshPhysicalMaterial({ color: 0x0d1724, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.55 }),
    );
    glass.renderOrder = 1;
    car.add(glass);

    const floorPan = new THREE.Mesh(
      new THREE.BoxGeometry(3.9, 0.05, 1.66),
      new THREE.MeshStandardMaterial({ color: 0x0c1118, roughness: 0.8 }),
    );
    floorPan.position.y = 0.4;
    floorPan.castShadow = true;
    car.add(floorPan);

    // Batería: celdas que se encienden según el SoC.
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.16, 1.42),
      new THREE.MeshStandardMaterial({ color: 0x0a0f16, roughness: 0.6, metalness: 0.3 }),
    );
    pack.position.set(0.05, 0.5, 0);
    car.add(pack);
    const cellW = 2.88 / CELLS;
    const cellGeo = new THREE.BoxGeometry(cellW - 0.035, 0.1, 1.3);
    const cellMats = Array.from(
      { length: CELLS },
      () => new THREE.MeshStandardMaterial({ color: colors.surface, emissive: colors.ok, emissiveIntensity: 0, roughness: 0.4 }),
    );
    cellMats.forEach((mat, i) => {
      const cell = new THREE.Mesh(cellGeo, mat);
      cell.position.set(0.05 - 1.44 + cellW * (i + 0.5), 0.6, 0);
      car.add(cell);
    });

    // Ruedas
    const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.27, 48);
    const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.28, 7);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: colors.carLine, metalness: 0.9, roughness: 0.25 });
    for (const x of [1.45, -1.45]) {
      for (const z of [0.83, -0.83]) {
        const wheel = new THREE.Group();
        const tire = new THREE.Mesh(tireGeo, tireMat);
        const rimMesh = new THREE.Mesh(rimGeo, rimMat);
        tire.castShadow = true;
        wheel.add(tire, rimMesh);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.38, z);
        car.add(wheel);
      }
    }

    // Faros y pilotos
    const lightGeo = new THREE.BoxGeometry(0.04, 0.05, 1.3);
    const front = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xdcebff }));
    front.position.set(2.31, 0.76, 0);
    const rear = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: colors.danger }));
    rear.position.set(-2.33, 0.86, 0);
    car.add(front, rear);

    // Puerto de carga (aleta delantera, lado +Z)
    const portPos = new THREE.Vector3(1.68, 0.88, 0.95);
    const portMat = new THREE.MeshStandardMaterial({ color: colors.accent, emissive: colors.accent, emissiveIntensity: 0.4 });
    const port = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 20), portMat);
    port.position.copy(portPos);
    car.add(port);
    const portLight = new THREE.PointLight(colors.ok, 0, 2.2);
    portLight.position.copy(portPos).add(new THREE.Vector3(0, 0, 0.15));
    car.add(portLight);

    // ── Poste de carga ──
    const post = new THREE.Group();
    post.position.set(3.45, 0, 1.75);
    post.rotation.y = -0.5;
    const postBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 1.75, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.5, metalness: 0.4 }),
    );
    postBody.position.y = 0.875;
    postBody.castShadow = true;
    const screenMat = new THREE.MeshBasicMaterial({ color: colors.accent, transparent: true, opacity: 0.35 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.34), screenMat);
    screen.position.set(0, 1.35, 0.171);
    const ledMat = new THREE.MeshBasicMaterial({ color: colors.muted });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.02), ledMat);
    led.position.set(0, 1.08, 0.172);
    post.add(postBody, screen, led);
    scene.add(post);

    // ── Cable + partículas de energía ──
    const cableCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(3.3, 0.95, 1.95),
      new THREE.Vector3(3.15, 0.25, 1.85),
      new THREE.Vector3(2.55, 0.1, 1.6),
      new THREE.Vector3(2.0, 0.42, 1.25),
      portPos.clone(),
    ]);
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(cableCurve, 80, 0.035, 10, false),
      new THREE.MeshStandardMaterial({ color: 0x1c232c, roughness: 0.6 }),
    );
    cable.castShadow = true;
    scene.add(cable);
    const particleMat = new THREE.MeshBasicMaterial({ color: colors.ok });
    const particleGeo = new THREE.SphereGeometry(0.03, 10, 10);
    const particles = Array.from({ length: PARTICLES }, () => {
      const p = new THREE.Mesh(particleGeo, particleMat);
      scene.add(p);
      return p;
    });

    // ── Tamaño ──
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // En contenedores angostos se aleja la cámara para que el auto quepa.
      camera.fov = w / h < 1.2 ? 44 : 32;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // ── Animación ──
    const clock = new THREE.Clock();
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const { soc: s, charging: on, plugged: connected } = props.current;
      const level = s === undefined ? 0 : Math.max(0, Math.min(100, s)) / 100;
      const lit = Math.round(level * CELLS);
      const pulse = on && !reduceMotion ? 0.65 + 0.35 * Math.sin(t * 4) : 1;

      cellMats.forEach((mat, i) => {
        const isOn = i < lit;
        // La última celda encendida late mientras carga.
        mat.emissiveIntensity = isOn ? (on && i === lit - 1 ? 1.4 * pulse : 0.9) : 0;
        mat.color.copy(isOn ? colors.ok : colors.surface);
      });

      cable.visible = connected;
      portMat.emissive.copy(on ? colors.ok : colors.accent);
      portMat.emissiveIntensity = connected ? (on ? 1.6 * pulse : 0.8) : 0.25;
      portLight.intensity = on ? 1.2 * pulse : 0;
      ledMat.color.copy(on ? colors.ok : connected ? colors.accent : colors.muted);
      screenMat.color.copy(on ? colors.ok : colors.accent);
      bodyMat.opacity = connected ? 0.3 : 0.22;

      particles.forEach((p, i) => {
        p.visible = on && connected;
        if (!p.visible) return;
        const u = reduceMotion ? i / PARTICLES : (t * 0.35 + i / PARTICLES) % 1;
        p.position.copy(cableCurve.getPointAt(u));
      });

      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const label =
    soc === undefined
      ? 'Vehículo en 3D · sin dato de batería'
      : `Vehículo en 3D · batería al ${Math.round(soc)} %${charging ? ', cargando' : ''}`;

  return <div ref={hostRef} className={`scene ${charging ? 'is-charging' : ''}`} role="img" aria-label={label} />;
};
