import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export function useTreeScrollPath(ref: RefObject<HTMLElement>, version: string): string {
  const [path, setPath] = useState('');
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = container.getBoundingClientRect().top + container.clientTop + 1;
      const breadcrumb = container.parentElement?.querySelector<HTMLElement>('.vfp-tree-breadcrumb');
      const visibleTop = top + (breadcrumb && !breadcrumb.hidden ? breadcrumb.getBoundingClientRect().height : 0);
      const expanded = (folder: HTMLElement) => folder.tagName === 'DETAILS'
        ? folder.hasAttribute('open') : !!folder.querySelector(':scope > .vfp-path-children');
      const visible = (entry: HTMLElement) => {
        let ancestor = entry.parentElement?.closest<HTMLElement>('.vfp-path-folder') ?? null;
        if (entry.dataset.vfpTreePath !== undefined && ancestor === entry.parentElement) {
          ancestor = ancestor.parentElement?.closest<HTMLElement>('.vfp-path-folder') ?? null;
        }
        for (; ancestor; ancestor = ancestor.parentElement?.closest<HTMLElement>('.vfp-path-folder') ?? null) {
          if (!expanded(ancestor)) return false;
        }
        return true;
      };
      const current = [...container.querySelectorAll<HTMLElement>('[data-vfp-tree-path], [data-vfp-tree-parent]')]
        .find((entry) => {
          const rect = entry.getBoundingClientRect();
          return visible(entry) && rect.height > 0 && rect.bottom > visibleTop;
        });
      let folder = current?.closest<HTMLElement>('.vfp-path-folder') ?? null;
      if (folder && current?.dataset.vfpTreePath !== undefined
        && (!expanded(folder) || current.getBoundingClientRect().top >= visibleTop)) {
        folder = folder.parentElement?.closest<HTMLElement>('.vfp-path-folder') ?? null;
      }
      let nextPath = '';
      for (; folder; folder = folder.parentElement?.closest<HTMLElement>('.vfp-path-folder') ?? null) {
        const heading = folder.querySelector<HTMLElement>(':scope > [data-vfp-tree-path]');
        if (heading && expanded(folder) && heading.getBoundingClientRect().top < visibleTop) {
          nextPath = heading.dataset.vfpTreePath ?? '';
          break;
        }
      }
      setPath((previous) => previous === nextPath ? previous : nextPath);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    container.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => { container.removeEventListener('scroll', schedule); if (frame) cancelAnimationFrame(frame); };
  }, [ref, version, path]);
  return path;
}

export function scrollExpandedTreeRow(row: HTMLElement | null) {
  if (!row) return;
  requestAnimationFrame(() => {
    if (!row.isConnected) return;
    let container = row.parentElement;
    while (container && !/^(auto|scroll|overlay)$/.test(getComputedStyle(container).overflowY)) {
      container = container.parentElement;
    }
    if (!container) return;
    const path = row.dataset.vfpTreePath
      ?? row.closest<HTMLElement>('[data-vfp-tree-parent]')?.dataset.vfpTreeParent
      ?? row.querySelector<HTMLElement>('[data-vfp-tree-path]')?.dataset.vfpTreePath ?? '';
    const breadcrumbOffset = container.classList.contains('vfp-path-tree') && path.includes('/') ? 32 : 0;
    const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top
      + container.scrollTop - container.clientTop - breadcrumbOffset;
    container.scrollTo({ top, behavior: 'smooth' });
  });
}
