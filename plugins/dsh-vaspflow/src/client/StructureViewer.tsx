/**
 * dsh-vaspflow client: 3D structure viewer — port of StructureViewer.tsx
 * (three.js direct, no react-three-fiber): orthographic camera, atom spheres,
 * bonds, unit cell, orbit/pan/zoom, camera memory, structure file tabs.
 */
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Spin, Empty, Tabs, Tooltip, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchStructureFiles, fetchStructureScene, structureSceneToViewerStructure } from './api';
import type { ViewerStructure, StructureScene } from './api';
import { elementColors } from './elementColors';

const CAMERA_STORE_PREFIX = 'dsh-vaspflow:structure-camera:v5:';
const CAMERA_STORE_VERSION = 5;

function vectorLength(v?: number[]): number | null {
  if (!v) return null;
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}

/** Cell center = (a + b + c) / 2 of the lattice vectors. */
function cellCenterOf(lattice: number[][] | undefined): [number, number, number] {
  if (!lattice || lattice.length < 3) return [0, 0, 0];
  return [
    (lattice[0][0] + lattice[1][0] + lattice[2][0]) / 2,
    (lattice[0][1] + lattice[1][1] + lattice[2][1]) / 2,
    (lattice[0][2] + lattice[1][2] + lattice[2][2]) / 2,
  ];
}

function atomColor(element: string): string {
  const normalized = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase();
  return elementColors[normalized as keyof typeof elementColors] ?? '#888888';
}

/** Van der Waals radii by element symbol (Å) — ported from crystvis-js. */
const VDW_RADIUS: Record<string, number> = {
  H: 1.2, He: 1.4, Li: 1.82, Be: 1.7, B: 2.08, C: 1.95, N: 1.55, O: 1.7,
  F: 1.73, Ne: 1.54, Na: 2.27, Mg: 1.73, Al: 2.05, Si: 2.1, P: 2.08, S: 2.0,
  Cl: 1.97, Ar: 1.88, K: 2.75, Ca: 1.973, Sc: 1.7, Ti: 1.7, V: 1.7, Cr: 1.7,
  Mn: 1.7, Fe: 1.7, Co: 1.7, Ni: 1.63, Cu: 1.4, Zn: 1.39, Ga: 1.87, Ge: 1.7,
  As: 1.85, Se: 1.9, Br: 2.1, Kr: 2.02, Rb: 1.7, Sr: 1.7, Y: 1.7, Zr: 1.7,
  Nb: 1.7, Mo: 1.7, Tc: 1.7, Ru: 1.7, Rh: 1.7, Pd: 1.63, Ag: 1.72, Cd: 1.58,
  In: 1.93, Sn: 2.17, Sb: 2.2, Te: 2.06, I: 2.15, Xe: 2.16, Cs: 1.7, Ba: 1.7,
  Pt: 1.72, Au: 1.66, Hg: 1.55, Pb: 1.96, Bi: 2.02,
};

function vdwRadiusOf(element: string): number {
  const normalized = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase();
  return VDW_RADIUS[normalized] ?? 1.7;
}

/** Whether the DSH shell is in dark mode. */
function isDarkTheme(): boolean {
  return typeof document !== 'undefined'
    && (document.body.dataset.dsDarkTheme !== undefined
      || window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
}

/**
 * Background color the 3D canvas draws. We fill an opaque color (instead of
 * relying on the CSS container's var() tokens + a transparent canvas) so the
 * structure panel adapts to dark mode even where CSS variables don't resolve.
 */
function sceneBackgroundColor(): number {
  return isDarkTheme() ? 0x16181f : 0xffffff;
}

/** crystvis-js atom material: Phong with high specular highlights. */
function buildAtomMaterial(element: string): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: atomColor(element),
    shininess: 30,
    specular: 0x666666,
    reflectivity: 1,
  });
}

/**
 * crystvis-js bond: two half-cylinders colored by each endpoint atom, aligned
 * with a lookAt rotation matrix. Returns a Group.
 */
function buildBondCylinder(start: number[], end: number[], radius: number, color0: string, color1: string): THREE.Group {
  const p0 = new THREE.Vector3(start[0], start[1], start[2]);
  const p1 = new THREE.Vector3(end[0], end[1], end[2]);
  const dp = p1.clone().sub(p0);
  const length = dp.length();
  const half = length / 2;

  const rmat = new THREE.Matrix4().lookAt(p0, p1, new THREE.Vector3(0, 0, 1));

  const mat0 = new THREE.MeshPhongMaterial({
    color: color0, shininess: 30, specular: 0x666666, reflectivity: 1,
    transparent: true, opacity: 0.85,
  });
  const mat1 = new THREE.MeshPhongMaterial({
    color: color1, shininess: 30, specular: 0x666666, reflectivity: 1,
    transparent: true, opacity: 0.85,
  });

  // Unit cylinder is 1 long on Y; scale z to half the bond length.
  const bond0 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), mat0);
  bond0.scale.set(radius, radius, half);
  bond0.position.copy(p0.clone().addScaledVector(dp, 0.25));
  bond0.setRotationFromMatrix(rmat);

  const bond1 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), mat1);
  bond1.scale.set(radius, radius, half);
  bond1.position.copy(p1.clone().addScaledVector(dp, -0.25));
  bond1.setRotationFromMatrix(rmat);

  const group = new THREE.Group();
  group.add(bond0);
  group.add(bond1);
  return group;
}

/** Compute unit cell edges from lattice vectors (cartesian). */
function cellEdges(lattice: number[][]): [THREE.Vector3, THREE.Vector3][] {
  const o = new THREE.Vector3(0, 0, 0);
  const a = new THREE.Vector3(...lattice[0]);
  const b = new THREE.Vector3(...lattice[1]);
  const c = new THREE.Vector3(...lattice[2]);
  return [
    [o, a], [o, b], [o, c],
    [a, a.clone().add(b)], [a, a.clone().add(c)],
    [b, b.clone().add(a)], [b, b.clone().add(c)],
    [c, c.clone().add(a)], [c, c.clone().add(b)],
    [a.clone().add(b), a.clone().add(b).add(c)],
    [a.clone().add(c), a.clone().add(b).add(c)],
    [b.clone().add(c), a.clone().add(b).add(c)],
  ];
}

interface SceneObjects {
  atoms: THREE.Mesh[];
  bonds: THREE.Object3D[];
  cell: THREE.LineSegments | null;
  atomMaterials: Map<number, THREE.MeshPhongMaterial>;
}

/** Recursively dispose geometry/material of a mesh or group. */
function disposeObject3D(obj: THREE.Object3D) {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    const material = mesh.material as THREE.Material;
    material.dispose();
  }
  obj.traverse((child) => {
    const c = child as THREE.Mesh;
    if (c.geometry) c.geometry.dispose();
    if (c.material) (c.material as THREE.Material).dispose();
  });
}

const StructureViewer: React.FC<{ taskId: number }> = ({ taskId }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('');
  const [structure, setStructure] = useState<ViewerStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBonds, setShowBonds] = useState(true);
  const [showCell, setShowCell] = useState(true);
  const [sceneNonce, setSceneNonce] = useState(0);
  const lastStructureRef = useRef<ViewerStructure | null>(null);

  // --- three.js scene lifecycle -------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    // Opaque theme-adaptive background so the panel is dark in dark mode even
    // if the CSS container var is unresolved. Updated live on theme toggle.
    scene.background = new THREE.Color(sceneBackgroundColor());
    // Orthographic frustum in WORLD units (not pixels). zoom adapts it to the
    // structure size, so a few-Å cell fills the viewport.
    const WORLD_HALF = 20;
    const camera = new THREE.OrthographicCamera(-WORLD_HALF, WORLD_HALF, WORLD_HALF, -WORLD_HALF, 0.1, 10000);
    camera.position.set(0, 0, 100);
    camera.zoom = 1;
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(scene.background as THREE.Color, 1);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // Model rotation: dragging rotates the structureGroup around axes that lie
    // IN the screen plane (camera right / up), like VESTA. OrbitControls'
    // default orbit mode swings the camera around the target instead, which
    // lets the view "tip over" after repeated drags — so disable its rotate
    // and do model rotation ourselves below.
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.enableZoom = true;

    /**
     * All rendered content (atoms, bonds, cell) lives in this group; rotating
     * the group keeps the camera fixed and the rotation axes in the screen
     * plane. It is added to the scene once, children are attached in rebuild().
     */
    const structureGroup = new THREE.Group();
    scene.add(structureGroup);

    // Model rotation via pointer drag on the renderer surface.
    let dragState: { x: number; y: number } | null = null;
    const ROTATE_SPEED = 0.005;
    const screenRight = new THREE.Vector3();
    const screenUp = new THREE.Vector3();
    const onPointerDown = (event: PointerEvent) => {
      // Left button only, no modifiers (Shift+left is OrbitControls' pan).
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
      dragState = { x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragState) return;
      const dx = event.clientX - dragState.x;
      const dy = event.clientY - dragState.y;
      dragState = { x: event.clientX, y: event.clientY };
      if (dx === 0 && dy === 0) return;
      camera.updateMatrixWorld();
      screenRight.setFromMatrixColumn(camera.matrixWorld, 0);
      screenUp.setFromMatrixColumn(camera.matrixWorld, 1);
      // Horizontal drag → rotate around the screen-vertical axis; vertical
      // drag → rotate around the screen-horizontal axis. Both axes lie in the
      // screen plane, so the rotation axis never leaves it. Positive dy (mouse
      // down) rotates the top toward the viewer — follow-the-mouse feel.
      structureGroup.rotateOnWorldAxis(screenUp, dx * ROTATE_SPEED);
      structureGroup.rotateOnWorldAxis(screenRight, dy * ROTATE_SPEED);
      markTouched();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragState = null;
      try { renderer.domElement.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);

    // A camera view the user actually touched is memorable; without this flag
    // a fresh mount would save the *default* camera on cleanup.
    let cameraTouched = false;
    const markTouched = () => { cameraTouched = true; };
    controls.addEventListener('start', markTouched);

    // crystvis-js lighting: moderate ambient + front directional + fill.
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir1.position.set(0, 1, -1);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(0, -1, 1);
    scene.add(dir2);

    let objects: SceneObjects = { atoms: [], bonds: [], cell: null, atomMaterials: new Map() };
    let disposed = false;

    // Live dark-mode toggle: recolor the scene background (and rebuild so the
    // cell-line color follows too).
    const themeObserver = new MutationObserver(() => {
      if (disposed) return;
      scene.background = new THREE.Color(sceneBackgroundColor());
      renderer.setClearColor(scene.background as THREE.Color, 1);
      const visible = structure ?? lastStructureRef.current;
      if (visible) rebuild(visible);
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });

    const cameraKey = `${taskId}:${activeFile}`;
    const storedRaw = (() => {
      try {
        return sessionStorage.getItem(CAMERA_STORE_PREFIX + cameraKey);
      } catch {
        return null;
      }
    })();

    const fitView = (struct: ViewerStructure) => {
      // Reset model rotation: a fresh fit should face the structure upright.
      structureGroup.quaternion.identity();
      // Rotation center = the cell center (a+b+c)/2, not the atom bbox center,
      // so orbiting pivots around the crystal cell.
      const center = cellCenterOf(struct.lattice);
      // Size follows the CELL, not the atom bounding box: zoom/position are
      // derived from the half body-diagonal of the lattice (cell center → most
      // distant lattice vertex), so two structures sharing the same lattice
      // parameters open at exactly the same initial size no matter how their
      // atoms are distributed.
      const lattice = struct.lattice;
      let halfDiagonal = 10; // fallback when lattice is unavailable
      if (lattice && lattice.length >= 3) {
        const sum = [
          lattice[0][0] + lattice[1][0] + lattice[2][0],
          lattice[0][1] + lattice[1][1] + lattice[2][1],
          lattice[0][2] + lattice[1][2] + lattice[2][2],
        ];
        halfDiagonal = Math.sqrt(sum[0] ** 2 + sum[1] ** 2 + sum[2] ** 2) / 2;
      }
      // Zoom so the cell fills ~80% of the frustum's smaller dimension.
      const target = Math.max(halfDiagonal * 1.2, 1);
      camera.zoom = (WORLD_HALF * 0.8) / target;
      camera.updateProjectionMatrix();
      camera.position.set(center[0], center[1], center[2] + Math.max(halfDiagonal * 4, 20));
      controls.target.set(center[0], center[1], center[2]);
      controls.update();
    };

    const rebuild = (struct: ViewerStructure) => {
      // dispose old
      objects.atoms.forEach((mesh) => { structureGroup.remove(mesh); });
      objects.atomMaterials.forEach((mat) => mat.dispose());
      objects.bonds.forEach((bond) => { structureGroup.remove(bond); disposeObject3D(bond); });
      if (objects.cell) { structureGroup.remove(objects.cell); objects.cell.geometry.dispose(); (objects.cell.material as THREE.Material).dispose(); }
      objects = { atoms: [], bonds: [], cell: null, atomMaterials: new Map() };

      // Pivot the model group at the CELL CENTER: the group's position is the
      // world point all children are relative to, so rotateOnWorldAxis() spins
      // around an axis through the cell center — not through the origin corner.
      const center = cellCenterOf(struct.lattice);
      structureGroup.position.set(center[0], center[1], center[2]);

      const coords = struct.coords || [];
      const species = struct.species || [];
      // scene.atoms includes periodic images (is_periodic_image) appended by
      // the host for cross-cell bonds. Render EVERY atom — base atoms and
      // periodic image atoms alike (the images are the real bonded partners
      // outside the cell).
      for (let i = 0; i < coords.length; i += 1) {
        const pos = coords[i];
        const symbol = species[i] || 'X';
        // crystvis-js atom radius: vdW / 4 (scaled a touch larger for clarity).
        const radius = vdwRadiusOf(symbol) / 4 * 1.35;
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 24, 24),
          buildAtomMaterial(symbol),
        );
        sphere.position.set(pos[0] - center[0], pos[1] - center[1], pos[2] - center[2]);
        structureGroup.add(sphere);
        objects.atoms.push(sphere);
      }

      if (struct.bonds?.length && showBonds) {
        // crystvis-js bonds: two half-cylinders colored by each endpoint atom.
        // Endpoint indices may point at periodic images appended to
        // scene.atoms — the host guarantees coords/species align with it.
        struct.bonds.forEach((bond) => {
          const s = coords[bond.start_atom_index];
          const e = coords[bond.end_atom_index];
          if (!s || !e) return;
          const c0 = atomColor(species[bond.start_atom_index] || 'X');
          const c1 = atomColor(species[bond.end_atom_index] || 'X');
          const cyl = buildBondCylinder(
            [s[0] - center[0], s[1] - center[1], s[2] - center[2]],
            [e[0] - center[0], e[1] - center[1], e[2] - center[2]],
            0.055, c0, c1,
          );
          structureGroup.add(cyl);
          objects.bonds.push(cyl);
        });
      }

      if (struct.lattice?.length === 3 && showCell) {
        const edges = cellEdges(struct.lattice);
        const points: number[] = [];
        edges.forEach(([a, b]) => points.push(
          a.x - center[0], a.y - center[1], a.z - center[2],
          b.x - center[0], b.y - center[1], b.z - center[2],
        ));
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        // Brighter cell lines in dark mode for contrast.
        const cellColor = isDarkTheme() ? 0x8ec5ff : 0x4d9fff;
        const material = new THREE.LineBasicMaterial({ color: cellColor, transparent: true, opacity: 0.9 });
        const lines = new THREE.LineSegments(geom, material);
        structureGroup.add(lines);
        objects.cell = lines;
      }
    };

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth || 300;
      const h = mount.clientHeight || 300;
      // Keep the frustum in world units; widen horizontally by aspect ratio.
      const aspect = Math.max(w / Math.max(h, 1), 0.1);
      camera.left = -WORLD_HALF * aspect;
      camera.right = WORLD_HALF * aspect;
      camera.top = WORLD_HALF;
      camera.bottom = -WORLD_HALF;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    onResize();
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);

    const saveCamera = () => {
      if (!cameraTouched) return; // never memorize an untouched (default) camera
      try {
        sessionStorage.setItem(CAMERA_STORE_PREFIX + cameraKey, JSON.stringify({
          version: CAMERA_STORE_VERSION,
          interacted: true,
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          zoom: camera.zoom,
          rotation: structureGroup.quaternion.toArray(),
        }));
      } catch {
        // ignore
      }
    };
    /**
     * Restore a previously saved camera + model rotation. Returns true when a
     * view was restored. Only views the user actually interacted with are
     * restored; everything else (stale versions, default cameras saved by an
     * older buggy build) is rejected, so fitView() re-centers on the cell
     * center.
     */
    const restoreCamera = () => {
      if (!storedRaw) return false;
      try {
        const state = JSON.parse(storedRaw);
        if (state.version !== CAMERA_STORE_VERSION) return false;
        if (state.interacted !== true) return false;
        if (!Array.isArray(state.position) || !Array.isArray(state.target)) return false;
        camera.position.fromArray(state.position);
        controls.target.fromArray(state.target);
        // Size (zoom) is part of the user's view too — restore it together
        // with rotation/pan, clamping to a sane positive range.
        if (typeof state.zoom === 'number' && Number.isFinite(state.zoom) && state.zoom > 0) {
          camera.zoom = Math.min(Math.max(state.zoom, 0.01), 100000);
          camera.updateProjectionMatrix();
        }
        // Model rotation (screen-plane axes) is stored as the group quaternion.
        if (Array.isArray(state.rotation) && state.rotation.length === 4) {
          structureGroup.quaternion.fromArray(state.rotation);
        }
        controls.update();
        return true;
      } catch {
        return false;
      }
    };
    const restored = restoreCamera();

    // Rebuild once structure data is available (this effect re-runs when
    // structure / showBonds / showCell / sceneNonce change).
    const visibleStruct = structure ?? lastStructureRef.current;
    if (visibleStruct) {
      rebuild(visibleStruct);
      if (!restored) fitView(visibleStruct);
    }

    return () => {
      disposed = true;
      themeObserver.disconnect();
      resizeObserver.disconnect();
      controls.removeEventListener('start', markTouched);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      saveCamera();
      controls.dispose();
      objects.atoms.forEach((mesh) => { structureGroup.remove(mesh); });
      objects.atomMaterials.forEach((mat) => mat.dispose());
      objects.bonds.forEach((bond) => { structureGroup.remove(bond); disposeObject3D(bond); });
      if (objects.cell) { structureGroup.remove(objects.cell); objects.cell.geometry.dispose(); (objects.cell.material as THREE.Material).dispose(); }
      scene.remove(structureGroup);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, activeFile, showBonds, showCell, structure, sceneNonce]);

  // --- data loading ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStructureFiles(taskId)
      .then((fileList) => {
        if (cancelled) return;
        setFiles(fileList);
        const names = fileList.map((f) => f.toUpperCase());
        const initial = names.includes('CONTCAR')
          ? fileList[names.indexOf('CONTCAR')]
          : names.includes('POSCAR')
            ? fileList[names.indexOf('POSCAR')]
            : fileList[0] || '';
        setActiveFile(initial);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    if (!activeFile) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStructureScene(taskId, activeFile)
      .then((scene: StructureScene) => {
        if (cancelled) return;
        const viewer = structureSceneToViewerStructure(scene);
        lastStructureRef.current = viewer;
        setStructure(viewer);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId, activeFile]);

  const handleResetView = useCallback(() => {
    const key = `${taskId}:${activeFile}`;
    try {
      sessionStorage.removeItem(CAMERA_STORE_PREFIX + key);
    } catch {
      // ignore
    }
    // force a re-mount of the scene by nudging a state
    setSceneNonce((n) => n + 1);
  }, [taskId, activeFile]);

  const latticeText = useMemo(() => {
    const lattice = structure?.lattice;
    if (!lattice || lattice.length < 3) return 'cell: -';
    const lengths = lattice.map((v) => vectorLength(v));
    return `cell: a=${lengths[0]?.toFixed(3)} b=${lengths[1]?.toFixed(3)} c=${lengths[2]?.toFixed(3)}`;
  }, [structure]);

  const summaryText = useMemo(() => {
    const summary = structure?.scene?.summary;
    if (!summary) return 'summary: -';
    const spaceGroup = summary.space_group
      ? `${summary.space_group}${summary.space_group_number ? ` #${summary.space_group_number}` : ''}`
      : 'SG -';
    const bonding = summary.bond_algorithm ? `bonding ${summary.bond_algorithm}` : 'bonding off';
    return `${summary.formula || '-'} | ${spaceGroup} | ${bonding}`;
  }, [structure]);

  if (files.length === 0) {
    if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />;
    return <Empty description={error || '无可查看的结构文件（需 POSCAR/CONTCAR/.vasp）'} />;
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
        <div
          className="vaspflow-structure-tabs"
          style={{ flex: 1, minWidth: 0, outline: 'none' }}
          tabIndex={0}
          onKeyDown={(e) => {
            // ←/→ directly switches the structure file when the tab bar has
            // focus (antd's default only moves focus and needs Enter).
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            e.stopPropagation();
            if (files.length < 2) return;
            const index = files.indexOf(activeFile);
            const next = e.key === 'ArrowRight'
              ? files[(index + 1) % files.length]
              : files[(index - 1 + files.length) % files.length];
            if (next !== undefined && next !== activeFile) setActiveFile(next);
          }}
        >
          <Tabs
            size="small"
            activeKey={activeFile}
            onChange={setActiveFile}
            items={files.map((f) => ({ key: f, label: f }))}
            style={{ marginBottom: 0, minWidth: 0 }}
          />
        </div>
        <Tooltip title="复位视角">
          <Button size="small" icon={<ReloadOutlined />} onClick={handleResetView} />
        </Tooltip>
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--dsw-alias-label-secondary, #555)' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={showBonds} onChange={(e) => setShowBonds(e.target.checked)} /> 键
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={showCell} onChange={(e) => setShowCell(e.target.checked)} /> 晶胞
        </label>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeFile} · {structure?.num_atoms ?? '-'} atoms · {structure?.bonds?.length ?? 0} bonds · {summaryText} · {latticeText}
        </span>
      </div>
      <div
        ref={mountRef}
        key={sceneNonce}
        data-vasp-structure-mount
        style={{
          width: '100%',
          height: 380,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--dsw-alias-border-l2, #e8e8e8)',
          background: 'var(--dsw-alias-bg-base, #fff)',
          position: 'relative',
        }}
      >
        {loading && (
          <Spin style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 20 }} />
        )}
        {!loading && error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description={error} />
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #999)' }}>
        拖拽旋转 · 滚轮缩放 · Shift+拖拽平移
      </div>
    </div>
  );
};

export default StructureViewer;
