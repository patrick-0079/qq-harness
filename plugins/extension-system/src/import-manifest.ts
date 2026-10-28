export function declaredManifest(entries: { name: string; data: Buffer }[]) {
  const candidates = entries
    .filter((e) =>
      /(?:^|\/)(?:extension|plugin|skill|tool|mcp|knowledge|promptinject)\.json$/.test(e.name),
    )
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length);
  if (!candidates.length)
    throw Error('扩展缺少清单；请提供含 type 声明的 extension.json 或对应类型清单');
  const entry = candidates[0]!;
  let manifest: Record<string, any>;
  try {
    manifest = JSON.parse(entry.data.toString('utf8'));
  } catch {
    throw Error('扩展清单不是有效JSON');
  }
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !['plugin', 'chat-plugin', 'skill', 'tool', 'mcp', 'knowledge', 'promptinject'].includes(
      manifest.type,
    )
  )
    throw Error(
      '清单必须声明有效 type：plugin、chat-plugin、skill、tool、mcp、knowledge、promptinject',
    );
  const type = manifest.type === 'chat-plugin' ? 'plugin' : manifest.type;
  const normalized = {
    ...manifest,
    type,
    ...(manifest.type === 'chat-plugin' ? { scope: 'session' } : {}),
  };
  const canonical = entry.name.replace(/[^/]+$/, type + '.json'),
    data = Buffer.from(JSON.stringify(normalized));
  if (canonical === entry.name) entry.data = data;
  else {
    const existing = entries.find((e) => e.name === canonical);
    if (existing) {
      const other = JSON.parse(existing.data.toString('utf8'));
      if (other.id !== manifest.id || other.type !== normalized.type)
        throw Error('安装包包含多个独立扩展或冲突类型声明');
      existing.data = data;
      entries.splice(entries.indexOf(existing), 1);
      entries.unshift(existing);
    } else entries.unshift({ name: canonical, data });
  }
  return normalized;
}
