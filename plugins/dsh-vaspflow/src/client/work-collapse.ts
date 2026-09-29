const FLOW = '[data-chat-flow]';
const ROW = '[data-chat-flow-kind]';
const SUMMARY = '[data-vfp-work-summary]';

function isWorkRow(row: HTMLElement): boolean {
  if (row.dataset.chatFlowKind === 'assistant-step') return !!row.querySelector('[data-variant="think"]');
  if (row.dataset.chatFlowKind !== 'tool-call') return false;
  if (row.querySelector('[data-dsh-vaspflow-tool]')) return false;
  return !row.querySelector('[data-tool="ask_user_question"]');
}

function workRuns(flow: HTMLElement): HTMLElement[][] {
  const runs: HTMLElement[][] = [];
  let pending: HTMLElement[] = [];
  for (const child of Array.from(flow.children)) {
    const row = child as HTMLElement;
    if (row.matches(ROW) && isWorkRow(row)) {
      pending.push(row);
    } else {
      if (pending.length > 1) runs.push(pending);
      pending = [];
    }
  }
  if (pending.length > 1) runs.push(pending);
  return runs;
}

function setAttr(node: HTMLElement, name: string, value: string | null) {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) {
    node.setAttribute(name, value);
  }
}

export function mountWorkCollapse(sessions: any): () => void {
  const expanded = new Set<string>();
  let scheduled = false;
  let disposed = false;

  const update = () => {
    scheduled = false;
    if (disposed) return;
    const state = sessions.list.getSnapshot();
    const sessionId = state.current;
    const enabled = !!sessionId && state.byId[sessionId]?.agentPreset === 'vasp';
    for (const flow of document.querySelectorAll<HTMLElement>(FLOW)) {
      const desired = new Map<HTMLElement, { first: boolean; open: boolean; label?: string; key?: string }>();
      if (enabled) for (const run of workRuns(flow)) {
        const first = run[0];
        const key = `${sessionId}:${first.dataset.chatFlowKey ?? ''}`;
        const open = expanded.has(key);
        const errors = run.some((row) => !!row.querySelector('[data-state="error"]'));
        const active = run.some((row) => !!row.querySelector('[data-state="running"]'));
        const label = `${active ? '正在工作与思考' : '工作与思考'} · ${run.length} 项${errors ? ' · 有错误' : ''}`;
        desired.set(first, { first: true, open, label, key });
        for (const row of run.slice(1)) desired.set(row, { first: false, open });
      }
      for (const row of Array.from(flow.children) as HTMLElement[]) {
        const group = desired.get(row);
        setAttr(row, 'data-vfp-work-first', group?.first ? '' : null);
        setAttr(row, 'data-vfp-work-member', group && !group.first && !group.open ? '' : null);
        setAttr(row, 'data-vfp-work-open', group?.first && group.open ? '' : null);
        const button = row.querySelector<HTMLButtonElement>(`:scope > ${SUMMARY}`);
        if (!group?.first) {
          button?.remove();
          continue;
        }
        const summary = button ?? document.createElement('button');
        if (!button) {
          summary.type = 'button';
          summary.setAttribute('data-vfp-work-summary', '');
          row.prepend(summary);
        }
        if (summary.textContent !== group.label) summary.textContent = group.label ?? '';
        setAttr(summary, 'aria-expanded', String(group.open));
        summary.onclick = () => {
          if (expanded.has(group.key!)) expanded.delete(group.key!);
          else expanded.add(group.key!);
          schedule();
        };
      }
    }
  };

  const schedule = () => {
    if (disposed || scheduled) return;
    scheduled = true;
    queueMicrotask(update);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = sessions.list.subscribe(schedule);
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    unsubscribe();
    for (const row of document.querySelectorAll<HTMLElement>('[data-vfp-work-first],[data-vfp-work-member]')) {
      row.querySelector(`:scope > ${SUMMARY}`)?.remove();
      row.removeAttribute('data-vfp-work-first');
      row.removeAttribute('data-vfp-work-member');
      row.removeAttribute('data-vfp-work-open');
    }
  };
}
