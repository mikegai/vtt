import type { CanonicalState } from '../../domain/types'

/**
 * Two PCs, one movement group, **no** inventory entries — all gear must be created via
 * `SPAWN_ITEM_INSTANCE` / `APPLY_ADD_ITEMS_OP` / drag (same as starting from an empty sheet).
 */
export const minimalVmWorld = (): CanonicalState => ({
  actors: {
    alpha: {
      id: 'alpha',
      name: 'Alpha',
      kind: 'pc',
      stats: { strengthMod: 0, hasLoadBearing: false },
      movementGroupId: 'party',
      active: true,
    },
    beta: {
      id: 'beta',
      name: 'Beta',
      kind: 'pc',
      stats: { strengthMod: 0, hasLoadBearing: false },
      movementGroupId: 'party',
      active: true,
    },
    gamma: {
      id: 'gamma',
      name: 'Gamma',
      kind: 'pc',
      stats: { strengthMod: 0, hasLoadBearing: false },
      movementGroupId: 'party',
      active: true,
    },
  },
  movementGroups: {
    party: { id: 'party', name: 'Party', active: true },
  },
  carryGroups: {},
  inventoryEntries: {},
  itemDefinitions: {
    handAxe: { id: 'handAxe', canonicalName: 'Hand axe', kind: 'standard', sixthsPerUnit: 1 },
    dagger: { id: 'dagger', canonicalName: 'Dagger', kind: 'standard', sixthsPerUnit: 1 },
    ironRationsDay: {
      id: 'ironRationsDay',
      canonicalName: 'Daily iron rations',
      kind: 'standard',
      sixthsPerUnit: 1,
      priceInGp: 1 / 7,
      isFungibleVisual: true,
    },
  },
})
