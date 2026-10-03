import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('./supercell.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { expandStructure } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const lattice = [[10, 0, 0], [0, 10, 0], [0, 0, 10]];
const atoms = [
  { site_index: 0, image_offset: [0, 0, 0], is_periodic_image: false },
  { site_index: 1, image_offset: [0, 0, 0], is_periodic_image: false },
  { site_index: 1, image_offset: [-1, 0, 0], is_periodic_image: true },
  { site_index: 0, image_offset: [1, 0, 0], is_periodic_image: true },
];
const structure = {
  lattice, species: ['H', 'H', 'H', 'H'], coords: [[0, 0, 0], [9, 0, 0], [-1, 0, 0], [10, 0, 0]], num_atoms: 2,
  bonds: [{ start_atom_index: 0, end_atom_index: 2 }, { start_atom_index: 1, end_atom_index: 3 }],
  scene: { atoms },
};

test('supercell repeats base atoms and scales the outer cell', () => {
  const result = expandStructure({ ...structure, bonds: [] }, [2, 3, 1], false);
  assert.equal(result.atoms.length, 12);
  assert.deepEqual(result.lattice, [[20, 0, 0], [0, 30, 0], [0, 0, 10]]);
  assert.equal(new Set(result.atoms.map((atom) => atom.key)).size, 12);
  assert.deepEqual(lattice, [[10, 0, 0], [0, 10, 0], [0, 0, 10]], 'source lattice remains unchanged');
});

test('skewed lattice translations use the full a and b vectors', () => {
  const result = expandStructure({
    lattice: [[2, 1, 0], [0, 3, 0], [0, 0, 4]],
    coords: [[0.5, 0.25, 0]], species: ['H'], num_atoms: 1, bonds: [],
  }, [2, 2, 1], false);
  assert.deepEqual(result.atoms.map((atom) => atom.position), [[0.5, 0.25, 0], [0.5, 3.25, 0], [2.5, 1.25, 0], [2.5, 4.25, 0]]);
});

test('1×1×1 preserves the original view and the boundary-neighbor switch', () => {
  const withNeighbors = expandStructure(structure, [1, 1, 1], true);
  const withoutNeighbors = expandStructure(structure, [1, 1, 1], false);
  assert.equal(withNeighbors.atoms.length, 4);
  assert.equal(withNeighbors.bonds.length, 2);
  assert.equal(withoutNeighbors.atoms.length, 2);
  assert.equal(withoutNeighbors.bonds.length, 0);
});

test('cross-boundary bonds become one interior bond without duplicate atoms', () => {
  const result = expandStructure(structure, [2, 1, 1], false);
  assert.deepEqual(result.atoms.map((atom) => atom.position[0]).sort((a, b) => a - b), [0, 9, 10, 19]);
  assert.equal(result.bonds.length, 1);
  assert.deepEqual([result.bonds[0].start.position[0], result.bonds[0].end.position[0]].sort((a, b) => a - b), [9, 10]);
});

test('optional outer neighbors add only the two exposed boundary atoms', () => {
  const result = expandStructure(structure, [2, 1, 1], true);
  assert.deepEqual(result.atoms.map((atom) => atom.position[0]).sort((a, b) => a - b), [-1, 0, 9, 10, 19, 20]);
  assert.equal(result.bonds.length, 3);
});
