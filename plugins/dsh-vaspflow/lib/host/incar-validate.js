// INCAR 校验工具：按任务类型检查必需/禁用标签与常见组合矛盾。
// 纯文本输入，不依赖文件系统，因此无 fs 服务需求。
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
  // VASP INCAR 允许同一行多个 tag = value，分号分隔（如 EDIFF = 1E-5; EDIFFG = -0.02）。
  // 先按 ; 拆分子句，再对每子句提取 tag；= 两侧空格可有可无（\\s*）。
  const tags = {};
  const warnings = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const segments = rawLine.split(';');
    let assignsInLine = 0;
    for (const segment of segments) {
      const m = TAG_PATTERN.exec(segment);
      if (!m) continue;
      assignsInLine += 1;
      const key = m[1];
      const value = m[2].trim();
      if (Object.prototype.hasOwnProperty.call(tags, key)) {
        warnings.push('tag 重复定义: ' + key + '（先 ' + tags[key] + '，后 ' + value + '）');
      }
      tags[key] = value;
    }
    if (assignsInLine > 1) {
      warnings.push('同一行多个赋值（分号分隔）: ' + rawLine.trim());
    }
  }
  return { tags, warnings };
}

function validateIncar(text, jobType) {
  const { tags, warnings } = parseTags(text);
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
  return { ok: issues.length === 0, issues, tags: Object.entries(tags).map(([k, v]) => ({ key: k, value: v })), warnings };
}

export function registerIncarValidate(ctx) {
  ctx.tools.register({
    name: "vasp_incar_validate",
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
          warnings: { type: "array", items: { type: "string" } },
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
        required: ["ok", "issues", "tags", "warnings"]
      },
      render: (_args, value) => {
        const warningText = value.warnings && value.warnings.length > 0 ? '\n警告:\n' + value.warnings.join('\n') : '';
        return [{
          type: "text",
          text: value.ok
            ? 'INCAR 校验通过（解析到 ' + value.tags.length + ' 个标签' + (value.warnings && value.warnings.length > 0 ? '，' + value.warnings.length + ' 条警告' : '') + '）' + warningText
            : 'INCAR 校验失败（' + value.issues.length + ' 个问题）：\n' + value.issues.join('\n') + warningText
        }];
      }
    },
    execute(args) {
      const result = validateIncar(args.incarText, args.jobType ?? undefined);
      return Promise.resolve(result);
    },
    presentCall: (args) => ({ card: "generic", title: "Validate INCAR", kind: "other", rawInput: args })
  });
}

