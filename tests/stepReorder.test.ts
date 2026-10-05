import assert from 'node:assert/strict'
import test from 'node:test'
import { reorderSteps } from '../src/stepReorder.ts'
import { withMiniSteps } from '../src/taskDeadlines.ts'

const steps = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, text: id, done: false, dueDate: `2026-10-${10 + i}` }))

test('inserts exactly before or after the target in either direction', () => {
  for (const source of steps) {
    for (const target of steps) {
      if (source.id === target.id) continue
      for (const position of ['before', 'after'] as const) {
        const next = reorderSteps(steps, source.id, target.id, position)
        const sourceIndex = next.findIndex(s => s.id === source.id)
        const targetIndex = next.findIndex(s => s.id === target.id)
        assert.equal(sourceIndex, targetIndex + (position === 'after' ? 1 : -1))
        assert.deepEqual(next.filter(s => s.id !== source.id), steps.filter(s => s.id !== source.id))
      }
    }
  }
  assert.deepEqual(steps.map(s => s.id), ['a', 'b', 'c', 'd'])
})

test('same positions and invalid targets leave the original list intact', () => {
  assert.equal(reorderSteps(steps, 'a', 'b', 'before'), steps)
  assert.equal(reorderSteps(steps, 'd', 'c', 'after'), steps)
  assert.equal(reorderSteps(steps, 'b', 'b', 'before'), steps)
  assert.equal(reorderSteps(steps, 'missing', 'b', 'after'), steps)
  assert.equal(reorderSteps(steps, 'b', 'missing', 'after'), steps)
})

test('moving to the end preserves step data and updates the final deadline', () => {
  const original = { dueDate: '2026-10-13', miniSteps: steps, memo: 'preserved' }
  const next = withMiniSteps(original, reorderSteps(steps, 'a', 'd', 'after'))
  assert.deepEqual(next.miniSteps.map(s => s.id), ['b', 'c', 'd', 'a'])
  assert.equal(next.dueDate, '2026-10-10')
  assert.equal(next.memo, original.memo)
  assert.equal(next.miniSteps[3], steps[0])
  assert.equal(original.dueDate, '2026-10-13')
})
