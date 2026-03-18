export type NodeMotionPolicyInput = {
  isDraggedNode: boolean
  isInListViewGroup: boolean
  positionChanged: boolean
}

export type NodeMotionDecision = 'snap' | 'animate' | 'none'

export const decideNodeMotion = ({
  isDraggedNode,
  isInListViewGroup,
  positionChanged,
}: NodeMotionPolicyInput): NodeMotionDecision => {
  if (!positionChanged) return 'none'
  if (isDraggedNode) return 'snap'
  if (isInListViewGroup) return 'animate'
  return 'animate'
}

