/**
 * scene.ts — 结构场景构建，逐行移植自插件宿主
 * plugins/dsh-vaspflow/lib/host/structure.js（parseStructureFile / atomSpec /
 * buildBondSpecs）与 src/client/StructureViewer.tsx 的半径取值。
 *
 * 移植范围仅限宣传片需要用到的部分：晶格 + 分数坐标 → 场景 JSON（cell /
 * atoms / bonds / summary）。空间群对称性分析（pymatgen 替身）未移植，
 * 因此 summary.space_group 保持 null —— 卡片里它本来就只影响一行文字。
 *
 * 宣传片的 3D 视图走 SVG（无 WebGL、逐帧确定性），但原子位置、成键判据、
 * 元素颜色、球半径公式全部沿用插件实现，视觉语言与真实卡片一致。
 */
import { atomColor, vdwRadiusOf } from './tokens';

export type Vec3 = [number, number, number];

export interface AtomSpec {
  id: string;
  site_index: number;
  element: string;
  position: Vec3;
  fractional_position: Vec3;
  image_offset: Vec3;
  is_periodic_image: boolean;
}

export interface BondSpec {
  id: string;
  family_key: string;
  start_atom_index: number;
  end_atom_index: number;
  length: number;
}

export interface StructureScene {
  version: 1;
  cell: { vectors: number[][]; lengths: number[]; angles: number[] };
  atoms: AtomSpec[];
  bonds: BondSpec[];
  bond_families: { key: string; elements: string[]; min_length: number; max_length: number }[];
  summary: {
    formula: string;
    atom_count: number;
    space_group: string | null;
    space_group_number: number | null;
    crystal_system: string | null;
    bond_algorithm: string | null;
  };
  warnings: string[];
}

interface ParsedStructure {
  lattice: Vec3[];
  species: string[];
  fracCoords: Vec3[];
  numAtoms: number;
}

const clean = (value: number) => Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(10));

function matVec(matrix: number[][], vector: number[]): Vec3 {
  return [0, 1, 2].map((axis) => matrix[0][axis] * vector[0] + matrix[1][axis] * vector[1] + matrix[2][axis] * vector[2]) as Vec3;
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** parseStructureFile 的精简移植：晶格 + 物种 + 分数坐标。 */
export function parseStructureFile(text: string): ParsedStructure {
  const lines = text.split(/\r?\n/);
  let idx = 0;
  while (idx < lines.length && lines[idx].trim() === '') idx += 1;
  const scale = Number(lines[idx + 1].trim().split(/\s+/)[0]) || 1;
  const lattice: Vec3[] = [];
  for (let i = 0; i < 3; i += 1) {
    const parts = lines[idx + 2 + i].trim().split(/\s+/).slice(0, 3).map(Number);
    lattice.push([parts[0] * scale, parts[1] * scale, parts[2] * scale]);
  }
  let cursor = idx + 5;
  const species = lines[cursor].trim().split(/\s+/).filter((s) => /^[A-Za-z]/.test(s));
  cursor += 1;
  const counts: number[] = [];
  while (cursor < lines.length && counts.length < species.length) {
    for (const part of lines[cursor].trim().split(/\s+/)) {
      const n = Number(part);
      if (Number.isFinite(n) && n >= 0) counts.push(n);
      if (counts.length >= species.length) break;
    }
    cursor += 1;
  }
  if (cursor < lines.length && /selective/i.test(lines[cursor])) cursor += 1;
  let cartesian = false;
  if (cursor < lines.length) {
    const mode = lines[cursor].trim().toLowerCase();
    if (mode.startsWith('c') || mode.startsWith('k')) cartesian = true;
  }
  cursor += 1;
  const fracCoords: Vec3[] = [];
  for (let s = 0; s < species.length; s += 1) {
    for (let n = 0; n < (counts[s] ?? 0); n += 1) {
      const parts = lines[cursor].trim().split(/\s+/).slice(0, 3).map(Number);
      cursor += 1;
      const frac: Vec3 = cartesian
        ? (() => {
            const x = parts[0], y = parts[1], z = parts[2];
            const det = lattice[0][0] * (lattice[1][1] * lattice[2][2] - lattice[1][2] * lattice[2][1])
              - lattice[0][1] * (lattice[1][0] * lattice[2][2] - lattice[1][2] * lattice[2][0])
              + lattice[0][2] * (lattice[1][0] * lattice[2][1] - lattice[1][1] * lattice[2][0]);
            const inv = (row: number, col: number) => {
              const m = [0, 1, 2].filter((i) => i !== row);
              const c = [0, 1, 2].filter((i) => i !== col);
              const minor = lattice[m[0]][c[0]] * lattice[m[1]][c[1]] - lattice[m[0]][c[1]] * lattice[m[1]][c[0]];
              return ((row + col) % 2 === 0 ? 1 : -1) * minor / det;
            };
            return [
              inv(0, 0) * x + inv(1, 0) * y + inv(2, 0) * z,
              inv(0, 1) * x + inv(1, 1) * y + inv(2, 1) * z,
              inv(0, 2) * x + inv(1, 2) * y + inv(2, 2) * z,
            ] as Vec3;
          })()
        : ([parts[0], parts[1], parts[2]] as Vec3);
      fracCoords.push(frac);
    }
  }
  const flatSpecies = species.flatMap((symbol, s) => Array.from({ length: counts[s] ?? 0 }, () => symbol));
  return { lattice, species: flatSpecies, fracCoords, numAtoms: fracCoords.length };
}

function atomSpec(struct: ParsedStructure, siteIndex: number, image: Vec3, isPeriodicImage: boolean): AtomSpec {
  const element = struct.species[siteIndex];
  const cart = matVec(struct.lattice, struct.fracCoords[siteIndex]);
  const site = struct.fracCoords[siteIndex];
  return {
    id: image[0] === 0 && image[1] === 0 && image[2] === 0
      ? `${element}-${siteIndex}`
      : `${element}-${siteIndex}-image-${image[0]}-${image[1]}-${image[2]}`,
    site_index: siteIndex,
    element,
    position: matVec(struct.lattice, [site[0] + image[0], site[1] + image[1], site[2] + image[2]]).map(clean) as Vec3,
    fractional_position: [site[0] + image[0], site[1] + image[1], site[2] + image[2]].map(clean) as Vec3,
    image_offset: image.map((v) => Math.round(v)) as Vec3,
    is_periodic_image: isPeriodicImage,
  };
}

/** periodicDistanceWithImage：在 ±1 的周期镜像里取最短距离并回报该镜像。 */
function periodicDistanceWithImage(lattice: Vec3[], fracA: Vec3, fracB: Vec3) {
  let best = Number.POSITIVE_INFINITY;
  let bestImage: Vec3 = [0, 0, 0];
  const cartA = matVec(lattice, fracA);
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      for (let k = -1; k <= 1; k += 1) {
        const cartB = matVec(lattice, [fracB[0] + i, fracB[1] + j, fracB[2] + k]);
        const d = distance(cartA, cartB);
        if (d < best - 1e-12) { best = d; bestImage = [i, j, k]; }
      }
    }
  }
  return { dist: best, image: bestImage };
}

const bondFamilyKey = (a: string, b: string) => [a, b].sort((x, y) => x.localeCompare(y)).join('|');

function reducedFormula(species: string[]): string {
  const counts = new Map<string, number>();
  for (const s of species) counts.set(s, (counts.get(s) ?? 0) + 1);
  const values = [...counts.values()];
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const factor = values.reduce((a, b) => gcd(a, b), values[0] ?? 1) || 1;
  return [...counts.entries()].map(([el, n]) => n / factor === 1 ? el : `${el}${n / factor}`).join('');
}

function cellLengths(lattice: Vec3[]): number[] {
  return lattice.map((v) => Number(Math.hypot(v[0], v[1], v[2]).toFixed(6)));
}

function cellAngles(lattice: Vec3[]): number[] {
  const angle = (a: Vec3, b: Vec3) => {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return Number((Math.acos(dot / (Math.hypot(...a) * Math.hypot(...b))) * 180 / Math.PI).toFixed(4));
  };
  return [angle(lattice[1], lattice[2]), angle(lattice[0], lattice[2]), angle(lattice[0], lattice[1])];
}

/** getStructureScene 的精简移植（成键部分逐行对应）。 */
export function buildScene(struct: ParsedStructure, bondAlgorithm = 'minimum-distance'): StructureScene {
  const warnings: string[] = [];
  const atoms: AtomSpec[] = struct.fracCoords.map((_, index) => atomSpec(struct, index, [0, 0, 0], false));
  const bondsByPair = new Map<string, BondSpec>();
  const familyLengths = new Map<string, number[]>();
  const atomIndexByKey = new Map<string, number>();
  atoms.forEach((atom, index) => atomIndexByKey.set(`${atom.site_index}:0:0:0`, index));
  const imageIndexByKey = new Map<string, number>();
  const ensureImage = (siteIndex: number, image: Vec3): number => {
    const key = `${siteIndex}:${image[0]}:${image[1]}:${image[2]}`;
    const existing = imageIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const spec = atomSpec(struct, siteIndex, image, true);
    const newIndex = atoms.length;
    atoms.push(spec);
    imageIndexByKey.set(key, newIndex);
    return newIndex;
  };
  const push = (start: number, end: number, family: string) => {
    const key = `${start}:${end}`;
    if (bondsByPair.has(key)) return;
    const length = distance(atoms[start].position, atoms[end].position);
    bondsByPair.set(key, {
      id: `bond:${start}-${end}`, family_key: family,
      start_atom_index: start, end_atom_index: end, length: Number(length.toFixed(6)),
    });
    if (!familyLengths.has(family)) familyLengths.set(family, []);
    familyLengths.get(family)!.push(length);
  };
  const vdw = struct.species.map((s) => vdwRadiusOf(s));
  for (let source = 0; source < struct.numAtoms; source += 1) {
    const sourceAtomIndex = atomIndexByKey.get(`${source}:0:0:0`);
    if (sourceAtomIndex === undefined) continue;
    for (let target = source + 1; target < struct.numAtoms; target += 1) {
      const { dist, image } = periodicDistanceWithImage(struct.lattice, struct.fracCoords[source], struct.fracCoords[target]);
      if (dist >= (vdw[source] + vdw[target]) / 2) continue;
      const targetAtomIndex = atomIndexByKey.get(`${target}:0:0:0`);
      if (targetAtomIndex === undefined) continue;
      const familyKey = bondFamilyKey(struct.species[source], struct.species[target]);
      if (image[0] === 0 && image[1] === 0 && image[2] === 0) { push(sourceAtomIndex, targetAtomIndex, familyKey); continue; }
      const bImage: Vec3 = [-image[0], -image[1], -image[2]];
      push(sourceAtomIndex, ensureImage(target, bImage), familyKey);
      push(targetAtomIndex, ensureImage(source, image), familyKey);
    }
  }
  const bonds = [...bondsByPair.values()];
  const bondFamilies = [...familyLengths.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, lengths]) => ({ key, elements: key.split('|'), min_length: Number(Math.min(...lengths).toFixed(6)), max_length: Number(Math.max(...lengths).toFixed(6)) }));
  return {
    version: 1,
    cell: { vectors: struct.lattice.map((v) => v.map(clean)), lengths: cellLengths(struct.lattice), angles: cellAngles(struct.lattice) },
    atoms,
    bonds,
    bond_families: bondFamilies,
    summary: {
      formula: reducedFormula(struct.species), atom_count: struct.numAtoms,
      space_group: null, space_group_number: null, crystal_system: null,
      bond_algorithm: bondAlgorithm,
    },
    warnings,
  };
}

/** 宣传片里展示的 CONTCAR（3C-SiC 惯用胞，真实可信的 VASP 体系）。 */
export const SIC_CONTCAR = `SiC zincblende (3C-SiC) conventional cell - relaxed
   1.00000000000000
     4.3600000000000000    0.0000000000000000    0.0000000000000000
     0.0000000000000000    4.3600000000000000    0.0000000000000000
     0.0000000000000000    0.0000000000000000    4.3600000000000000
   Si   C
     4     4
Direct
  0.0000000000000000  0.0000000000000000  0.0000000000000000
  0.0000000000000000  0.5000000000000000  0.5000000000000000
  0.5000000000000000  0.0000000000000000  0.5000000000000000
  0.5000000000000000  0.5000000000000000  0.0000000000000000
  0.2500000000000000  0.2500000000000000  0.2500000000000000
  0.2500000000000000  0.7500000000000000  0.7500000000000000
  0.7500000000000000  0.2500000000000000  0.7500000000000000
  0.7500000000000000  0.7500000000000000  0.2500000000000000
`;

export const siCScene: StructureScene = buildScene(parseStructureFile(SIC_CONTCAR));

/**
 * 把场景正交/透视投影到 2D。旋转矩阵与 StructureViewer 的默认视角同向
 * （先绕 z 后绕 x），但固定不交互。
 */
export function projectScene(scene: StructureScene, options: { width: number; height: number; yaw?: number; pitch?: number; zoom?: number; ballScale?: number }) {
  const { width, height, yaw = -0.62, pitch = 0.42, zoom = 1, ballScale = 1 } = options;
  const cell = scene.cell.vectors;
  // 只做旋转，不平移；随后按投影后的真实包围盒整体对焦，这样周期镜像原子
  // 不会被裁掉，结构始终居中铺满画布。
  const rotate = (p: number[]): Vec3 => {
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    const x1 = p[0] * ca - p[1] * sa, y1 = p[0] * sa + p[1] * ca;
    const cb = Math.cos(pitch), sb = Math.sin(pitch);
    return [x1, y1 * cb - p[2] * sb, y1 * sb + p[2] * cb];
  };
  const corners: Vec3[] = [];
  for (let i = 0; i <= 1; i += 1) for (let j = 0; j <= 1; j += 1) for (let k = 0; k <= 1; k += 1) {
    corners.push([
      i * cell[0][0] + j * cell[1][0] + k * cell[2][0],
      i * cell[0][1] + j * cell[1][1] + k * cell[2][1],
      i * cell[0][2] + j * cell[1][2] + k * cell[2][2],
    ]);
  }
  const rotated = [...scene.atoms.map((atom) => rotate(atom.position)), ...corners.map((corner) => rotate(corner))];
  const xs = rotated.map((p) => p[0]), ys = rotated.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  // 画布越小，留白按比例收紧，否则小尺寸看板里的结构会被压成一个小点。
  const padding = Math.max(16, Math.min(52, Math.min(width, height) * 0.17));
  const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY) * zoom;
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const toScreen = (p: number[]) => {
    const r = rotate(p);
    return { x: width / 2 + (r[0] - centerX) * scale, y: height / 2 - (r[1] - centerY) * scale, depth: r[2] };
  };
  const atoms = scene.atoms.map((atom, index) => {
    const radius = (vdwRadiusOf(atom.element) / 4 * 1.35) * ballScale * scale;
    return { index, atom, ...toScreen(atom.position), radius, color: atomColor(atom.element) };
  });
  const bonds = scene.bonds.map((bond) => {
    const a = atoms[bond.start_atom_index], b = atoms[bond.end_atom_index];
    return {
      id: bond.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      depth: (a.depth + b.depth) / 2,
      radius: 0.135 * scale,
      // 与 buildBondCylinder 一样：一根键拆成两半，各用一端原子的元素色。
      color1: atomColor(a.atom.element),
      color2: atomColor(b.atom.element),
    };
  });
  const edgePairs: [number, number][] = [];
  for (let i = 0; i < 8; i += 1) for (let j = i + 1; j < 8; j += 1) {
    let diff = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const bit = (i >> axis) & 1, other = (j >> axis) & 1;
      if (bit !== other) diff += 1;
    }
    if (diff === 1) edgePairs.push([i, j]);
  }
  const edges = edgePairs.map(([i, j]) => {
    const a = toScreen(corners[i]), b = toScreen(corners[j]);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, depth: (a.depth + b.depth) / 2 };
  });
  return { atoms, bonds, edges, scale };
}
