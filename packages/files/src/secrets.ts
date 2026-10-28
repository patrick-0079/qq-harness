const secretKey =
  /api.?key|access.?token|secret|credential|authorization|password|cookie|providerkeys|^token$|^bottoken$|^(?:opencodeGo|deepseek|glm)Key$/i;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const mask = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(mask)
    : object(v)
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)]))
      : typeof v === 'string' && v
        ? '******'
        : v;
export function redactConfigTree(value: unknown): any {
  if (Array.isArray(value)) return value.map(redactConfigTree);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secretKey.test(key) ? mask(item) : redactConfigTree(item),
    ]),
  );
}
export function restoreMaskedSecrets(patch: unknown, previous: unknown): any {
  if (patch === '******') return previous;
  if (Array.isArray(patch))
    return patch.map((v, i) => {
      const old = Array.isArray(previous)
        ? object(v) && typeof v.id === 'string'
          ? previous.find((item) => object(item) && item.id === v.id)
          : previous[i]
        : undefined;
      return restoreMaskedSecrets(v, old);
    });
  if (!object(patch)) return patch;
  return Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [
      k,
      restoreMaskedSecrets(v, object(previous) ? previous[k] : undefined),
    ]),
  );
}
export function stripSessionSecrets(value: unknown): any {
  if (Array.isArray(value)) return value.map(stripSessionSecrets);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, v]) => !secretKey.test(key) && !/^has[A-Z]/.test(key) && v !== '******')
      .map(([k, v]) => [k, stripSessionSecrets(v)]),
  );
}
export function redactKnownSecrets(value: unknown, source: unknown): any {
  const values = new Set<string>();
  const collect = (v: unknown, sensitive = false) => {
    if (typeof v === 'string') {
      if (sensitive && v && v !== '******') values.add(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => collect(x, sensitive));
      return;
    }
    if (object(v))
      for (const [key, item] of Object.entries(v))
        collect(
          item,
          sensitive ||
            secretKey.test(key) ||
            /^(?:deepseek|glm|opencodeGo|mimo|bocha|baidu|metaso|zhipu)Key$/i.test(key),
        );
  };
  collect(source);
  return JSON.parse(
    JSON.stringify(value ?? null, (key, item) => {
      if (secretKey.test(key) || /^authorization$/i.test(key))
        return typeof item === 'boolean' ? item : item ? '[REDACTED]' : item;
      if (typeof item === 'string') {
        let text = item;
        for (const secret of [...values].sort((a, b) => b.length - a.length))
          text = text.split(secret).join('[REDACTED]');
        return text
          .replace(/([?&](?:api_key|access_token|token)=)[^&\s]+/gi, '$1[REDACTED]')
          .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
      }
      return item;
    }),
  );
}
