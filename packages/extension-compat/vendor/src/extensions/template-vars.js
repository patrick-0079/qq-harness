// 模板变量：`{{...}}` 的统一解析与替换。
//
// 设计目标：
//   · 任何扩展类型、任何配置项都能用（插件/工具/MCP/上下文/技能参数）
//   · 内置一批常用时间变量，扩展也可以声明自己的转换器
//   · **只做白名单替换，绝不 eval**：参数只认整数字面量与字符串字面量
//   · 转换时机统一在「真正触发前」，未知 token 原样保留（不静默吞掉）
//
// 语法：
//   {{date}}                        内置变量
//   {{date('MM-DD')}}               带格式参数
//   {{date_offset(0,0,-1)}}         年月日偏移
//   {{time_offset(-1,0,0,'HH:mm')}} 时分秒偏移 + 格式
//   {{datetime_offset(0,0,-1,0,0,0)}} 年月日时分秒偏移
//   {{my_var}} / {{my_var(1,'x')}}  扩展声明的变量
//
// 解析优先级：扩展自定义 → 内置 → 由调用方传入的 vars → 原样保留

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^()]*)\))?\s*\}\}/g;
const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** 常用格式：不认识的记号原样保留。 */
function pad(n, w = 2) {
  return String(Math.trunc(Math.abs(n))).padStart(w, '0');
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 按格式串渲染时间。
 * 支持：YYYY YY MM M DD D HH H mm m ss s ddd
 */
export function formatDate(date, fmt = 'YYYY-MM-DD HH:mm:ss') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const table = [
    ['YYYY', String(d.getFullYear())],
    ['YY', String(d.getFullYear()).slice(-2)],
    ['MM', pad(d.getMonth() + 1)],
    ['DD', pad(d.getDate())],
    ['HH', pad(d.getHours())],
    ['mm', pad(d.getMinutes())],
    ['ss', pad(d.getSeconds())],
    ['ddd', WEEKDAYS[d.getDay()]],
    ['M', String(d.getMonth() + 1)],
    ['D', String(d.getDate())],
    ['H', String(d.getHours())],
    ['m', String(d.getMinutes())],
    ['s', String(d.getSeconds())]
  ];
  // 长记号优先（否则 YYYY 会被 YY 抢先吃掉）
  let out = String(fmt);
  for (const [token, value] of table) {
    out = out.split(token).join(value);
  }
  return out;
}

/** 应用偏移：年月日时分秒，与 Date 的 set* 同语义（自动进位）。 */
export function applyOffset(base, [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = {}) {
  const dt = new Date(base instanceof Date ? base.getTime() : base);
  if (!y && !mo && !d && !h && !mi && !s) return dt;
  if (y) dt.setFullYear(dt.getFullYear() + y);
  if (mo) dt.setMonth(dt.getMonth() + mo);
  if (d) dt.setDate(dt.getDate() + d);
  if (h) dt.setHours(dt.getHours() + h);
  if (mi) dt.setMinutes(dt.getMinutes() + mi);
  if (s) dt.setSeconds(dt.getSeconds() + s);
  return dt;
}

/** 内置变量表：name → ({args, now}) => string */
export const BUILTIN_VARS = {
  date: ({ args, now }) => formatDate(now, args[0] || 'YYYY-MM-DD'),
  time: ({ args, now }) => formatDate(now, args[0] || 'HH:mm:ss'),
  datetime: ({ args, now }) => formatDate(now, args[0] || 'YYYY-MM-DD HH:mm:ss'),
  year: ({ now }) => pad(now.getFullYear(), 4),
  month: ({ now }) => pad(now.getMonth() + 1),
  day: ({ now }) => pad(now.getDate()),
  hour: ({ now }) => pad(now.getHours()),
  minute: ({ now }) => pad(now.getMinutes()),
  second: ({ now }) => pad(now.getSeconds()),
  weekday: ({ args, now }) => formatDate(now, args[0] || 'ddd'),
  timestamp: ({ now }) => String(now.getTime()),
  iso: ({ now }) => {
    const off = -now.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const hh = pad(Math.floor(Math.abs(off) / 60));
    const mm = pad(Math.abs(off) % 60);
    return `${formatDate(now, 'YYYY-MM-DD')}T${formatDate(now, 'HH:mm:ss')}${sign}${hh}:${mm}`;
  },
  date_offset: ({ args, now }) => {
    const [nums, fmt] = splitNumsAndFormat(args, 3);
    return formatDate(applyOffset(now, nums), fmt || 'YYYY-MM-DD');
  },
  time_offset: ({ args, now }) => {
    const [nums, fmt] = splitNumsAndFormat(args, 3);
    // time_offset 的参数是 时,分,秒 → 映射到 [0,0,0,h,mi,s]
    const off = [0, 0, 0, nums[0] || 0, nums[1] || 0, nums[2] || 0];
    return formatDate(applyOffset(now, off), fmt || 'HH:mm:ss');
  },
  datetime_offset: ({ args, now }) => {
    const [nums, fmt] = splitNumsAndFormat(args, 6);
    return formatDate(applyOffset(now, nums), fmt || 'YYYY-MM-DD HH:mm:ss');
  }
};

/** 把参数数组拆成「数字部分 + 末尾可选格式串」。 */
function splitNumsAndFormat(args, maxNums) {
  const nums = [];
  let fmt = '';
  for (const a of args) {
    if (typeof a === 'string') { fmt = a; continue; }
    if (typeof a === 'number' && nums.length < maxNums) nums.push(a);
  }
  return [nums, fmt];
}

/** 解析参数串：只接受整数与带引号的字符串，其它一律视为非法。 */
export function parseArgs(raw = '') {
  const text = String(raw).trim();
  if (!text) return { ok: true, args: [] };
  const args = [];
  for (const part of text.split(',')) {
    const s = part.trim();
    if (/^-?\d+$/.test(s)) { args.push(Number(s)); continue; }
    const m = s.match(/^(['"])(.*)\1$/);
    if (m) { args.push(m[2]); continue; }
    return { ok: false, args: [] };   // 出现变量、表达式、函数调用 → 非法
  }
  return { ok: true, args };
}

// 扩展声明的变量：ownerId → Map(name → fn)
const converters = new Map();

/** 静态闸：名字合法、值必须是同步函数、不能与内置重名。 */
export function validateVarConverter(name, fn) {
  if (!NAME_RE.test(String(name))) return { ok: false, reason: `变量名不合法：${name}` };
  if (Object.prototype.hasOwnProperty.call(BUILTIN_VARS, name)) {
    return { ok: false, reason: `不能覆盖内置变量：${name}` };
  }
  if (typeof fn !== 'function') return { ok: false, reason: `变量 ${name} 必须是函数` };
  if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
    return { ok: false, reason: `变量 ${name} 必须是同步函数（不支持 async）` };
  }
  return { ok: true };
}

/** 注册一个扩展的变量转换器集合。 */
export function registerVarConverters(ownerId, vars) {
  if (!vars || typeof vars !== 'object') return { ok: true, count: 0 };
  const map = new Map();
  const violations = [];
  for (const [name, fn] of Object.entries(vars)) {
    const v = validateVarConverter(name, fn);
    if (!v.ok) { violations.push(v.reason); continue; }
    map.set(name, fn);
  }
  if (map.size) converters.set(String(ownerId), map);
  else converters.delete(String(ownerId));
  return { ok: violations.length === 0, violations, count: map.size };
}

export function unregisterVarConverters(ownerId) {
  converters.delete(String(ownerId));
}

export function clearVarConverters() {
  converters.clear();
}

/** 列出可用的变量（内置 + 指定扩展声明的），供配置页提示。 */
export function listVars(ownerId = '') {
  const builtin = Object.keys(BUILTIN_VARS).map((name) => ({ name, source: 'builtin' }));
  const own = ownerId && converters.has(String(ownerId))
    ? [...converters.get(String(ownerId)).keys()].map((name) => ({ name, source: 'extension' }))
    : [];
  return [...builtin, ...own];
}

/**
 * 渲染一段文本里的 `{{...}}`。
 *
 * @param {string} text
 * @param {object} scope { now, ownerId, vars }
 * @returns {{ text: string, replaced: number, warnings: string[] }}
 */
export function renderTemplate(text, { now = new Date(), ownerId = '', vars = {} } = {}) {
  const src = String(text ?? '');
  const own = ownerId ? converters.get(String(ownerId)) : null;
  const warnings = [];
  let replaced = 0;

  const out = src.replace(VAR_RE, (whole, name, rawArgs) => {
    const parsed = parseArgs(rawArgs || '');
    if (!parsed.ok) { warnings.push(`参数非法：${whole}`); return whole; }

    // 1) 扩展自定义（同步）
    if (own && own.has(name)) {
      try {
        const value = own.get(name)(parsed.args, { now, vars });
        if (value === undefined || value === null) { warnings.push(`变量返回空：${name}`); return whole; }
        replaced += 1;
        return String(value);
      } catch (error) {
        warnings.push(`变量 ${name} 抛错：${error?.message ?? error}`);
        return whole;
      }
    }

    // 2) 内置
    if (Object.prototype.hasOwnProperty.call(BUILTIN_VARS, name)) {
      replaced += 1;
      return BUILTIN_VARS[name]({ args: parsed.args, now });
    }

    // 3) 调用方传入的 vars（配置里声明的 KV）
    if (Object.prototype.hasOwnProperty.call(vars || {}, name)) {
      const v = vars[name];
      replaced += 1;
      return String(v ?? '');
    }

    // 4) 未知 → 原样保留
    warnings.push(`未知变量：${name}`);
    return whole;
  });

  return { text: out, replaced, warnings };
}

/** 递归渲染配置对象里的所有字符串（含数组与嵌套对象）。 */
export function renderConfigDeep(value, scope = {}) {
  if (typeof value === 'string') return renderTemplate(value, scope).text;
  if (Array.isArray(value)) return value.map((v) => renderConfigDeep(v, scope));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderConfigDeep(v, scope);
    return out;
  }
  return value;
}
