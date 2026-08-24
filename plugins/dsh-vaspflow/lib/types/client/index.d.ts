/**
 * dsh-vaspflow — client (browser) plugin type declarations.
 *
 * The client half mounts the sidebar "VASP" entry and the right-dock panel
 * (task list, convergence chart, 3D structure viewer, file browser). Runtime
 * behaviour lives in lib/client.js.
 */
export declare const apply: (ctx: unknown) => void;
export declare const inject: string[];
