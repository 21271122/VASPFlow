/**
 * dsh-vaspflow — host plugin type declarations.
 *
 * The host half registers HTTP routes under /plugins/dsh-vaspflow/* and
 * provides the VASP preset's scoped tool service. This file satisfies the
 * package's `exports["."]` types field; runtime behaviour lives in lib/index.js.
 */
export declare const name = 'dsh-vaspflow';
export declare const inject: string[];
export declare function apply(ctx: unknown, config?: { defaultScanRoot?: string }): void;
export declare function registerVaspTools(ctx: unknown, store: unknown): void;
