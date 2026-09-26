export type PayloadDivergenceKind =
  | 'agree'
  | 'standalone-high-entropy'
  | 'web-only-host-mention'
  | 'python-only-encoded-nested-host'
  | 'unexpected'

const HOST_MENTION_FLAGS = new Set(['tunnel', 'redirect'])

function decodePercentOnce(value: string): string {
  return value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/** True when one percent-decode exposes a URL nested inside another URL's text. */
function hasNestedUrl(body: string): boolean {
  const decoded = decodePercentOnce(body)
  for (const match of decoded.matchAll(/https?:\/\/[^\s<>'"]+/gi)) {
    const afterScheme = match[0].slice(match[0].indexOf('://') + 3)
    if (/https?:\/\//i.test(afterScheme)) return true
  }
  return false
}

/**
 * Classifies a Python↔web payload-verdict difference against the divergence classes
 * documented in data/validation/payload_flags_golden.json::_meta.known_divergences.
 * Conditions mirror the documented mechanisms instead of accepting any difference of
 * the same shape; anything outside those classes is 'unexpected' and must fail the caller.
 */
export function classifyPayloadDivergence(
  body: string,
  pythonFlags: string[],
  webFlags: string[],
): PayloadDivergenceKind {
  const python = new Set(pythonFlags)
  const web = new Set(webFlags)
  const pythonOnly = pythonFlags.filter((flag) => !web.has(flag))
  const webOnly = webFlags.filter((flag) => !python.has(flag))

  if (!pythonOnly.length && !webOnly.length) return 'agree'
  if (pythonFlags.length === 1 && pythonFlags[0] === 'high-entropy' && webFlags.length === 0) {
    return 'standalone-high-entropy'
  }
  if (!pythonOnly.length && webOnly.length > 0 && webOnly.every((flag) => HOST_MENTION_FLAGS.has(flag))) {
    return 'web-only-host-mention'
  }
  if (
    !webOnly.length &&
    webFlags.length > 0 &&
    pythonOnly.length > 0 &&
    pythonOnly.every((flag) => HOST_MENTION_FLAGS.has(flag)) &&
    hasNestedUrl(body)
  ) {
    return 'python-only-encoded-nested-host'
  }
  return 'unexpected'
}