/**
 * Shared state for one template-and-its-tasks group inside the batch card.
 *
 * Every pane reports which lines it changes. The group keeps the union, so a
 * line is only collapsed when *no* pane in the group touches it — the template
 * and its tasks therefore hide exactly the same lines, and expanding shows the
 * same rows everywhere.
 */
import React from 'react';

export type CompareGroupState = {
  id: string;
  /** Lines changed by any pane in the group (0-based). */
  changed: Set<number>;
  /** Unchanged runs are collapsed; opening them opens every pane in the group. */
  gapsOpen: boolean;
  toggleGaps: () => void;
  /** Called by a pane whenever its own change flags change. */
  reportChanged: (paneId: string, flags: boolean[] | undefined) => void;
};

const CompareGroupContext = React.createContext<CompareGroupState | null>(null);

function sameFlags(left: boolean[], right: boolean[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export function CompareGroupProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const [gapsOpen, setGapsOpen] = React.useState(false);
  const panes = React.useRef(new Map<string, boolean[]>()).current;
  const [version, setVersion] = React.useState(0);

  const reportChanged = React.useCallback((paneId: string, flags?: boolean[]) => {
    if (!flags) {
      if (panes.delete(paneId)) setVersion((current) => current + 1);
      return;
    }
    const next = flags;
    if (sameFlags(panes.get(paneId) ?? [], next)) return;
    panes.set(paneId, next);
    setVersion((current) => current + 1);
  }, [panes]);

  const changed = React.useMemo(() => {
    const union = new Set<number>();
    for (const flags of panes.values()) {
      flags.forEach((flag, index) => { if (flag) union.add(index); });
    }
    return union;
  }, [panes, version]);

  const toggleGaps = React.useCallback(() => setGapsOpen((current) => !current), []);
  const value = React.useMemo(
    () => ({ id, changed, gapsOpen, toggleGaps, reportChanged }),
    [id, changed, gapsOpen, toggleGaps, reportChanged],
  );
  return <CompareGroupContext.Provider value={value}>{children}</CompareGroupContext.Provider>;
}

export function useCompareGroup(): CompareGroupState | null {
  return React.useContext(CompareGroupContext);
}
