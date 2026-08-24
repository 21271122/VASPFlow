/**
 * dsh-vaspflow — host plugin type declarations.
 *
 * The host half registers HTTP routes under /plugins/dsh-vaspflow/* and five
 * agent tools (vasp_scan, vasp_convergence, vasp_structure_scene,
 * vasp_task_files, vasp_read_file). This file satisfies the package's
 * `exports["."]` types field; runtime behaviour lives in lib/index.js.
 */
export declare const name = 'dsh-vaspflow';
export declare const inject: string[];
export declare function apply(ctx: unknown, config?: { defaultScanRoot?: string }): void;
