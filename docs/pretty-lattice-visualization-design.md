# VASPFlow Visualization Upgrade Design

## Summary

Pretty Lattice can be a strong reference for VASPFlow's visualization layer, but it should not be imported wholesale. Pretty Lattice is a dedicated crystal figure-making application; VASPFlow is a VASP workflow manager with structure viewing as one panel. The right approach is to borrow its data-contract and rendering ideas while keeping VASPFlow's existing task/file workflow intact.

This document proposes an incremental redesign of VASPFlow's structure visualization around a richer backend scene payload, a smaller React/Three rendering core, and optional style/export controls.

## Assumptions

- VASPFlow remains a desktop/web app for browsing VASP calculation directories, convergence plots, structures, and files.
- The first target is improving `frontend/src/components/StructureViewer.tsx`, not replacing the whole application shell.
- Structure files remain read-only: POSCAR, CONTCAR, and `.vasp` are visualized, not edited.
- The implementation should stay surgical. Start with data and rendering quality before adding broad UI controls.
- We can depend on packages already present where possible: pymatgen on the backend, Three.js / React Three Fiber on the frontend.

## What Pretty Lattice Implements That Is Relevant

Pretty Lattice provides a useful model in four areas:

- Backend scene generation: pymatgen parses the structure, then the backend returns a render-ready scene JSON containing cell vectors, atoms, bonds, periodic images, polyhedra, and structure summary.
- Connectivity analysis: it supports `crystal-nn`, `minimum-distance`, and VESTA-style cutoff dictionary bonding, plus custom cutoff overrides by bond family.
- Rendering architecture: atoms, bonds, cell frame, polyhedra, camera controls, orientation gizmo, object selection, and styling are separated into focused modules rather than one large viewer file.
- Figure export and styling: it supports material presets, color schemes, component visibility/opacity, axis/legend export, PNG/JPG/PDF output, and mesh quality controls.

Useful upstream references:

- <https://github.com/songfeitong/pretty-lattice/blob/main/src/pretty_lattice/structures/scene_builder.py>
- <https://github.com/songfeitong/pretty-lattice/blob/main/src/pretty_lattice/structures/connectivity.py>
- <https://github.com/songfeitong/pretty-lattice/blob/main/web/src/scene/LatticeScene.tsx>
- <https://github.com/songfeitong/pretty-lattice/blob/main/web/src/app/controls/commonPanel/ExportTab.tsx>

## Current VASPFlow Visualization State

VASPFlow currently has a compact visualization pipeline:

- Backend endpoint: `/api/task/{task_id}/structure`
- Backend structure shape:
  - `lattice`
  - `species`
  - `coords`
  - `frac_coords`
  - `num_atoms`
- Frontend viewer:
  - renders atoms as individual spheres
  - draws unit-cell edges
  - supports POSCAR/CONTCAR/.vasp tabs
  - supports 1-3 expansion along a/b/c
  - supports simple view buttons: `iso`, `a`, `b`, `c`, `fit`
  - persists camera per task/file in session storage
  - shows selected atom coordinates in a bottom strip

This is a good base. The main limitations are:

- No bonds.
- No periodic boundary image semantics.
- No polyhedra.
- No structure summary beyond atom count and lattice lengths.
- One large component owns parsing state, rendering, controls, cache, and selection.
- No publication-style export.
- Per-atom sphere rendering may become slow for large structures.

## Design Goals

- Improve structure comprehension: bonds, cell, periodic images, selected atom/bond information.
- Improve visual quality: better materials, lighting, colors, and camera fit.
- Preserve VASPFlow's workflow: select VASP task -> view structure -> inspect related files and convergence.
- Keep the first implementation small enough to review.
- Make the backend response explicit and versioned so frontend rendering can evolve without ad hoc fields.

## Non-Goals

- Do not turn VASPFlow into a full Pretty Lattice clone.
- Do not add structure editing.
- Do not replace pymatgen with a custom parser.
- Do not add every Pretty Lattice control in the first pass.
- Do not introduce a second local backend service.

## Proposed Architecture

### Backend

Add a new scene-oriented endpoint while keeping the old endpoint for compatibility:

```text
GET /api/task/{task_id}/structure-scene?file=CONTCAR&include_connectivity=false&bond_algorithm=cut-off-dict
```

Return a render-ready structure scene:

```ts
interface StructureScene {
  version: 1;
  cell: {
    vectors: number[][];
    lengths: [number, number, number];
    angles: [number, number, number];
  };
  atoms: SceneAtom[];
  bonds: SceneBond[];
  bond_families: SceneBondFamily[];
  summary: {
    formula: string;
    atom_count: number;
    space_group?: string | null;
    crystal_system?: string | null;
  };
  warnings: string[];
}

interface SceneAtom {
  id: string;
  site_index: number;
  element: string;
  position: [number, number, number];
  fractional_position: [number, number, number];
  image_offset: [number, number, number];
  is_periodic_image: boolean;
}

interface SceneBond {
  id: string;
  family_key: string;
  start_atom_index: number;
  end_atom_index: number;
  length: number;
}
```

Implementation modules:

- `backend/structure.py`: keep `get_structure`, add `get_structure_scene`.
- `backend/structure_scene.py`: new focused module for scene construction.
- `backend/structure_connectivity.py`: optional focused module if bond generation grows past simple logic.

Initial bonding strategy:

- Start with VESTA-style cutoff dictionary if pymatgen exposes a stable preset in the installed environment.
- Otherwise use `CrystalNN` or `MinimumDistanceNN` behind a small adapter.
- Treat connectivity as optional: if bonding fails, return atoms/cell/summary plus a warning.

### Frontend

Split the current `StructureViewer.tsx` into smaller pieces over time:

```text
StructureViewer.tsx
  StructureFileTabs.tsx
  StructureToolbar.tsx
  StructureSceneCanvas.tsx
  scene/
    Atoms.tsx
    Bonds.tsx
    UnitCell.tsx
    CameraController.tsx
    elementColors.ts
    sceneGeometry.ts
```

Keep the existing top-level behavior:

- list available structure files
- cache loaded structures by task/file
- switch active file
- show loading/error/empty states
- preserve camera state

Add render features in order:

1. Bonds as cylinders or lines.
2. A lightweight display toolbar for atoms, bonds, cell, expansion.
3. Better material/lighting defaults.
4. Atom and bond inspection.
5. Optional orientation gizmo.
6. Optional export.

## Implementation Plan

### Phase 1: Scene Contract and Better Structure Summary

Goal: create a richer backend response without changing the current viewer behavior.

Changes:

- Add `backend/structure_scene.py`.
- Add `/api/task/{task_id}/structure-scene`.
- Include cell lengths, angles, formula, atom count, and stable atom IDs.
- Keep old `/structure` endpoint untouched.
- Add a small frontend type for `StructureScene`.

Verification:

- Python parse/import check for backend modules.
- Manual API call against a POSCAR/CONTCAR task.
- Existing TypeScript check still passes.

### Phase 2: Bonds

Goal: show bonds without adding many controls.

Changes:

- Add backend bond generation.
- Add frontend `Bonds` component.
- Add a simple show/hide bonds toggle near the current view buttons.
- Show selected bond length when clicked.

Verification:

- Test NaCl/SrTiO3-like fixtures if available.
- Confirm no bonds still renders atoms/cell.
- Confirm large structures do not freeze the UI.

### Phase 3: Viewer Refactor

Goal: reduce `StructureViewer.tsx` size and make future changes safer.

Changes:

- Move atom rendering, unit-cell rendering, expanded-structure math, camera persistence, and toolbar into separate files.
- Keep visual behavior the same.
- Avoid introducing new UI features during this phase.

Verification:

- TypeScript check.
- Manual check: switch POSCAR/CONTCAR, expand a/b/c, select atom, use camera buttons.

### Phase 4: Visual Polish

Goal: bring Pretty Lattice-like visual quality into VASPFlow without a huge settings surface.

Changes:

- Add material presets internally: `matte`, `glossy`, maybe `flat`.
- Improve lighting.
- Add color scheme selection only if current Jmol colors are not enough.
- Add opacity controls for atoms/bonds/cell only if users need them.

Verification:

- Desktop/mobile-ish viewport screenshots if browser test tooling is available.
- Ensure text and overlays do not overlap the canvas.

### Phase 5: Export

Goal: export the current structure view as a figure.

Changes:

- Add a download button in the structure toolbar.
- Start with PNG only.
- Later consider JPG/PDF and separate legend/axis exports.

Verification:

- Export file is non-empty.
- Export uses current camera orientation and visibility settings.
- Transparent/white background behavior is explicit.

## What To Borrow Directly As Ideas

- A scene JSON contract instead of frontend-specific ad hoc structure fields.
- Backend-side pymatgen analysis.
- Optional connectivity for expensive cases.
- Stable object IDs for atoms and bonds.
- Separate components for atoms, bonds, unit cell, camera control, and export.
- Component visibility/opacity state model.
- Render limits and graceful warnings.

## What Not To Borrow Directly

- The full Pretty Lattice app shell.
- Its full settings sidebar.
- Its full export system in the first iteration.
- Its complete material preset infrastructure.
- Its custom UI component system.
- Its large amount of test and spec scaffolding unless VASPFlow grows into that scale.

## Risks and Tradeoffs

- Connectivity can be chemically debatable. Different algorithms may produce different bonds. The UI should label the algorithm and allow bonds to be hidden.
- Large structures can overwhelm both backend analysis and frontend rendering. Add limits and warnings early.
- Per-atom sphere rendering is simple but not scalable. If VASPFlow needs thousands of atoms, use instanced or batched rendering.
- Too many controls can distract from VASPFlow's workflow-management purpose. Keep controls compact.
- Pretty Lattice is MIT licensed, but copying code still requires preserving attribution. Prefer reimplementation from concepts unless a specific file is intentionally reused.

## Recommended First PR

The first implementation should be narrow:

1. Add `GET /api/task/{task_id}/structure-scene`.
2. Return atoms, cell, formula, lengths, angles, and warnings.
3. Add frontend types and switch `StructureViewer` data loading to the scene endpoint behind a small adapter.
4. Keep the rendered output visually unchanged.

This creates the foundation for bonds and export while minimizing risk.

## Success Criteria

- Existing structure viewer behavior still works.
- Scene endpoint returns stable, documented data.
- The old structure endpoint remains usable.
- `npx.cmd tsc --noEmit` passes.
- Python backend files parse/import in the intended conda environment.
- A user can still open a VASP project, select a task, and view POSCAR/CONTCAR without learning a new workflow.
