import { convertLegacySession } from './legacy-session.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { configSchema, chatKeySchema, type HarnessConfig } from '@qq-harness/contracts';
import { deepMerge } from '@qq-harness/files';

type RecordValue = Record<string, any>;
type Profile = { key: string; config: RecordValue };
type Persona = { name: string; text: string };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../', import.meta.url));
const isInside = (parent: string, file: string) => {
  const rel = path.relative(parent, file);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
};
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const secret = (value: unknown) => (string(value).trim() === '******' ? '' : string(value).trim());

// 仅解析字面量数据，不 import/eval 旧项目，避免配置模块的迁移和持久化副作用。
function literal(node: RecordValue): unknown {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'ObjectExpression')
    return Object.fromEntries(
      node.properties.map((property: RecordValue) => {
        if (
          property.type !== 'Property' ||
          property.kind !== 'init' ||
          property.computed ||
          property.method ||
          property.shorthand ||
          !['Identifier', 'Literal'].includes(property.key.type)
        )
          throw new Error('旧人设库包含非字面量字段，需人工迁移');
        const name = property.key.name ?? property.key.value;
        if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('人设字段无效');
        return [name, literal(property.value)];
      }),
    );
  throw new Error('旧人设库包含可执行表达式，拒绝执行');
}
export function readBuiltinPersonas(source: string): Record<string, Persona> {
  const ast = parseAst(source);
  for (const node of ast.body) {
    const statement = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (statement?.type === 'VariableDeclaration')
      for (const declaration of statement.declarations)
        if (declaration.id.type === 'Identifier' && declaration.id.name === 'PERSONAS' && declaration.init)
          return literal(declaration.init) as Record<string, Persona>;
  }
  throw new Error('没有找到旧内置人设数据');
}
export function readBuiltinPrompt(source: string): string {
  const names = [
    'securityRules',
    'antiAiFlavor',
    'subjectivity',
    'notAQueue',
    'humanRhythm',
    'notModerator',
    'reportBan',
  ];
  const ast = parseAst(source);
  return names
    .map((name) => {
      const fn = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === name) as
        RecordValue | undefined;
      const returned = fn?.body.body.find((node: RecordValue) => node.type === 'ReturnStatement')?.argument;
      if (
        !returned ||
        returned.type !== 'CallExpression' ||
        returned.callee.type !== 'MemberExpression' ||
        returned.callee.property.name !== 'join' ||
        returned.callee.object.type !== 'ArrayExpression'
      )
        throw new Error('旧内置提示词结构变化，请重新核对迁移规则');
      return returned.callee.object.elements.map((element: RecordValue) => literal(element)).join('\n');
    })
    .join('\n\n');
}
const participation: Record<string, string> = {
  low: '安静型：主要在被点名、直接提问或确有想说的内容时简短回应。',
  medium: '普通群友：能接的话题就接，插不上就安静看；不抢话也不故意隐身。',
  high: '活跃型：能接的话题尽量接，保持选择性，不刷屏。',
};
const protocol = `【当前 Harness 工具约定，以实际提供的工具 schema 为准】
文本输出不会发送到 QQ；发言调用 send_message({"messages":["正文","下一条"]})，messages 必须为字符串数组。
结束调用 finish({"mode":"spoken或silent","silentReason":"不发言的原因"})；只有成功发送后才可使用 spoken。
mode=spoken 可省略 silentReason；mode=silent 必填 silentReason。activeTopic 控制活跃期。只调用当前工具列表中存在的工具。
只操作当前会话，不泄露密钥和内部配置，不声称完成尚未成功的工具操作。`;

export function convertSettings(
  legacy: RecordValue,
  profiles: Profile[],
  builtin: Record<string, Persona>,
  builtinPrompt: string,
) {
  const personas = new Map(Object.entries(builtin));
  for (const entry of legacy.customPersonas ?? []) {
    if (!string(entry.id) || !string(entry.text)) throw new Error('自定义人设缺少 ID 或正文');
    personas.set(entry.id, { name: string(entry.name), text: entry.text });
  }
  const promptItems: RecordValue[] = legacy.prompts?.items ?? [];
  const selectedProvider = (legacy.providers ?? []).find(
    (entry: RecordValue) => entry.id === legacy.api?.provider,
  );
  const model = {
    baseUrl: string(selectedProvider?.baseURL) || string(legacy.api?.baseUrl),
    model: string(legacy.api?.model),
    apiKey:
      secret(legacy.dshProviderKeys?.[legacy.api?.provider]) ||
      secret(selectedProvider?.apiKey) ||
      secret(legacy.api?.apiKey),
    timeoutMs: legacy.api?.timeoutMs ?? 180000,
  };
  if (!model.baseUrl || !model.model || !model.apiKey) throw new Error('当前渠道缺少端点、模型或有效凭据');
  const bindings: RecordValue[] = [];
  const render = (value: RecordValue, scope: string) => {
    const p = { ...legacy.persona, ...value.persona };
    const personaId = string(p.personaId) || string(legacy.persona?.personaId);
    const card = personas.get(personaId);
    if (!card) throw new Error('有生效人设引用无法解析，未写入目标');
    const picked =
      promptItems.find((entry) => entry.id === p.promptId && string(entry.content).trim()) ??
      promptItems.find((entry) => entry.id === legacy.prompts?.defaultId && string(entry.content).trim());
    const style = participation[string(p.participation)] ?? participation.medium!;
    const rendered = picked
      ? string(picked.content)
          .replaceAll('{botName}', string(p.botName))
          .replaceAll('{roleText}', card.text)
          .replaceAll('{participation}', style)
      : `${builtinPrompt}\n\n参与风格：${style}`;
    // 角色正文保持逐字快照；库提示词可不包含 roleText 占位符，仍显式保留人设。
    const text = [
      `角色名称：${string(p.botName) || card.name}`,
      p.selfNickname ? `显示昵称：${string(p.selfNickname)}` : '',
      card.text,
      rendered,
      string(p.customRules),
      protocol,
    ]
      .filter(Boolean)
      .join('\n\n');
    bindings.push({
      scope,
      personaId,
      promptId: picked?.id ?? 'builtin-compatible',
      roleSha256: hash(card.text),
      renderedSha256: hash(text),
    });
    return text;
  };
  const snapshot = (effective: RecordValue, scope: string) => ({
    online: effective.availability?.online !== false,
    trigger: 'mention',
    wakeDelayMs: legacy.wakeDelayMs ?? 2000,
    drainDelayMs: legacy.drainDelayMs ?? 1200,
    runTimeoutMs: effective.run?.timeoutMs || 3600000,
    maxRounds: effective.api?.maxRounds ?? legacy.api?.maxRounds ?? 12,
    persona: render(effective, scope),
    plugins: { 'agent-memory': true },
    ...convertLegacySession(effective,legacy,scope),
  });
  const mapped: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const profile of profiles) {
    chatKeySchema.parse(profile.key);
    if (seen.has(profile.key)) throw new Error('会话配置重复，拒绝静默覆盖');
    seen.add(profile.key);
    const effective = deepMerge(legacy, profile.config) as RecordValue;
    mapped[profile.key] = snapshot(effective, profile.key);
  }
  const admissions = [...new Set([...Object.keys(legacy.chatProfiles ?? {}), ...seen])];
  const parsed = configSchema.safeParse({
    personas:[...personas].map(([id,value])=>({id,name:value.name||id,text:value.text})),
    prompts:[...promptItems.filter(p=>p.id).map(p=>({id:String(p.id),name:String(p.name||p.title||p.id),text:string(p.content)})),{id:'builtin-compatible',name:'旧版内置提示词',text:builtinPrompt}],
    providers:(legacy.providers??[]).filter((p:RecordValue)=>p.id&&(p.baseURL||p.baseUrl)).map((p:RecordValue)=>({id:String(p.id),name:string(p.displayName)||string(p.name)||String(p.id),baseUrl:string(p.baseURL)||string(p.baseUrl),apiKey:secret(legacy.dshProviderKeys?.[p.id])||secret(p.apiKey)||(p.id===legacy.api?.provider?model.apiKey:''),currency:string(p.currency)||'USD',models:(p.models??[]).map((m:unknown)=>typeof m==='string'?m:string((m as RecordValue)?.id)).filter(Boolean),priceInputPerM:p.priceInputPerM??null,priceOutputPerM:p.priceOutputPerM??null})),
    legacyGlobal: structuredClone(legacy),
    acceptAllSessions: legacy.acceptAllSessions === true,
    admissions,
    deniedChats: [
      ...(legacy.deny?.groups ?? []).map((id: unknown) => `group:${id}`),
      ...(legacy.deny?.private ?? []).map((id: unknown) => `private:${id}`),
    ],
    deniedUsers: (legacy.globalBlocklist ?? []).map(String),
    defaults: snapshot(legacy, 'default'),
    profiles: mapped,
    model,
    onebot: {
      wsUrl: legacy.snowluma?.wsUrl,
      httpUrl: legacy.snowluma?.httpUrl,
      accessToken: secret(legacy.snowluma?.accessToken),
      httpAccessToken: secret(legacy.snowluma?.httpAccessToken),
    },
    send: {
      minIntervalMs: legacy.send?.minGapMs ?? 1000,
      dedupeMs: legacy.send?.dedupeWindowMs ?? 8000,
      perMinute: legacy.send?.maxPerMinute ?? 20,
      maxIntervalMs:legacy.send?.maxGapMs??3000,
      byLengthMs:legacy.send?.byLengthMs??20,
      perHour:legacy.send?.maxPerHour??500,
      hardSplitAt:legacy.send?.hardSplitAt??4000,
    },
    plugins: {
      'command-direct': false,
      reminders: true,
      'external-plugins': false,
      'ext-tool': false,
      'ext-mcp': false,
      'ext-skill': false,
      'ext-knowledge': false,
      'ext-promptinject': false,
    },
  });
  if (!parsed.success)
    throw new Error(`目标配置校验失败（${parsed.error.issues.length} 个字段）；未写入目标`);
  return {
    config: parsed.data,
    catalog: {
      customPersonas: legacy.customPersonas ?? [],
      builtinPersonas: builtin,
      prompts: legacy.prompts ?? {},
      providers: legacy.providers ?? [],
      providerKeys: legacy.dshProviderKeys ?? {},
      sourceApi: legacy.api,
      sourceSnowluma: legacy.snowluma,
      defaultPersona: legacy.persona,
      bindings,
      profileSelections: profiles.map((profile) => ({
        key: profile.key,
        persona: profile.config.persona,
        api: profile.config.api,
        store: profile.config.store,
      })),
      builtinCompatiblePrompt: builtinPrompt,
    },
    summary: {
      customPersonas: (legacy.customPersonas ?? []).length,
      builtinPersonas: Object.keys(builtin).length,
      customPrompts: promptItems.length,
      providers: (legacy.providers ?? []).length,
      profiles: profiles.length,
      admissions: admissions.length,
      blockedUsers: parsed.data.deniedUsers.length,
      hasModelCredential: Boolean(model.apiKey),
      hasWsToken: Boolean(parsed.data.onebot.accessToken),
      hasHttpToken: Boolean(parsed.data.onebot.httpAccessToken),
      acceptAllSessions: parsed.data.acceptAllSessions,
      trigger: 'legacy-four-channel',
      backgroundAndExtensions: '会话策略已完整映射，旧扩展需按迁移清单逐项验收',
    },
  };
}

export function migrateSettings(sourceRoot: string, destination: string, apply = false) {
  if (!path.isAbsolute(sourceRoot) || !path.isAbsolute(destination))
    throw new Error('来源和目标必须使用绝对路径');
  sourceRoot = fs.realpathSync(sourceRoot);
  destination = path.resolve(destination);
  if (
    !isInside(path.join(root, 'var'), destination) ||
    destination === path.join(root, 'var') ||
    isInside(sourceRoot, destination)
  )
    throw new Error('迁移目标必须是新工程 var 下的独立目录');
  if (fs.existsSync(destination)) throw new Error('目标已存在，拒绝覆盖；请选择新目录');
  const captured = new Map<string, Buffer>();
  const read = (relative: string) => {
    const file = path.join(sourceRoot, relative);
    const bytes = fs.readFileSync(file);
    captured.set(relative, bytes);
    return bytes.toString('utf8').replace(/^\uFEFF/, '');
  };
  const legacy = JSON.parse(read('data/config.json'));
  const profiles: Profile[] = fs
    .readdirSync(path.join(sourceRoot, 'data/chat-configs'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const raw = JSON.parse(read(`data/chat-configs/${name}`));
      return { key: raw.key, config: raw.config ?? {} };
    });
  const builtin = readBuiltinPersonas(read('src/personas.js'));
  const promptSource = read('src/prompt.js');
  const result = convertSettings(legacy, profiles, builtin, readBuiltinPrompt(promptSource));
  const digests = [...captured].map(([file, bytes]) => ({ file, sha256: hash(bytes) }));
  const report = { ...result.summary, inputFiles: captured.size, applied: apply };
  if (!apply) return report;
  for (const [file, bytes] of captured)
    if (hash(fs.readFileSync(path.join(sourceRoot, file))) !== hash(bytes))
      throw new Error('读取期间来源配置发生变化，请重新迁移');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = destination + '.preparing-' + randomUUID();
  fs.mkdirSync(path.join(staging, 'migration'), { recursive: true });
  const write = (file: string, value: unknown) =>
    fs.writeFileSync(path.join(staging, file), JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  write('config.json', result.config);
  write('migration/catalog.json', result.catalog);
  write('migration/receipt.json', { at: new Date().toISOString(), report, digests });
  fs.writeFileSync(path.join(staging, 'migration/legacy-prompt-source.txt'), promptSource, {
    flag: 'wx',
    mode: 0o600,
  });
  // 生产按添加会话/独立配置准入；allowedChats 仅用于显式测试启动边界。
  write('launch.json', {
    port: 3310,
    concurrency: legacy.maxConcurrentRuns ?? 2,
    token: randomBytes(32).toString('hex'),
    snowlumaDirectory: string(legacy.snowluma?.dir) || path.join(sourceRoot, 'snowluma'),
  });
  fs.renameSync(staging, destination);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const source = args.find((value) => value.startsWith('--source='))?.slice(9);
    const target = args.find((value) => value.startsWith('--target='))?.slice(9);
    if (!source || !target)
      throw new Error('用法：--source=旧项目绝对目录 --target=新工程var下的新目录 [--apply]');
    console.log(JSON.stringify(migrateSettings(source, target, args.includes('--apply')), null, 2));
  } catch (error) {
    console.error(
      error instanceof SyntaxError
        ? '来源 JSON 无法解析'
        : error instanceof Error
          ? error.message
          : '配置迁移失败',
    );
    process.exitCode = 1;
  }
}
