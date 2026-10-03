export const STRUCTURE_DRAG_TYPE = 'application/x-dsh-vaspflow-structure';

export type StructureDrag = {
  kind: 'file' | 'task' | 'directory';
  rootPath: string;
  relPath: string;
  file?: string;
};

export function isStructureFile(name: string): boolean {
  if (/[\\/]/.test(name)) return false;
  const upper = name.toUpperCase();
  return upper === 'POSCAR' || upper === 'CONTCAR' || upper.endsWith('.VASP');
}

export function startStructureDrag(dataTransfer: DataTransfer, item: StructureDrag): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(STRUCTURE_DRAG_TYPE, JSON.stringify(item));
  dataTransfer.setData(`${STRUCTURE_DRAG_TYPE}-${item.kind}`, '1');
}

export function readStructureDrag(dataTransfer: DataTransfer): StructureDrag | null {
  try {
    const item = JSON.parse(dataTransfer.getData(STRUCTURE_DRAG_TYPE));
    if (!item || !['file', 'task', 'directory'].includes(item.kind) || typeof item.rootPath !== 'string' || !item.rootPath
      || typeof item.relPath !== 'string' || (item.kind === 'file' && (typeof item.file !== 'string' || !isStructureFile(item.file)))) return null;
    return item;
  } catch { return null; }
}
