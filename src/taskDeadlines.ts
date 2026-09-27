interface ScheduledTask {
  dueDate: string
  miniSteps: { dueDate: string }[]
}

const lastActionDeadline = (steps: ScheduledTask['miniSteps']) =>
  [...steps].reverse().find(step => step.dueDate)?.dueDate

export const withMiniSteps = <T extends ScheduledTask>(task: T, miniSteps: T['miniSteps']): T => ({
  ...task,
  miniSteps,
  // Empty draft rows do not replace the last scheduled action's deadline.
  dueDate: lastActionDeadline(miniSteps) ?? (lastActionDeadline(task.miniSteps) ? '' : task.dueDate),
})
