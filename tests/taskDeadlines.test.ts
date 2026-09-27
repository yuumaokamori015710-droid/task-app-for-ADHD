import assert from 'node:assert/strict'
import test from 'node:test'
import { withMiniSteps } from '../src/taskDeadlines.ts'

const step = (id: string, dueDate = '', done = false) => ({ id, text: id, dueDate, done })
const task = (miniSteps = [step('first')], dueDate = '2026-10-30') => ({
  id: 'existing-task', title: 'Existing task', goal: 'Existing goal', memo: 'Keep this memo',
  completed: false, createdAt: '2026-09-01T09:00:00.000Z', dueDate, miniSteps,
})

test('uses the last dated action in list order, not the latest calendar date', () => {
  const result = withMiniSteps(task(), [step('first', '2026-10-20'), step('last', '2026-10-10')])
  assert.equal(result.dueDate, '2026-10-10')
})

test('changing or adding a final action deadline updates the task deadline', () => {
  const original = task([step('first', '2026-10-01')])
  const edited = withMiniSteps(original, [step('first', '2026-10-05')])
  assert.equal(edited.dueDate, '2026-10-05')
  const added = withMiniSteps(edited, [...edited.miniSteps, step('second', '2026-10-08')])
  assert.equal(added.dueDate, '2026-10-08')
})

test('empty draft rows do not clear a scheduled deadline', () => {
  const result = withMiniSteps(task(), [step('first', '2026-10-05'), step(''), step('')])
  assert.equal(result.dueDate, '2026-10-05')
})

test('reordering or deleting the final action follows the new order', () => {
  const original = task([step('first', '2026-10-01'), step('last', '2026-10-05')], '2026-10-05')
  const reordered = withMiniSteps(original, [...original.miniSteps].reverse())
  assert.equal(reordered.dueDate, '2026-10-01')
  const deleted = withMiniSteps(original, original.miniSteps.slice(0, 1))
  assert.equal(deleted.dueDate, '2026-10-01')
})

test('clearing a final action deadline falls back to the previous scheduled action', () => {
  const original = task([step('first', '2026-10-01'), step('last', '2026-10-05')], '2026-10-05')
  const result = withMiniSteps(original, [original.miniSteps[0], step('last')])
  assert.equal(result.dueDate, '2026-10-01')
})

test('removing all action deadlines clears the old automatic deadline', () => {
  const original = task([step('first', '2026-10-01')], '2026-10-01')
  assert.equal(withMiniSteps(original, [step('first')]).dueDate, '')
  assert.equal(withMiniSteps(original, []).dueDate, '')
})

test('tasks without scheduled actions retain their manually entered deadline', () => {
  const original = task()
  assert.equal(withMiniSteps(original, [step('first'), step('second')]).dueDate, original.dueDate)
})

test('completed actions still count and other task data is preserved without mutation', () => {
  const original = task([step('first', '2026-10-01'), step('last', '2026-10-05')])
  const snapshot = structuredClone(original)
  const miniSteps = original.miniSteps.map(s => ({ ...s, done: true }))
  const updated = withMiniSteps(original, miniSteps)
  assert.equal(updated.dueDate, '2026-10-05')
  assert.deepEqual(updated, { ...original, miniSteps, dueDate: '2026-10-05' })
  assert.deepEqual(original, snapshot)
  assert.deepEqual(JSON.parse(JSON.stringify(updated)), updated)
})
