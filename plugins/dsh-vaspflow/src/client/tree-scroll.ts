export function scrollExpandedTreeRow(row: HTMLElement | null) {
  if (!row) return;
  requestAnimationFrame(() => {
    if (!row.isConnected) return;
    let container = row.parentElement;
    while (container && !/^(auto|scroll|overlay)$/.test(getComputedStyle(container).overflowY)) {
      container = container.parentElement;
    }
    if (!container) return;
    const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top
      + container.scrollTop - container.clientTop;
    container.scrollTo({ top, behavior: 'smooth' });
  });
}
