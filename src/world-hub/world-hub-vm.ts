/** Pure helpers for world hub UI copy (no DOM). */

export const formatLastVisited = (lastVisitedMs: number): string => {
  if (lastVisitedMs <= 0) return 'Not opened yet'
  const diff = Date.now() - lastVisitedMs
  if (diff < 60_000) return 'Just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}
