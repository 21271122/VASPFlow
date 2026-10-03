import type { ViewerStructure } from './api';

export type Repeat = [number, number, number];
export type DisplayAtom = {
  key: string;
  siteIndex: number;
  element: string;
  offset: Repeat;
  position: Repeat;
};
export type DisplayBond = { start: DisplayAtom; end: DisplayAtom };

export function supercellLattice(lattice: number[][], repeat: Repeat): number[][] {
  return lattice.map((vector, axis) => vector.map((value) => value * repeat[axis]));
}

export function expandStructure(struct: ViewerStructure, repeat: Repeat, showOuterNeighbors: boolean): { atoms: DisplayAtom[]; bonds: DisplayBond[]; lattice: number[][] } {
  const lattice = struct.lattice;
  const sourceAtoms = struct.scene?.atoms;
  const atoms = new Map<string, DisplayAtom>();
  const bonds = new Map<string, DisplayBond>();
  const within = (offset: Repeat) => offset.every((value, axis) => value >= 0 && value < repeat[axis]);
  const addAtom = (index: number, tile: Repeat): DisplayAtom | undefined => {
    const position = struct.coords[index];
    if (!position) return undefined;
    const source = sourceAtoms?.[index];
    const offset = tile.map((value, axis) => value + (source?.image_offset?.[axis] ?? 0)) as Repeat;
    if (!within(offset) && !showOuterNeighbors) return undefined;
    const siteIndex = source?.site_index ?? index;
    const key = `${siteIndex}:${offset.join(':')}`;
    let atom = atoms.get(key);
    if (!atom) {
      atom = {
        key, siteIndex, element: struct.species[index] || 'X', offset,
        position: position.map((value, axis) => value + tile.reduce((sum, count, latticeAxis) => sum + count * (lattice[latticeAxis]?.[axis] ?? 0), 0)) as Repeat,
      };
      atoms.set(key, atom);
    }
    return atom;
  };

  const baseIndices = struct.coords.map((_, index) => index).filter((index) => !sourceAtoms?.[index]?.is_periodic_image);
  for (let a = 0; a < repeat[0]; a += 1) for (let b = 0; b < repeat[1]; b += 1) for (let c = 0; c < repeat[2]; c += 1) {
    const tile: Repeat = [a, b, c];
    baseIndices.forEach((index) => addAtom(index, tile));
    struct.bonds?.forEach((bond) => {
      const start = addAtom(bond.start_atom_index, tile);
      const end = addAtom(bond.end_atom_index, tile);
      if (!start || !end) return;
      const key = [start.key, end.key].sort().join('|');
      if (!bonds.has(key)) bonds.set(key, { start, end });
    });
  }
  return { atoms: [...atoms.values()], bonds: [...bonds.values()], lattice: supercellLattice(lattice, repeat) };
}
