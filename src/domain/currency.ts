/** 1 pp = 10 gp = 100 sp = 1000 cp */
export const GP_PER_PP = 10
export const SP_PER_GP = 10
export const CP_PER_SP = 10
export const CP_PER_GP = CP_PER_SP * SP_PER_GP

/** Format gp for display. Picks the most readable metal (pp/gp/sp/cp). */
export const formatGp = (gp: number): string => {
  if (gp >= 1) return `${gp} gp`
  if (gp >= 0.1) return `${(gp * SP_PER_GP).toFixed(1)} sp`
  if (gp >= 0.01) return `${Math.round(gp * CP_PER_GP)} cp`
  return `${gp} gp`
}
