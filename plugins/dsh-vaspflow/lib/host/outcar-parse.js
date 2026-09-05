// OUTCAR 解析工具：对 OUTCAR 文本做确定性解析，返回收敛状态、
// 最新总能、离子步数与检测到的 VASP 错误签名。
// 纯文本输入，不依赖文件系统，因此无 fs 服务需求。
const CONVERGED = /reached required accuracy/;                    // 离子步收敛标志
const ERRORS = [/\bZBRENT\b/, /\bEDDDAV\b/, /TOO FEW BANDS/, /\bEDWAV\b/];
const ENERGY = /free  energy\s+\(TOTEN\)\s*=\s*([-\d.]+)/g;       // 最后匹配 = 最新总能
const FORCE = /total drift:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/; // 受力漂移（可选）
const IONIC_STEP = /^\s*(\d+)\s+F=\s*([-\d.]+)\s*E0=\s*([-\d.]+)/gm; // 离子步头行

function parseOutcar(text) {
  const errors = [];
  for (const re of ERRORS) {
    if (re.test(text)) errors.push(re.source.replace(/\\b/g, "").trim());
  }
  const converged = CONVERGED.test(text);
  let energy = null;
  let m;
  ENERGY.lastIndex = 0;
  while ((m = ENERGY.exec(text)) !== null) energy = Number(m[1]);
  const drift = FORCE.exec(text);
  let lastIonicStep = null;
  IONIC_STEP.lastIndex = 0;
  while ((m = IONIC_STEP.exec(text)) !== null) lastIonicStep = Number(m[1]);
  return {
    ok: errors.length === 0,
    converged,
    energy,
    errors,
    lastIonicStep,
    drift: drift ? { x: Number(drift[1]), y: Number(drift[2]), z: Number(drift[3]) } : null,
  };
}

export function registerOutcarParse(ctx) {
  ctx.tools.register({
    name: "vasp_outcar_parse",
    description: "解析 VASP OUTCAR 文本：返回是否收敛、最新总能（eV）、最后离子步号、检测到的错误签名（ZBRENT/EDDDAV/TOO FEW BANDS/EDWAV）与受力漂移。分析计算结果、判断计算是否成功时调用。",
    parameters: {
      type: "object",
      properties: {
        outcarText: { type: "string", description: "OUTCAR 文件全文文本（可截断到关键区段）。" }
      },
      required: ["outcarText"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
          converged: { type: "boolean" },
          energy: { type: "number" },
          errors: { type: "array", items: { type: "string" } },
          lastIonicStep: { type: "number" },
          drift: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" }
            }
          }
        },
        required: ["ok", "converged", "errors"]
      },
      render: (_args, value) => {
        const parts = [];
        if (value.converged) {
          parts.push(`离子步 ${value.lastIonicStep ?? "?"} 收敛`);
        } else {
          parts.push("未检测到收敛标志（reached required accuracy）");
        }
        if (value.energy !== null && value.energy !== undefined) {
          parts.push(`E = ${value.energy.toFixed(6)} eV`);
        }
        if (value.errors.length > 0) {
          parts.push(`检测到错误签名: ${value.errors.join(", ")}`);
        } else {
          parts.push("未检测到常见错误签名");
        }
        if (value.drift) {
          parts.push(`total drift = (${value.drift.x.toFixed(4)}, ${value.drift.y.toFixed(4)}, ${value.drift.z.toFixed(4)})`);
        }
        return [{ type: "text", text: parts.join("；") }];
      }
    },
    execute(args) {
      return Promise.resolve(parseOutcar(args.outcarText));
    },
    presentCall: (args) => ({ card: "generic", title: "Parse OUTCAR", kind: "other", rawInput: args })
  });
}
