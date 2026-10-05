export type StepDropPosition = 'before' | 'after'

export const reorderSteps = <T extends { id: string }>(
  steps: T[], draggedId: string, targetId: string, position: StepDropPosition,
): T[] => {
  const from = steps.findIndex(step => step.id === draggedId)
  const target = steps.findIndex(step => step.id === targetId)
  if (from < 0 || target < 0 || from === target) return steps

  let insertion = target + (position === 'after' ? 1 : 0)
  if (from < insertion) insertion--
  if (insertion === from) return steps

  const next = [...steps]
  const [moved] = next.splice(from, 1)
  next.splice(insertion, 0, moved)
  return next
}
