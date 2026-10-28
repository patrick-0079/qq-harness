import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../packages/legacy-core/', import.meta.url));
for (const entry of JSON.parse(fs.readFileSync(path.join(root, 'provenance.json'), 'utf8'))) {
  if (
    createHash('sha256')
      .update(fs.readFileSync(path.join(root, entry.file)))
      .digest('hex') !== entry.sha256
  )
    throw new Error('旧工具算法来源哈希不匹配：' + entry.file);
}
const built = await build({
  stdin: {
    contents: `export * as prices from './model-prices.js';export * as util from './util.js';export * as imageSearch from './image-search.js';export * as imageHistory from './image-history.js';export * as imagePixels from './image-pixels.js';export {default as imageTags} from './image-tags.json';export * as trigger from './trigger.js';export * as session from './session-config.js';export * as silence from './silence-policy.js';export * as web from './web-search.js';export * as calendar from './holidays.js';export * as stickers from './stickers.js';export {StickerManager,localStickerPath} from './sticker-manager.js';`,
    resolveDir: path.join(root, 'vendor'),
    sourcefile: 'core-utilities.js',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  write: false,
  plugins: [
    {
      name: 'core-utility-environment',
      setup(api) {
        api.onResolve({ filter: /^\.\/config\.js$/ }, () => ({ path: 'config', namespace: 'environment' }));
        api.onResolve({ filter: /^\.\/safe-fetch\.js$/ }, () => ({
          path: 'safe-fetch',
          namespace: 'environment',
        }));
        api.onLoad({ filter: /.*/, namespace: 'environment' }, (args) => ({
          contents:
            args.path === 'config'
              ? 'export const getConfig=()=>__utilityHost.config();export const DATA_DIR=__utilityHost.dataDir??"";'
              : 'export const safeFetch=(url,options)=>__utilityHost.safeFetch(url,options);export const safeFetchBinary=(url,maxBytes)=>__utilityHost.safeFetchBinary(url,maxBytes);',
          loader: 'js',
        }));
        api.onLoad({filter:/web-search\.js$/},args=>{
          const source=fs.readFileSync(args.path,'utf8');
          // Bing may add attributes/classes or use single quotes. Keep the pinned
          // provider algorithm and normalize only its brittle HTML boundary.
          return {contents:source.replace(".split('<li class=\"b_algo\"')",String.raw`.split(/<li\b[^>]*\bclass\s*=\s*["'][^"']*\bb_algo\b[^"']*["']/i)`),loader:'js'};
        });
      },
    },
  ],
});
fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
const target=path.join(root,'generated/runtime.mjs'),temporary=target+'.'+randomUUID()+'.tmp';
fs.writeFileSync(
  temporary,
  `// Generated from pinned, isolated pure utility modules.\nimport {createRequire} from 'node:module';\nconst require=createRequire(import.meta.url);\nexport function createCoreUtilities(__utilityHost){const fetch=(...args)=>__utilityHost.fetch(...args);const module={exports:{}};const exports=module.exports;\n${built.outputFiles[0].text}\nreturn module.exports;\n}\n`,
);
fs.renameSync(temporary,target);
