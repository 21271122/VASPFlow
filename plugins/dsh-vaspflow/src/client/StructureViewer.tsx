/**
 * dsh-vaspflow client: 3D structure viewer — port of StructureViewer.tsx
 * (three.js direct, no react-three-fiber): orthographic camera, atom spheres,
 * bonds, unit cell, orbit/pan/zoom, camera memory, structure file tabs.
 */
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Spin, Empty, Tabs, Tooltip, Button, Popover, Radio, Select, Slider, Switch } from 'antd';
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { fetchStructureFiles, fetchStructureScene, structureSceneToViewerStructure } from './api';
import type { ViewerStructure, StructureScene } from './api';
import { elementColors } from './elementColors';
import { startStructureDrag } from './structure-drag';
import { expandStructure, supercellLattice } from './supercell';
import type { DisplayAtom, Repeat } from './supercell';

const CAMERA_STORE_PREFIX = 'dsh-vaspflow:structure-camera:v5:';
const CAMERA_STORE_VERSION = 5;
const MAX_DISPLAY_OBJECTS = 6000;

function effectiveRepeat(struct: ViewerStructure, repeat: Repeat): Repeat {
  const cells = repeat[0] * repeat[1] * repeat[2];
  return cells === 1 || (struct.num_atoms + (struct.bonds?.length ?? 0)) * cells <= MAX_DISPLAY_OBJECTS ? repeat : [1, 1, 1];
}

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
function sceneBackgroundColor(mode: 'auto' | 'light' | 'dark'): number {
  return mode === 'dark' || (mode === 'auto' && isDarkTheme()) ? 0x16181f : 0xffffff;
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
  atomGeometry: THREE.SphereGeometry | null;
  atomMaterials: THREE.MeshPhongMaterial[];
  bonds: THREE.Object3D[];
  cell: THREE.LineSegments | null;
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

const StructureViewer: React.FC<{ taskId?: number; rootPath?: string; relPath?: string; inlineScene?: StructureScene; inlineLabel?: string; sourcePath?: string; active?: boolean }> = ({ taskId, rootPath, relPath, inlineScene, inlineLabel, sourcePath, active = true }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [files, setFiles] = useState<string[]>(() => inlineScene ? [inlineLabel || '结构'] : []);
  const [activeFile, setActiveFile] = useState<string>(() => inlineScene ? inlineLabel || '结构' : '');
  const [structure, setStructure] = useState<ViewerStructure | null>(() => inlineScene ? structureSceneToViewerStructure(inlineScene) : null);
  const [loading, setLoading] = useState(!inlineScene);
  const [error, setError] = useState<string | null>(null);
  const [showBonds, setShowBonds] = useState(true);
  const [showCell, setShowCell] = useState(true);
  const [displayStyle, setDisplayStyle] = useState<'ball-stick' | 'space-fill'>('ball-stick');
  const [showPeriodicImages, setShowPeriodicImages] = useState(true);
  const [repeat, setRepeat] = useState<Repeat>([1, 1, 1]);
  const [atomScale, setAtomScale] = useState(100);
  const [bondScale, setBondScale] = useState(100);
  const [backgroundMode, setBackgroundMode] = useState<'auto' | 'light' | 'dark'>('auto');
  const [rotationStep, setRotationStep] = useState(15);
  const [wheelActive, setWheelActive] = useState(false);
  const [selectedAtoms, setSelectedAtoms] = useState<DisplayAtom[]>([]);
  const selectedAtomsRef = useRef<DisplayAtom[]>([]);
  const [sceneNonce, setSceneNonce] = useState(0);
  const lastStructureRef = useRef<ViewerStructure | null>(null);
  const skipCameraSaveRef = useRef(false);
  const settingsRef = useRef({ showBonds, showCell, showPeriodicImages, repeat, atomScale, bondScale, displayStyle, backgroundMode, rotationStep });
  settingsRef.current = { showBonds, showCell, showPeriodicImages, repeat, atomScale, bondScale, displayStyle, backgroundMode, rotationStep };
  const applySettingsRef = useRef<((refit?: boolean) => void) | null>(null);
  const exportImageRef = useRef<(() => void) | null>(null);
  const orientRef = useRef<((axis: 0 | 1 | 2) => void) | null>(null);

  // --- three.js scene lifecycle -------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setWheelActive(false);

    const scene = new THREE.Scene();
    // Opaque theme-adaptive background so the panel is dark in dark mode even
    // if the CSS container var is unresolved. Updated live on theme toggle.
    scene.background = new THREE.Color(sceneBackgroundColor(settingsRef.current.backgroundMode));
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
    controls.enableZoom = false;
    const activateWheel = (event: PointerEvent) => {
      const enabled = mount.contains(event.target as Node);
      controls.enableZoom = enabled;
      setWheelActive(enabled);
    };
    document.addEventListener('pointerdown', activateWheel, true);

    /**
     * All rendered content (atoms, bonds, cell) lives in this group; rotating
     * the group keeps the camera fixed and the rotation axes in the screen
     * plane. It is added to the scene once, children are attached in rebuild().
     */
    const structureGroup = new THREE.Group();
    scene.add(structureGroup);

    // Model rotation via pointer drag on the renderer surface.
    let dragState: { x: number; y: number } | null = null;
    let dragOrigin: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const ROTATE_SPEED = 0.005;
    const screenRight = new THREE.Vector3();
    const screenUp = new THREE.Vector3();
    const onPointerDown = (event: PointerEvent) => {
      mount.focus({ preventScroll: true });
      // Left button only, no modifiers (Shift+left is OrbitControls' pan).
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
      dragState = { x: event.clientX, y: event.clientY };
      dragOrigin = dragState;
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
      if (event.type === 'pointerup' && dragOrigin && Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) < 4) {
        const rect = renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        camera.updateMatrixWorld();
        structureGroup.updateMatrixWorld(true);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(objects.atoms, false)[0];
        if (hit) {
          const picked = hit.object.userData.atom as DisplayAtom;
          const old = selectedAtomsRef.current;
          const next = old.some((atom) => atom.key === picked.key) ? [] : old.length === 2 ? [picked] : [...old, picked];
          selectedAtomsRef.current = next;
          setSelectedAtoms(next);
          objects.atoms.forEach((atom) => { atom.material = next.some((item) => item.key === atom.userData.atom.key) ? atom.userData.selectedMaterial : atom.userData.normalMaterial; });
        }
      }
      dragState = null;
      dragOrigin = null;
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
    orientRef.current = (axis) => {
      const lattice = (structure ?? lastStructureRef.current)?.lattice;
      if (!lattice?.[axis]) return;
      const z = new THREE.Vector3(...(lattice[axis] as [number, number, number])).normalize();
      const upIndex = axis === 2 ? 1 : 2;
      const y = new THREE.Vector3(...(lattice[upIndex] as [number, number, number]));
      y.addScaledVector(z, -y.dot(z)).normalize();
      if (z.lengthSq() < 1e-8 || y.lengthSq() < 1e-8) return;
      const x = y.clone().cross(z).normalize();
      y.copy(z).cross(x);
      structureGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).invert();
      markTouched();
    };
    controls.addEventListener('start', markTouched);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current || (!structure && !lastStructureRef.current) || event.ctrlKey || event.altKey || event.metaKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const angle = THREE.MathUtils.degToRad(settingsRef.current.rotationStep * (event.shiftKey ? 0.1 : 1));
      camera.updateMatrixWorld();
      screenRight.setFromMatrixColumn(camera.matrixWorld, 0);
      screenUp.setFromMatrixColumn(camera.matrixWorld, 1);
      if (event.key === 'ArrowLeft') structureGroup.rotateOnWorldAxis(screenUp, -angle);
      if (event.key === 'ArrowRight') structureGroup.rotateOnWorldAxis(screenUp, angle);
      if (event.key === 'ArrowUp') structureGroup.rotateOnWorldAxis(screenRight, -angle);
      if (event.key === 'ArrowDown') structureGroup.rotateOnWorldAxis(screenRight, angle);
      markTouched();
    };
    mount.addEventListener('keydown', onKeyDown);

    // crystvis-js lighting: moderate ambient + front directional + fill.
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir1.position.set(0, 1, -1);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(0, -1, 1);
    scene.add(dir2);

    let objects: SceneObjects = { atoms: [], atomGeometry: null, atomMaterials: [], bonds: [], cell: null };
    let disposed = false;
    const clearObjects = () => {
      objects.atoms.forEach((mesh) => structureGroup.remove(mesh));
      objects.atomGeometry?.dispose();
      objects.atomMaterials.forEach((material) => material.dispose());
      objects.bonds.forEach((bond) => { structureGroup.remove(bond); disposeObject3D(bond); });
      if (objects.cell) { structureGroup.remove(objects.cell); objects.cell.geometry.dispose(); (objects.cell.material as THREE.Material).dispose(); }
      objects = { atoms: [], atomGeometry: null, atomMaterials: [], bonds: [], cell: null };
    };

    // Live dark-mode toggle: recolor the scene background (and rebuild so the
    // cell-line color follows too).
    const themeObserver = new MutationObserver(() => {
      if (disposed) return;
      scene.background = new THREE.Color(sceneBackgroundColor(settingsRef.current.backgroundMode));
      renderer.setClearColor(scene.background as THREE.Color, 1);
      const visible = structure ?? lastStructureRef.current;
      if (visible) rebuild(visible);
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });

    const cameraKey = () => `${taskId ?? inlineLabel}:${activeFile}:${settingsRef.current.repeat.join('x')}`;
    const storedRaw = (() => {
      try {
        return sessionStorage.getItem(CAMERA_STORE_PREFIX + cameraKey());
      } catch {
        return null;
      }
    })();

    const fitView = (struct: ViewerStructure, preserveRotation = false) => {
      // Reset model rotation: a fresh fit should face the structure upright.
      if (!preserveRotation) structureGroup.quaternion.identity();
      // Rotation center = the cell center (a+b+c)/2, not the atom bbox center,
      // so orbiting pivots around the crystal cell.
      const lattice = supercellLattice(struct.lattice, effectiveRepeat(struct, settingsRef.current.repeat));
      const center = cellCenterOf(lattice);
      // Fit the furthest cell corner so skewed supercells stay within the view.
      let halfDiagonal = 10; // fallback when lattice is unavailable
      if (lattice && lattice.length >= 3) {
        halfDiagonal = 0;
        for (let a = 0; a <= 1; a += 1) for (let b = 0; b <= 1; b += 1) for (let c = 0; c <= 1; c += 1) {
          const corner = lattice[0].map((_, axis) => a * lattice[0][axis] + b * lattice[1][axis] + c * lattice[2][axis] - center[axis]);
          halfDiagonal = Math.max(halfDiagonal, Math.hypot(...corner));
        }
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
      clearObjects();
      const expanded = expandStructure(struct, effectiveRepeat(struct, settingsRef.current.repeat), settingsRef.current.showPeriodicImages);

      // Pivot the model group at the CELL CENTER: the group's position is the
      // world point all children are relative to, so rotateOnWorldAxis() spins
      // around an axis through the cell center — not through the origin corner.
      const center = cellCenterOf(expanded.lattice);
      structureGroup.position.set(center[0], center[1], center[2]);

      const atomGeometry = new THREE.SphereGeometry(1, 24, 24);
      objects.atomGeometry = atomGeometry;
      const palette = new Map<string, { normal: THREE.MeshPhongMaterial; selected: THREE.MeshPhongMaterial }>();
      for (const atom of expanded.atoms) {
        const symbol = atom.element;
        let materials = palette.get(symbol);
        if (!materials) {
          const normal = buildAtomMaterial(symbol);
          const selected = normal.clone();
          selected.emissive.set('#c28a18');
          materials = { normal, selected };
          palette.set(symbol, materials);
          objects.atomMaterials.push(normal, selected);
        }
        const radius = (settingsRef.current.displayStyle === 'space-fill' ? vdwRadiusOf(symbol) : vdwRadiusOf(symbol) / 4 * 1.35) * settingsRef.current.atomScale / 100;
        const sphere = new THREE.Mesh(atomGeometry, selectedAtomsRef.current.some((item) => item.key === atom.key) ? materials.selected : materials.normal);
        sphere.userData.atom = atom;
        sphere.userData.normalMaterial = materials.normal;
        sphere.userData.selectedMaterial = materials.selected;
        sphere.scale.setScalar(radius);
        sphere.position.set(atom.position[0] - center[0], atom.position[1] - center[1], atom.position[2] - center[2]);
        structureGroup.add(sphere);
        objects.atoms.push(sphere);
      }

      if (expanded.bonds.length && settingsRef.current.showBonds && settingsRef.current.displayStyle === 'ball-stick') {
        expanded.bonds.forEach(({ start, end }) => {
          const cyl = buildBondCylinder(
            start.position.map((value, index) => value - center[index]),
            end.position.map((value, index) => value - center[index]),
            0.055 * settingsRef.current.bondScale / 100, atomColor(start.element), atomColor(end.element),
          );
          structureGroup.add(cyl);
          objects.bonds.push(cyl);
        });
      }

      if (expanded.lattice.length === 3 && settingsRef.current.showCell) {
        const edges = cellEdges(expanded.lattice);
        const points: number[] = [];
        edges.forEach(([a, b]) => points.push(
          a.x - center[0], a.y - center[1], a.z - center[2],
          b.x - center[0], b.y - center[1], b.z - center[2],
        ));
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        // Brighter cell lines in dark mode for contrast.
        const cellColor = sceneBackgroundColor(settingsRef.current.backgroundMode) === 0x16181f ? 0x8ec5ff : 0x4d9fff;
        const material = new THREE.LineBasicMaterial({ color: cellColor, transparent: true, opacity: 0.9 });
        const lines = new THREE.LineSegments(geom, material);
        structureGroup.add(lines);
        objects.cell = lines;
      }
    };

    const applySettings = (refit = false) => {
      scene.background = new THREE.Color(sceneBackgroundColor(settingsRef.current.backgroundMode));
      renderer.setClearColor(scene.background as THREE.Color, 1);
      const visible = structure ?? lastStructureRef.current;
      if (visible) {
        rebuild(visible);
        if (refit) fitView(visible, true);
      }
    };
    applySettingsRef.current = applySettings;
    exportImageRef.current = () => {
      renderer.render(scene, camera);
      const link = document.createElement('a');
      link.href = renderer.domElement.toDataURL('image/png');
      link.download = `${(activeFile || inlineLabel || 'structure').split(/[\\/]/).at(-1)}.png`;
      link.click();
    };

    const animate = () => {
      if (disposed) return;
      if (activeRef.current) {
        controls.update();
        renderer.render(scene, camera);
      }
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
        sessionStorage.setItem(CAMERA_STORE_PREFIX + cameraKey(), JSON.stringify({
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

    // Rebuild when the structure changes; display settings update objects in place.
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
      mount.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', activateWheel, true);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      if (skipCameraSaveRef.current) skipCameraSaveRef.current = false;
      else saveCamera();
      controls.dispose();
      if (applySettingsRef.current === applySettings) applySettingsRef.current = null;
      exportImageRef.current = null;
      orientRef.current = null;
      clearObjects();
      scene.remove(structureGroup);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, activeFile, structure, sceneNonce]);

  useEffect(() => { applySettingsRef.current?.(); }, [showBonds, showCell, showPeriodicImages, atomScale, bondScale, displayStyle, backgroundMode]);
  useEffect(() => { applySettingsRef.current?.(true); }, [repeat]);
  useEffect(() => { selectedAtomsRef.current = []; setSelectedAtoms([]); }, [taskId, activeFile, inlineScene]);
  useEffect(() => {
    if (structure && effectiveRepeat(structure, repeat) !== repeat) {
      selectedAtomsRef.current = [];
      setSelectedAtoms([]);
      setRepeat([1, 1, 1]);
    }
  }, [structure, repeat]);
  useEffect(() => {
    if (!showPeriodicImages && selectedAtomsRef.current.some((atom) => atom.offset.some((value, axis) => value < 0 || value >= repeat[axis]))) {
      selectedAtomsRef.current = [];
      setSelectedAtoms([]);
      applySettingsRef.current?.();
    }
  }, [showPeriodicImages, structure, repeat]);

  // --- data loading ---------------------------------------------------------
  useEffect(() => {
    if (inlineScene) {
      const label = inlineLabel || '结构';
      setFiles([label]);
      setActiveFile(label);
      setStructure(structureSceneToViewerStructure(inlineScene));
      setLoading(false);
      setError(null);
      return;
    }
    if (taskId === undefined) return;
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
  }, [taskId, inlineScene, inlineLabel]);

  useEffect(() => {
    if (!activeFile || inlineScene || taskId === undefined) return;
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
  }, [taskId, activeFile, inlineScene]);

  const handleResetView = useCallback(() => {
    skipCameraSaveRef.current = true;
    const key = `${taskId ?? inlineLabel}:${activeFile}:${repeat.join('x')}`;
    try {
      sessionStorage.removeItem(CAMERA_STORE_PREFIX + key);
    } catch {
      // ignore
    }
    // force a re-mount of the scene by nudging a state
    setSceneNonce((n) => n + 1);
  }, [taskId, inlineLabel, activeFile, repeat]);

  const latticeText = useMemo(() => {
    const lattice = structure ? supercellLattice(structure.lattice, effectiveRepeat(structure, repeat)) : undefined;
    if (!lattice || lattice.length < 3) return 'cell: -';
    const lengths = lattice.map((v) => vectorLength(v));
    return `cell: a=${lengths[0]?.toFixed(3)} b=${lengths[1]?.toFixed(3)} c=${lengths[2]?.toFixed(3)}`;
  }, [structure, repeat]);

  const summaryText = useMemo(() => {
    const summary = structure?.scene?.summary;
    if (!summary) return 'summary: -';
    const spaceGroup = summary.space_group
      ? `${summary.space_group}${summary.space_group_number ? ` #${summary.space_group_number}` : ''}`
      : 'SG -';
    const bonding = summary.bond_algorithm ? `bonding ${summary.bond_algorithm}` : 'bonding off';
    return `${summary.formula || '-'} | ${spaceGroup} | ${bonding}`;
  }, [structure]);

  const measurement = useMemo(() => {
    if (!selectedAtoms.length) return '';
    const atomName = (atom: DisplayAtom) => `${atom.element}${atom.siteIndex + 1}${atom.offset.some(Boolean) ? ` [${atom.offset.join(',')}]` : ''}`;
    const first = selectedAtoms[0];
    if (selectedAtoms.length === 1) return `${atomName(first)} · (${first.position.map((value) => value.toFixed(3)).join(', ')}) Å`;
    const second = selectedAtoms[1];
    return `${atomName(first)} — ${atomName(second)} · ${Math.hypot(...first.position.map((value, index) => value - second.position[index])).toFixed(3)} Å`;
  }, [selectedAtoms]);

  const displayScene = useMemo(() => structure ? expandStructure(structure, effectiveRepeat(structure, repeat), showPeriodicImages) : null, [structure, repeat, showPeriodicImages]);
  const hasPeriodicImages = structure?.scene?.atoms.some((atom) => atom.is_periodic_image) ?? false;
  const displayBudget = (structure?.num_atoms ?? 0) + (structure?.bonds?.length ?? 0);

  const settingsPanel = <div style={{ width: 250, display: 'grid', gap: 11, fontSize: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span>显示风格</span><Radio.Group size="small" optionType="button" buttonStyle="solid" value={displayStyle} onChange={(event) => setDisplayStyle(event.target.value)} options={[{ label: '球棍', value: 'ball-stick' }, { label: '空间填充', value: 'space-fill' }]} /></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span>显示化学键</span><Switch size="small" checked={displayStyle === 'ball-stick' && showBonds} disabled={displayStyle === 'space-fill'} onChange={setShowBonds} /></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span>显示晶胞</span><Switch size="small" checked={showCell} onChange={setShowCell} /></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><Tooltip title="只控制扩胞最外侧、为了显示跨边界化学键而补出的邻居原子；内部重复原子始终显示。"><span>边界外成键原子 ⓘ</span></Tooltip><Switch size="small" checked={showPeriodicImages} disabled={!hasPeriodicImages} onChange={setShowPeriodicImages} /></div>
    <div style={{ display: 'grid', gap: 5 }}><span>显示扩胞</span><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>{(['a', 'b', 'c'] as const).map((axis, index) => <label key={axis} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{axis}<Select size="small" value={repeat[index]} style={{ width: 56 }} aria-label={`${axis} 方向扩胞数量`} onChange={(value) => { selectedAtomsRef.current = []; setSelectedAtoms([]); setRepeat((old) => old.map((count, i) => i === index ? value : count) as Repeat); }} options={[1, 2, 3, 4].map((value) => ({ label: String(value), value, disabled: value > 1 && displayBudget * repeat.reduce((product, count, i) => product * (i === index ? value : count), 1) > MAX_DISPLAY_OBJECTS }))} /></label>)}</div></div>
    <div style={{ color: 'var(--dsw-alias-label-secondary,#65746b)', lineHeight: 1.45 }}>1×1×1 为原始胞范围；只改变视图，不修改结构文件。大型结构会限制扩胞倍数。</div>
    <div>原子大小 · {atomScale}%<Slider min={50} max={150} step={10} value={atomScale} onChange={setAtomScale} aria-label="原子大小" style={{ margin: '4px 6px 0' }} /></div>
    <div>化学键粗细 · {bondScale}%<Slider min={50} max={200} step={10} value={bondScale} onChange={setBondScale} disabled={!showBonds || displayStyle !== 'ball-stick'} aria-label="化学键粗细" style={{ margin: '4px 6px 0' }} /></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span>背景</span><Select size="small" style={{ width: 112 }} value={backgroundMode} onChange={setBackgroundMode} options={[{ label: '跟随界面', value: 'auto' }, { label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }]} /></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span>旋转步长</span><Select size="small" style={{ width: 112 }} value={rotationStep} onChange={setRotationStep} options={[5, 15, 30].map((value) => ({ label: `${value}°`, value }))} /></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span>沿晶轴观察</span><div style={{ display: 'flex', gap: 4 }}>{(['a', 'b', 'c'] as const).map((name, axis) => <Button key={name} size="small" onClick={() => orientRef.current?.(axis as 0 | 1 | 2)}>{name}</Button>)}</div></div>
    <Button size="small" onClick={() => exportImageRef.current?.()}>导出当前视角 PNG</Button>
    <div style={{ color: 'var(--dsw-alias-label-secondary,#65746b)', lineHeight: 1.45 }}>空间填充模式隐藏化学键。点击画布后用方向键旋转；Shift + 方向键按十分之一步长旋转。</div>
  </div>;

  if (files.length === 0) {
    if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />;
    return <Empty description={error || '无可查看的结构文件（需 POSCAR/CONTCAR/.vasp）'} />;
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="vfp-structure-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {inlineScene && sourcePath && <div className="vfp-source-location" title={sourcePath}>文件：{sourcePath}</div>}
        {!inlineScene && <div
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
              ? files[Math.min(index + 1, files.length - 1)]
              : files[Math.max(index - 1, 0)];
            if (next !== undefined && next !== activeFile) setActiveFile(next);
          }}
        >
          <Tabs
            size="small"
            activeKey={activeFile}
            onChange={setActiveFile}
            items={files.map((f) => ({ key: f, label: rootPath && relPath !== undefined
              ? <span draggable onDragStart={(event) => { startStructureDrag(event.dataTransfer, { kind: 'file', rootPath, relPath, file: f }); }} style={{ cursor: 'grab' }}>{f}</span>
              : f }))}
            style={{ marginBottom: 0, minWidth: 0 }}
          />
        </div>}
        <div className="vfp-structure-actions" style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
          <Tooltip title="复位视角"><Button size="small" className="vfp-structure-action" icon={<ReloadOutlined />} onClick={handleResetView}>复位</Button></Tooltip>
          <Popover title="结构显示设置" content={settingsPanel} trigger="click" placement="bottomRight" arrow={false}>
            <Button size="small" className="vfp-structure-action" title="结构设置" aria-label="结构设置" icon={<SettingOutlined />}>设置</Button>
          </Popover>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--dsw-alias-label-secondary, #555)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {!inlineScene && `${activeFile} · `}可见 {displayScene?.atoms.length ?? '-'} 原子 · {displayScene?.bonds.length ?? 0} 键 · {repeat.join('×')} 胞 · {summaryText} · {latticeText}
        </span>
      </div>
      {measurement && <div className="vfp-structure-measurement" role="status">{measurement}<button type="button" onClick={() => { selectedAtomsRef.current = []; setSelectedAtoms([]); applySettingsRef.current?.(); }}>清除</button></div>}
      <div
        ref={mountRef}
        key={sceneNonce}
        data-vasp-structure-mount
        tabIndex={0}
        aria-label="原子结构视图，方向键旋转，Shift 加方向键微调"
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
        点击原子测量距离 · 拖拽旋转 · 方向键旋转 · Shift+拖拽平移 · {wheelActive ? '滚轮缩放已启用，点击窗口外恢复页面滚动' : '点击结构窗口后可用滚轮缩放'}
      </div>
    </div>
  );
};

export default StructureViewer;
