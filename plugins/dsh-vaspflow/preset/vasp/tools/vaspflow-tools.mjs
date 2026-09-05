/**
 * VASP Agent preset bridge.
 *
 * The host plugin owns the implementations and its shared TaskStore. This
 * preset-only module merely exposes those definitions to Agents that selected
 * the VASP preset; other presets never mount this row.
 */
export const name = 'tool-vaspflow-tools';
export const inject = ['tools', 'vaspflowTools'];

export function apply(ctx) {
  ctx.vaspflowTools.register(ctx);
}
