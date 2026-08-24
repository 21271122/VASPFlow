// INCAR 校验工具：按任务类型检查必需/禁用标签与常见组合矛盾。
// 纯文本输入，不依赖文件系统，因此无 fs 服务需求。
// 注意：预设自定义 .mjs 由 loader 以相对路径导入，文件内部 import 走 Node 原生
// 解析（用户预设根下找不到 harness 的 node_modules），因此本文件零外部依赖，
// 直接构造 ctx.tools.register 接受的 registry-ready 工具定义。

/** Cordis 插件名（loader 诊断用）。 */
export const name = "tool-incar-validate";

/** 需要的宿主服务：tools 注册表。 */
export const inject = ["tools"];

/** 各任务类型的硬性标签要求（示例规则表，按实际计算体系扩展）。 */
const JOB_RULES = {
  relax:  { required: ["IBRION", "NSW", "EDIFF", "EDIFFG", "ENCUT"], forbidden: [] },
  static: { required: ["IBRION", "NSW", "EDIFF", "ENCUT", "ISMEAR"], forbidden: [] },
  dos:    { required: ["ISMEAR", "EDIFF", "ENCUT", "LREAL"], forbidden: ["IBRION"] },
  freq:   { required: ["IBRION", "NSW", "NFREE", "POTIM", "EDIFF"], forbidden: [] },
  neb:    { required: ["IBRION", "NSW", "IMAGES", "EDIFFG", "LCLIMB"], forbidden: [] },
};

const TAG_PATTERN = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*(?:#.*)?$/;

function parseTags(text) {
  const tags = {};
  for (const line of text.split(/\r?\n/)) {
    const m = TAG_PATTERN.exec(line);
    if (m) tags[m[1]] = m[2].trim();
  }
  return tags;
}

function validateIncar(text, jobType) {
  const tags = parseTags(text);
  const issues = [];
  if (jobType) {
    const rules = JOB_RULES[jobType];
    if (!rules) {
      issues.push(`未知任务类型: ${jobType}`);
    } else {
      for (const tag of rules.required) {
        if (!(tag in tags)) issues.push(`缺少 ${jobType} 任务必需标签: ${tag}`);
      }
      for (const tag of rules.forbidden) {
        if (tag in tags) issues.push(`${jobType} 任务不应包含标签: ${tag}`);
      }
    }
  }
  // 组合矛盾检查（示例）
  if (tags.IBRION && tags.NSW && Number(tags.NSW) === 0 && Number(tags.IBRION) !== -1) {
    issues.push("NSW=0 时应配合 IBRION=-1（不进行离子弛豫）");
  }
  if (tags.EDIFFG && tags.EDIFFG.startsWith("-") && !tags.IBRION) {
    issues.push("使用力的收敛判据 EDIFFG<0 时需要 IBRION 进行离子弛豫");
  }
  return { ok: issues.length === 0, issues, tags: Object.entries(tags).map(([k, v]) => ({ key: k, value: v })) };
}

export function apply(ctx, config) {
  ctx.tools.register({
    name: "incar_validate",
    description: "校验 VASP INCAR 文本：按任务类型检查必需/禁用标签与常见组合矛盾，返回问题清单与解析出的标签表。创建或修改输入文件前调用。",
    parameters: {
      type: "object",
      properties: {
        incarText: { type: "string", description: "INCAR 文件全文文本。" },
        jobType: { type: "string", enum: ["relax", "static", "dos", "freq", "neb"], description: "任务类型；提供时按其规则表检查。" }
      },
      required: ["incarText"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
          issues: { type: "array", items: { type: "string" } },
          tags: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                value: { type: "string" }
              }
            }
          }
        },
        required: ["ok", "issues", "tags"]
      },
      render: (_args, value) => [{
        type: "text",
        text: value.ok
          ? `INCAR 校验通过（解析到 ${value.tags.length} 个标签）`
          : `INCAR 校验失败（${value.issues.length} 个问题）:\n${value.issues.join("\n")}`
      }]
    },
    execute(args) {
      const result = validateIncar(args.incarText, args.jobType ?? undefined);
      return Promise.resolve(result);
    },
    presentCall: (args) => ({ card: "generic", title: "Validate INCAR", kind: "other", rawInput: args })
  });
}
