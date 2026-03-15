import Fuse from 'fuse.js'
import { allSourceItems, type EncumbranceExpr, type SourceItem, type SourceItemGroup } from './item-source-catalog'

export type SourceItemSearchFilter = {
  readonly groups?: readonly SourceItemGroup[]
  readonly encumbranceKinds?: readonly EncumbranceExpr['kind'][]
}

export type SourceItemSearchHit = {
  readonly item: SourceItem
  readonly score: number
}

export type CategoryToken = 'armor' | 'weapons' | 'adventuring'
export type EncumbranceToken = EncumbranceExpr['kind']

export type SourceItemSearchTag =
  | {
      readonly kind: 'category'
      readonly token: string
      readonly value: CategoryToken
      readonly group: SourceItemGroup
    }
  | {
      readonly kind: 'enc'
      readonly token: string
      readonly value: EncumbranceToken
    }
  | {
      readonly kind: 'name'
      readonly token: string
      readonly value: string
    }

export type SourceItemSearchSuggestion =
  | {
      readonly type: 'category'
      readonly token: string
      readonly label: string
      readonly group: SourceItemGroup
      readonly confidence: number
    }
  | {
      readonly type: 'enc'
      readonly token: string
      readonly label: string
      readonly encumbranceKind: EncumbranceExpr['kind']
      readonly confidence: number
    }

export type SourceItemAnalyzedQuery = {
  readonly textQuery: string
  readonly activeTags: readonly SourceItemSearchTag[]
  readonly filterFromTags: SourceItemSearchFilter
}

export type SourceItemSearchIndex = {
  search(query: string, limit?: number, filter?: SourceItemSearchFilter): readonly SourceItemSearchHit[]
  analyzeQuery(query: string): SourceItemAnalyzedQuery
  suggest(query: string, limit?: number): readonly SourceItemSearchSuggestion[]
}

const categoryTokenToGroup = (token: string): SourceItemGroup | null => {
  const normalized = token.toLowerCase()
  if (normalized === 'armor' || normalized === 'barding' || normalized === 'armor-and-barding') return 'armor-and-barding'
  if (normalized === 'weapon' || normalized === 'weapons') return 'weapons'
  if (normalized === 'adventuring' || normalized === 'equipment' || normalized === 'adventuring-equipment') {
    return 'adventuring-equipment'
  }
  return null
}

const groupToCategoryToken = (group: SourceItemGroup): CategoryToken => {
  if (group === 'armor-and-barding') return 'armor'
  if (group === 'weapons') return 'weapons'
  return 'adventuring'
}

const encTokenToKind = (token: string): EncumbranceExpr['kind'] | null => {
  const normalized = token.toLowerCase()
  if (normalized === 'fixed') return 'fixed'
  if (normalized === 'range') return 'range'
  if (normalized === 'at-least' || normalized === 'atleast' || normalized === 'plus') return 'at-least'
  if (normalized === 'by-weight' || normalized === 'byweight' || normalized === 'weight') return 'by-weight'
  if (normalized === 'varies' || normalized === 'variable') return 'varies'
  if (normalized === 'not-carried' || normalized === 'none' || normalized === 'dash') return 'not-carried'
  return null
}

const kindToEncToken = (kind: EncumbranceExpr['kind']): string => {
  if (kind === 'at-least') return 'at-least'
  if (kind === 'by-weight') return 'by-weight'
  if (kind === 'not-carried') return 'not-carried'
  return kind
}

const mergeFilter = (
  explicitFilter: SourceItemSearchFilter | undefined,
  taggedFilter: SourceItemSearchFilter,
): SourceItemSearchFilter => {
  const explicitGroups = explicitFilter?.groups
  const taggedGroups = taggedFilter.groups
  const groups = explicitGroups && taggedGroups
    ? explicitGroups.filter((group) => taggedGroups.includes(group))
    : (explicitGroups ?? taggedGroups)

  const explicitEncKinds = explicitFilter?.encumbranceKinds
  const taggedEncKinds = taggedFilter.encumbranceKinds
  const encumbranceKinds = explicitEncKinds && taggedEncKinds
    ? explicitEncKinds.filter((kind) => taggedEncKinds.includes(kind))
    : (explicitEncKinds ?? taggedEncKinds)

  return {
    groups,
    encumbranceKinds,
  }
}

const applyFilter = (items: readonly SourceItem[], filter?: SourceItemSearchFilter): readonly SourceItem[] => {
  if (!filter) return items

  const groupSet = filter.groups ? new Set(filter.groups) : null
  const encSet = filter.encumbranceKinds ? new Set(filter.encumbranceKinds) : null

  return items.filter((item) => {
    if (groupSet && !groupSet.has(item.group)) return false
    if (encSet && !encSet.has(item.encumbrance.kind)) return false
    return true
  })
}

export const createSourceItemSearchIndex = (seedItems: readonly SourceItem[] = allSourceItems): SourceItemSearchIndex => {
  const fuse = new Fuse(seedItems, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.38,
    keys: [
      { name: 'name', weight: 0.72 },
      { name: 'group', weight: 0.2 },
      { name: 'notes', weight: 0.08 },
    ],
  })

  const analyzeQuery = (query: string): SourceItemAnalyzedQuery => {
    const activeTags: SourceItemSearchTag[] = []
    const nameTerms: string[] = []

    const textQuery = query
      .replace(/\b(category|enc|name):("[^"]+"|[^\s]+)/gi, (_full, rawKey: string, rawValue: string) => {
        const key = rawKey.toLowerCase()
        const value = rawValue.replace(/^"(.*)"$/, '$1')

        if (key === 'category') {
          const group = categoryTokenToGroup(value)
          if (!group) return _full
          const tagToken = `category:${groupToCategoryToken(group)}`
          activeTags.push({
            kind: 'category',
            token: tagToken,
            value: groupToCategoryToken(group),
            group,
          })
          return ''
        }

        if (key === 'enc') {
          const encKind = encTokenToKind(value)
          if (!encKind) return _full
          const tagToken = `enc:${kindToEncToken(encKind)}`
          activeTags.push({
            kind: 'enc',
            token: tagToken,
            value: encKind,
          })
          return ''
        }

        if (key === 'name') {
          const cleaned = value.trim()
          if (cleaned.length === 0) return ''
          activeTags.push({
            kind: 'name',
            token: `name:${cleaned}`,
            value: cleaned,
          })
          nameTerms.push(cleaned)
          return ''
        }

        return _full
      })
      .replace(/\s+/g, ' ')
      .trim()

    const groups = [...new Set(activeTags.filter((tag) => tag.kind === 'category').map((tag) => tag.group))]
    const encKinds = [...new Set(activeTags.filter((tag) => tag.kind === 'enc').map((tag) => tag.value))]
    const textWithName = [textQuery, ...nameTerms].filter((part) => part.length > 0).join(' ').trim()

    return {
      textQuery: textWithName,
      activeTags,
      filterFromTags: {
        groups: groups.length > 0 ? groups : undefined,
        encumbranceKinds: encKinds.length > 0 ? encKinds : undefined,
      },
    }
  }

  const rawSearch = (query: string, limit: number, filter?: SourceItemSearchFilter): readonly SourceItemSearchHit[] => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      return applyFilter(seedItems, filter)
        .slice(0, limit)
        .map((item) => ({ item, score: 0 }))
    }

    const filtered = applyFilter(seedItems, filter)
    const filteredIds = new Set(filtered.map((item) => item.id))

    return fuse
      .search(trimmed, { limit: Math.max(limit * 3, limit) })
      .filter((hit) => filteredIds.has(hit.item.id))
      .slice(0, limit)
      .map((hit) => ({
        item: hit.item,
        score: hit.score ?? 0,
      }))
  }

  const suggest = (query: string, limit = 5): readonly SourceItemSearchSuggestion[] => {
    const completion = query.toLowerCase().match(/(?:^|\s)(category|enc):([a-z-]*)$/)
    if (completion) {
      const mode = completion[1]
      const partial = completion[2] ?? ''
      if (mode === 'category') {
        return (['armor', 'weapons', 'adventuring'] as const)
          .filter((token) => token.startsWith(partial))
          .slice(0, limit)
          .map((token) => {
            const group = categoryTokenToGroup(token) as SourceItemGroup
            return {
              type: 'category' as const,
              token: `category:${token}`,
              label: `category: ${token}`,
              group,
              confidence: 1,
            }
          })
      }

      return (['fixed', 'range', 'at-least', 'by-weight', 'varies', 'not-carried'] as const)
        .filter((token) => token.startsWith(partial))
        .slice(0, limit)
        .map((token) => ({
          type: 'enc' as const,
          token: `enc:${token}`,
          label: `enc: ${token}`,
          encumbranceKind: encTokenToKind(token) as EncumbranceExpr['kind'],
          confidence: 1,
        }))
    }

    const analyzed = analyzeQuery(query)
    const hits = rawSearch(analyzed.textQuery, 30, analyzed.filterFromTags)
    const activeTokenSet = new Set(analyzed.activeTags.map((tag) => tag.token.toLowerCase()))
    const counts = new Map<SourceItemGroup, number>()
    const encCounts = new Map<EncumbranceExpr['kind'], number>()
    for (const hit of hits) {
      counts.set(hit.item.group, (counts.get(hit.item.group) ?? 0) + 1)
      encCounts.set(hit.item.encumbrance.kind, (encCounts.get(hit.item.encumbrance.kind) ?? 0) + 1)
    }

    const categorySuggestions = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([group, count]) => {
        const token = groupToCategoryToken(group)
        return {
          type: 'category' as const,
          token: `category:${token}`,
          label: `category: ${token}`,
          group,
          confidence: hits.length > 0 ? count / hits.length : 0,
        }
      })
      .filter((suggestion) => !activeTokenSet.has(suggestion.token.toLowerCase()))

    const encSuggestions = [...encCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([kind, count]) => ({
        type: 'enc' as const,
        token: `enc:${kindToEncToken(kind)}`,
        label: `enc: ${kindToEncToken(kind)}`,
        encumbranceKind: kind,
        confidence: hits.length > 0 ? count / hits.length : 0,
      }))
      .filter((suggestion) => !activeTokenSet.has(suggestion.token.toLowerCase()))

    const ranked = [...categorySuggestions, ...encSuggestions]
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, limit)

    if (ranked.length > 0) return ranked

    return (['armor', 'weapons', 'adventuring'] as const)
      .slice(0, limit)
      .map((token) => {
        const group = categoryTokenToGroup(token) as SourceItemGroup
        return {
          type: 'category' as const,
          token: `category:${token}`,
          label: `category: ${token}`,
          group,
          confidence: 0.1,
        }
      })
  }

  return {
    search(query, limit = 10, filter) {
      const analyzed = analyzeQuery(query)
      return rawSearch(analyzed.textQuery, limit, mergeFilter(filter, analyzed.filterFromTags))
    },
    analyzeQuery,
    suggest,
  }
}

