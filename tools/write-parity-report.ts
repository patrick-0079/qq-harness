import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)),
  read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const inventory = read('doc/parity-inventory.json'),
  cell = (v: unknown) =>
    String(v ?? '')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');
const evidence = (id: string) => [
  'tests/core-tools-parity.test.ts',
  ...(['send_message', 'finish'].includes(id) ? ['tests/messaging-parity.test.ts'] : []),
  ...(['web_search', 'web_fetch', 'get_message_images', 'read_forward'].includes(id)
    ? ['tests/capability-recovery.test.ts']
    : []),
  ...(id === 'read_video' ? ['tests/video-route-parity.test.ts'] : []),
];
const live = new Set(['web_search', 'web_fetch', 'get_message_images', 'read_forward']);
const gaps: Record<string, string> = {
  read_video: '四模式选路与元信息回退已对照旧纯函数；转码与 FFmpeg 实机仍待验收',
  get_message_images: '静态图片及转发图片已实测；GIF 转视频策略待对齐',
  send_image: '静态预览与限额已测；GIF、旧压缩及备用发送策略待对齐',
  list_reminders: '结构化新返回值已测，旧文本显示字段继续核对',
};
const builtins = inventory.builtins.map((t: any) => ({
  id: t.id,
  source: `${t.file}:${t.sourceLine}`,
  status: gaps[t.id] ? 'partial-parity' : 'implemented-tested',
  remaining: gaps[t.id] ?? '全部扩展的跨工具工作流仍待完成',
  evidence: evidence(t.id),
  liveVerified: live.has(t.id),
  productionCodeDeployed: true,
}));
const preview = fs
    .readdirSync(path.join(root, 'var'))
    .filter((n) => /^extension-preview-\d+$/.test(n))
    .sort()
    .at(-1),
  compiled = preview ? read(`var/${preview}/migration-preview.json`).rows : [];
const compileCounts = compiled.reduce(
  (out: Record<string, number>, row: any) => ((out[row.status] = (out[row.status] ?? 0) + 1), out),
  {},
);
const flows = new Set([
  'ccb-command',
  'auto-finish',
  'at-mention',
  'member-aliases',
  'ai-status',
  'usage-report',
  'self-avatar',
  'quote-target',
  'quote-reply',
  'detailed-thinking',
  'owner-identity',
  'scheduled-task',
  'typing-indicator',
  'msg-reaction',
  'hell-joke',
  'stamina',
  'qianyeyue-affinity',
  'sticker-cap',
  'self-surf',
  'net-proxy',
  'long-memory',
]);
const loading = fs.existsSync(path.join(root, 'doc/package-loading-audit-20261027.json'))
  ? read('doc/package-loading-audit-20261027.json').rows
  : [];
const nativeCount = read('doc/plugin-dependencies.json').length;
const packages = inventory.packages.map((p: any) => ({
  id: p.id,
  source: p.source,
  status: ['image-studio', 'cross-memory', 'cross-group-memory'].includes(p.id)
    ? 'native-port-tested'
    : flows.has(p.id)
      ? 'partial-flow-tested'
      : 'pending',
  compileStatus: compiled.find((r: any) => r.id === p.id)?.status ?? 'not-compiled',
  evidence: ['cross-memory', 'cross-group-memory'].includes(p.id)
    ? ['tests/memory.test.ts', 'tests/memory-consolidation.test.ts']
    : p.id === 'net-proxy'
      ? ['tests/proxy-migration.test.ts']
      : ['hell-joke', 'stamina', 'qianyeyue-affinity', 'sticker-cap', 'self-surf', 'long-memory'].includes(
            p.id,
          )
        ? ['tests/sender-migration.test.ts']
        : p.id === 'image-studio'
          ? ['tests/image-studio-parity.test.ts', 'tests/native-media-migration.test.ts']
          : p.id === 'ai-status'
            ? ['tests/html-renderer.test.ts']
            : ['typing-indicator', 'msg-reaction'].includes(p.id)
              ? ['tests/protocol-extensions-parity.test.ts']
              : p.id === 'scheduled-task'
                ? ['tests/scheduled-task-parity.test.ts']
                : flows.has(p.id)
                  ? ['tests/capsule-migration.test.ts']
                  : [],
  productionVerified: false,
  loadingAudit: loading.find((row: any) => row.id === p.id) ?? null,
}));
fs.writeFileSync(
  path.join(root, 'doc/parity-evidence.json'),
  JSON.stringify(
    {
      version: 2,
      scope: '全部旧功能；三层记忆为确认后的替代实现',
      builtins,
      packages,
      coreModules: inventory.coreModules.map((m: any) => ({ file: m.file, status: 'pending-crosscheck' })),
      routes: inventory.routes.map((r: any) => ({ ...r, status: 'pending-behavior-mapping' })),
    },
    null,
    2,
  ) + '\n',
);
const table = (headers: string[], rows: unknown[][]) => [
  '| ' + headers.join(' | ') + ' |',
  '|' + headers.map(() => '---').join('|') + '|',
  ...rows.map((row) => '| ' + row.map(cell).join(' | ') + ' |'),
];
const lines = [
  '# 全量功能对齐验收矩阵',
  '',
  '上轮独立业务排除项已经失效。全部旧功能都在本轮范围内，当前尚未完成全量对齐。注册、编译、加载、行为验证和正式数据迁移分别记录。',
  '',
  '## 基准与当前状态',
  '',
  `${inventory.counts.coreModules} 个核心源码模块、${inventory.counts.routes} 条静态路由、29 个核心工具、101 个扩展包（69 插件、32 技能目录项，包含停用包）。部分旧源码为检查脚本，仍保留以核实入口可达性。`,
  '',
  '来源 SHA、参数声明、模块导入、hooks、providers、UI 函数见 [机器清单](parity-inventory.json)。逐项状态见 [JSON 矩阵](parity-evidence.json)。',
  '',
  '本轮已部署原生工具、媒体、轨迹与界面修复；搜索、网页、真实入站图片、嵌套转发及引用追踪已完成授权联调。**这不代表 101 个旧包已经全部迁移。** 见 [能力修复与实测](capability-recovery-20261027.md)。',
  '',
  '## 核心工具',
  '',
  ...table(
    ['工具', '旧入口', '状态／差异', '测试', '真实联调'],
    builtins.map((r: any) => [
      r.id,
      r.source,
      gaps[r.id] ?? '核心实现已测；全部扩展联动待完成',
      r.evidence.map((f: string) => `[${path.basename(f)}](../${f})`).join('、'),
      r.liveVerified ? '已通过' : 'mock 验证',
    ]),
  ),
  '',
  '## 会话配置',
  '',
  '四渠道概率、关键词、峰谷、未读、历史、锚点、模型／备选、超时0、追问与重试、活跃期不续期、上下线及软禁言已有实现和测试。全部字段的正式迁移仍需继续完成；本次能力修复没有覆盖用户现有会话策略。人设动态分段、辅助模型配额、旧会话管理剩余操作及表情库数据尚需逐项核实。三层记忆规则是已确认的新实现。',
  '',
  '## 全部旧扩展',
  '',
  `独立编译预览：${compileCounts['compiled-not-behavior-verified'] ?? 0} 个包可生成入口，${compileCounts['needs-adapter'] ?? 0} 个包仍需宿主适配；image-studio、cross-memory、cross-group-memory 使用原生能力替代。编译数不计作功能完成数。安装器保留原有启停与设置，未启用包延迟加载；实际正式安装、数据迁移与版本快照见 [当前状态](status.md)。`,
  '',
  'CCB、auto-finish、at-mention、member-aliases、ai-status、usage-report 已有旧原包的局部工作流测试；这不包含它们的全部定时、跨会话推送和数据迁移。状态卡通过独立渲染服务发图，历史未知计费明确显示不可用。',
  '',
  '新增 self-avatar、quote-target、quote-reply、detailed-thinking、owner-identity 和 scheduled-task 局部工作流。全量加载检查见 [101包审计](package-loading-audit-20261027.md)；98个可加载包仍需补齐全部业务分支验收。定时任务接公开唤醒服务，每个运行独立保留任务说明，不修改旧宿主。',
  '',
  'typing-indicator 与 msg-reaction 已增加旧原包协议工作流，辅助模型进入独立操作并记录用量。hell-joke、stamina、qianyeyue-affinity、sticker-cap、self-surf、net-proxy 和 long-memory 增加原包工作流测试；long-memory 工具直接使用原生三层记忆，跨会话旧记忆能力由统一可见性与整理服务替代。',
  '',
  ...table(
    ['包', '名称', '状态', '编译预览', '设置字段数'],
    inventory.packages.map((p: any) => {
      const row = packages.find((r: any) => r.id === p.id);
      return [p.id, p.name, row.status, row.compileStatus, p.settingsFields.length];
    }),
  ),
  '',
  '## 核心模块逐项追踪',
  '',
  '这些模块还必须核实可达入口、实际调用和替代方案，不能以工具测试覆盖它们。',
  '',
  ...table(
    ['旧模块', '状态'],
    inventory.coreModules.map((m: any) => [m.file, '待逐项对照']),
  ),
  '',
  '## 全部旧路由与管理操作',
  '',
  '允许采用统一的新 API，但必须记录替代位置并验证操作。明文密钥读取由集中凭据管理与脱敏替代，不恢复密钥泄露接口。',
  '',
  ...table(
    ['方法', '旧路由', '来源', '状态'],
    inventory.routes.map((r: any) => [r.method, r.pattern, `${r.file}:${r.sourceLine}`, '待行为映射／验收']),
  ),
  '',
  '## 未通过的交付关卡',
  '',
  '- 101 包的逐项行为、启停、配置、必要数据和生命周期迁移。',
  '- 66 核心源模块、105 路由、旧 UI 操作及全部会话字段逐项对照。',
  '- 独立数据副本的完整迁移和回滚，之后再升级其余正式业务配置。',
  '- 后续改动须重跑相应测试，当前记录不能替代后续验收。',
  '',
];
fs.writeFileSync(path.join(root, 'doc/parity-matrix.md'), lines.join('\n'));
const dependencies = [
  '# 旧插件与技能依赖检查表',
  '',
  `覆盖全部发现包；其中维护脚本需进一步确认可达性。不加载旧单体宿主。原生插件服务依赖另见 [${nativeCount} 项依赖清单](plugin-dependencies.md)。`,
  '',
  ...table(
    ['包', '入口', '旧私有依赖', 'hooks／能力'],
    inventory.packages.map((p: any) => [
      p.id,
      p.entry,
      [...new Set<string>(p.files.flatMap((f: any) => f.imports ?? []))]
        .filter((i) => /src\/|plugins\/|skills\/|file:\/\//.test(i))
        .join('、') || '未发现旧私有模块导入',
      [...new Set<string>(p.files.flatMap((f: any) => [...(f.hooks ?? []), ...(f.providers ?? [])]))].join(
        '、',
      ) || '见清单',
    ]),
  ),
  '',
];
fs.writeFileSync(path.join(root, 'doc/legacy-plugin-dependencies.md'), dependencies.join('\n'));
console.log('已生成 29 工具、66 核心模块、105 路由、101 包的逐项状态；未验收项保留 pending。');
