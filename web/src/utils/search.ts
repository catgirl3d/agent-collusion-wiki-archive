import type { SearchIndex } from '../types'

const TOKEN_RE = /[a-z0-9]+/g

/**
 * Looks up term(s) in the full-text index (web/public/data/search_index.json:
 * tokens[term] = [slug,...]). Returns null when the index is unavailable or
 * tokenization leaves no words ≥ 3 chars (build.py tokenizer minimum) —
 * the full-text filter is not applied then. Multi-word queries intersect
 * the postings of all words (AND); [] when any word is missing or has no postings.
 * Postings are truncated by build.py (150 slugs per token) — the result is approximate.
 * Underscores are treated as separators ("by_pass" → by + pass): same semantics
 * as in page names, where by_pass appears as separate tokenizer words.
 */
export function lookupTokenPostings(index: SearchIndex | null | undefined, term: string): string[] | null {
  const words = term.trim().toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').match(TOKEN_RE)?.filter((w) => w.length >= 3) ?? []
  if (!index || !words.length) return null
  let postings: string[] | null = null
  for (const word of words) {
    const p = index.tokens[word]
    if (!p) return []
    if (postings === null) {
      postings = p
      continue
    }
    const allowed = new Set(p)
    postings = postings.filter((slug) => allowed.has(slug))
  }
  return postings
}
