export type NodeMotionPolicyInput = {
  isDraggedNode: boolean
  isInListViewGroup: boolean
  positionChanged: boolean
  isGroupTranslation: boolean
}

export type NodeMotionDecision = 'snap' | 'animate' | 'none'

export const decideNodeMotion = ({
  isDraggedNode,
  isInListViewGroup,
  positionChanged,
  isGroupTranslation,
}: NodeMotionPolicyInput): NodeMotionDecision => {
  if (!positionChanged) return 'none'
  if (isDraggedNode) return 'snap'
  if (isGroupTranslation) return 'snap'
  if (isInListViewGroup) return 'animate'
  return 'animate'
}

