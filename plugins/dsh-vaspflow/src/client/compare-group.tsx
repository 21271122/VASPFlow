/**
 * Shared state for one template-and-its-tasks group inside the batch card.
 *
 * Panes in the same group scroll together and expand their hidden unchanged
 * lines together, so the template and the tasks always show the same window
 * onto the file.
 */
import React from 'react';

export type CompareGroupState = {
  id: string;
  /** Unchanged runs are collapsed; opening them opens every pane in the group. */
  gapsOpen: boolean;
  toggleGaps: () => void;
};

const CompareGroupContext = React.createContext<CompareGroupState | null>(null);

export function CompareGroupProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const [gapsOpen, setGapsOpen] = React.useState(false);
  const toggleGaps = React.useCallback(() => setGapsOpen((current) => !current), []);
  const value = React.useMemo(() => ({ id, gapsOpen, toggleGaps }), [id, gapsOpen, toggleGaps]);
  return <CompareGroupContext.Provider value={value}>{children}</CompareGroupContext.Provider>;
}

export function useCompareGroup(): CompareGroupState | null {
  return React.useContext(CompareGroupContext);
}
