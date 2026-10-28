const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' });
const bounds = [
  ['A', '阿'],
  ['B', '八'],
  ['C', '嚓'],
  ['D', '搭'],
  ['E', '蛾'],
  ['F', '发'],
  ['G', '噶'],
  ['H', '哈'],
  ['J', '击'],
  ['K', '喀'],
  ['L', '垃'],
  ['M', '妈'],
  ['N', '拿'],
  ['O', '哦'],
  ['P', '啪'],
  ['Q', '期'],
  ['R', '然'],
  ['S', '撒'],
  ['T', '塌'],
  ['W', '挖'],
  ['X', '昔'],
  ['Y', '压'],
  ['Z', '匝'],
] as const;
export function chatInitial(name: string) {
  const first = Array.from(name.trim())[0] ?? '';
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  if (!/^[\u4e00-\u9fff]$/.test(first)) return '#';
  let letter = '#';
  for (const [initial, bound] of bounds) {
    if (collator.compare(first, bound) >= 0) letter = initial;
    else break;
  }
  return letter;
}
export function compareChatNames(a: string, b: string) {
  const ai = chatInitial(a),
    bi = chatInitial(b);
  return ai === bi ? collator.compare(a, b) : ai === '#' ? -1 : bi === '#' ? 1 : ai.localeCompare(bi);
}
