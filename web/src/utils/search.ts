import type { SearchIndex } from '../types'

const TOKEN_RE = /[a-z0-9]+/g

/**
 * Ищет термин(ы) в полнотекстовом индексе (web/public/data/search_index.json:
 * tokens[term] = [slug,...]). Возвращает null, когда индекс недоступен или после
 * токенизации не осталось слов ≥ 3 символов (минимум токенизатора build.py) —
 * тогда фулл-текст-фильтр не применяется. Многословные запросы дают пересечение
 * постингов всех слов (AND); [] когда любое слово отсутствует или постингов нет.
 * Постинги обрезаны build.py (150 slug'ов на токен) — результат приблизительный.
 * Подчёркивания трактуются как разделители («by_pass» → by + pass): тот же смысл,
 * что в именах страниц, где by_pass встречается как отдельные слова токенизатора.
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
