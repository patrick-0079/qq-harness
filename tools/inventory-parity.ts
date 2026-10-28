import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'rolldown/utils';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const files = (root: string): string[] =>
  !fs.existsSync(root)
    ? []
    : fs
        .readdirSync(root, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory() && !['node_modules', '.git', 'data'].includes(entry.name)
            ? files(path.join(root, entry.name))
            : entry.isFile() && /\.(?:m?js|json)$/.test(entry.name)
              ? [path.join(root, entry.name)]
              : [],
        );
type AstNode = { type: string; start?: number; end?: number; [key: string]: any };
const name = (node: AstNode | undefined): string =>
  node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? String(node.value) : '';
function inspect(file: string) {
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseSync(file, source);
  if (parsed.errors.length)
    return {
      sha256: hash(source),
      imports: [],
      hooks: [],
      tools: [],
      parseErrors: parsed.errors.map((e) => e.message),
    };
  const imports = new Set<string>(),
    hooks = new Set<string>();
  const tools: { id: string; parameters: string; sourceLine: number;metadata:Record<string,unknown> }[] = [];
  const routes: { method: string; pattern: string; sourceLine: number }[] = [];
  const exports: string[] = [];
  const providers=new Set<string>(),functions=new Set<string>();
  const bindings:{module:string;names:string[];dynamic:boolean}[]=[];
  const visit = (node: AstNode) => {
    if(node.type==='FunctionDeclaration'&&node.id)functions.add(name(node.id));
    if(node.type==='VariableDeclarator'){
      if(['FunctionExpression','ArrowFunctionExpression'].includes(node.init?.type))functions.add(name(node.id));
      if(['hooks','providers','capabilities'].includes(name(node.id))&&node.init?.type==='ObjectExpression')for(const property of node.init.properties??[]){const key=name(property.key);if(key)(name(node.id)==='hooks'?hooks:providers).add(key);}
    }
    if (node.type === 'ObjectExpression') {
      const props: AstNode[] = node.properties ?? [];
      const method = props.find((p) => name(p.key) === 'method')?.value;
      const pattern = props.find((p) => name(p.key) === 'pattern')?.value;
      if (method && pattern)
        routes.push({
          method: name(method),
          pattern: source.slice(pattern.start, pattern.end),
          sourceLine: source.slice(0, node.start).split('\n').length,
        });
    }
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const d = node.declaration;
      if (d.id) exports.push(name(d.id));
      for (const v of d.declarations ?? []) if (v.id?.type === 'Identifier') exports.push(v.id.name);
    }
    if (node.type === 'ImportDeclaration') {imports.add(name(node.source));bindings.push({module:name(node.source),names:(node.specifiers??[]).map((s:AstNode)=>name(s.imported)||s.type==='ImportDefaultSpecifier'&&'default'||'*'),dynamic:false});}
    if (node.type === 'ImportExpression' && node.source?.type === 'Literal') {imports.add(name(node.source));bindings.push({module:name(node.source),names:['*'],dynamic:true});}
    if (node.type === 'CallExpression') {
      const called =
        node.callee?.type === 'MemberExpression' ? name(node.callee.property) : name(node.callee);
      if (/^(?:registerTool|register|tool)$/.test(called)) {
        const object = node.arguments.find((v: AstNode) => v.type === 'ObjectExpression');
        const props: AstNode[] = object?.properties ?? [];
        const id = props.find((p) => ['id', 'name'].includes(name(p.key)) && p.value?.type === 'Literal');
        const parameters = props.find((p) => ['parameters', 'inputSchema'].includes(name(p.key)))?.value;
        if (id)
          tools.push({
            id: name(id.value),
            parameters: parameters ? source.slice(parameters.start, parameters.end) : '',
            sourceLine: source.slice(0, node.start).split('\n').length,
            metadata:Object.fromEntries(props.filter(p=>['name','category','core','requiresVision','requiresSearch','requiresVideo','defaultEnabled'].includes(name(p.key))&&p.value?.type==='Literal').map(p=>[name(p.key),p.value.value])),
          });
      }
      if (/hook|provider|capability/i.test(called) && node.arguments[0]?.type === 'Literal')
        hooks.add(name(node.arguments[0]));
      if(['get','post','put','patch','delete','route'].includes(called)&&node.arguments[0]?.type==='Literal'&&String(node.arguments[0].value).startsWith('/'))routes.push({method:called.toUpperCase(),pattern:JSON.stringify(node.arguments[0].value),sourceLine:source.slice(0,node.start).split('\n').length});
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value))
        for (const child of value) {
          if (child?.type) visit(child);
        }
      else if (value && typeof value === 'object' && value.type) visit(value as AstNode);
    }
  };
  visit(parsed.program as unknown as AstNode);
  return {
    sha256: hash(source),
    imports: [...imports].sort(),
    hooks: [...hooks].sort(),
    tools,
    routes,
    exports,
    providers:[...providers].sort(),functions:[...functions].sort(),bindings,
  };
}
export function inventoryParity(sourceRoot: string) {
  const root = fs.realpathSync(sourceRoot);
  const relative = (file: string) => path.relative(root, file).replaceAll('\\', '/');
  const builtinFiles = files(path.join(root, 'src')).filter((f) => f.endsWith('.js'));
  const coreModules = builtinFiles.map((file) => ({ file: relative(file), ...inspect(file) }));
  const builtins = coreModules.flatMap(({ file, tools }) => tools.map((tool) => ({ ...tool, file })));
  const packages = [
    'plugins',
    'skills',
    'tools',
    'mcp',
    'knowledge',
    'promptinjects',
    'chat-plugins',
  ].flatMap((directory) => {
    const dir = path.join(root, directory);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const folder = path.join(dir, entry.name);
        const manifest = ['plugin.json', 'skill.json', 'tool.json', 'mcp.json', 'manifest.json']
          .map((name) => path.join(folder, name))
          .find(fs.existsSync);
        if (!manifest) return [];
        const meta = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, unknown>;
        const inspected = files(folder)
          .filter((file) => /\.m?js$/.test(file))
          .map((file) => ({ file: relative(file), ...inspect(file) }));
        return [
          {
            id: String(meta.id ?? entry.name),
            name: String(meta.name ?? entry.name),
            type: directory,
            source: relative(folder),
            manifestSha256: hash(fs.readFileSync(manifest)),
            defaultEnabled: meta.enabledByDefault !== false,
            settingsFields: Object.keys((meta.configSchema ?? {}) as object),
            entry:String(meta.entry??'index.js'),scope:meta.scope??null,permissions:meta.permissions??[],provided:meta.provides??[],
            files: inspected,
            status: 'pending' as const,
            tests: [] as string[],
          },
        ];
      });
  });
  return {
    version: 1,
    source: 'backup/source',
    coreModules,
    routes: coreModules.flatMap(({ file, routes }) => (routes ?? []).map((route) => ({ ...route, file }))),
    ui: files(path.join(root, 'ui'))
      .filter((file) => /app[\\/].*\.js$/.test(file))
      .map((file) => ({
        file: relative(file),
        sha256: hash(fs.readFileSync(file)),
        functions: [...fs.readFileSync(file, 'utf8').matchAll(/(?:async\s+)?function\s+(\w+)\(/g)].map(
          (m) => m[1],
        ),
      })),
    builtins,
    packages,
    counts: {
      builtinDeclarations: builtins.length,
      coreModules:coreModules.length,routes:coreModules.reduce((sum,item)=>sum+(item.routes?.length??0),0),
      packages: packages.length,
      byType: Object.fromEntries(
        [...new Set(packages.map((p) => p.type))].map((type) => [
          type,
          packages.filter((p) => p.type === type).length,
        ]),
      ),
    },
  };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const source = process.argv.find((arg) => arg.startsWith('--source='))?.slice(9);
  if (!source || !path.isAbsolute(source)) throw new Error('需要 --source=<旧项目绝对目录>，只读旧源码');
  const result = inventoryParity(source);
  const target = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
  if (target) fs.writeFileSync(path.resolve(target), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.counts, null, 2));
}
