import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { StepDropPosition } from './stepReorder'

const STEP_DRAG_TYPE = 'application/x-mini-step-id'

const dropPosition = (event: DragEvent<HTMLElement>): StepDropPosition => {
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

export const useMiniStepDrag = (
  onReorder: (draggedId: string, targetId: string, position: StepDropPosition) => void,
) => {
  const sourceRef = useRef<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [target, setTarget] = useState<{ id: string; position: StepDropPosition } | null>(null)

  const clear = () => {
    sourceRef.current = null
    setDraggedId(null)
    setTarget(null)
  }

  const start = (event: DragEvent<HTMLElement>, id: string) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(STEP_DRAG_TYPE, id)
    sourceRef.current = id
    setDraggedId(id)
    setTarget(null)
  }

  const end = (event: DragEvent<HTMLElement>) => {
    event.stopPropagation()
    clear()
  }

  const rowProps = (id: string) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!sourceRef.current) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      if (sourceRef.current === id) {
        setTarget(null)
        return
      }
      const position = dropPosition(event)
      setTarget(previous => previous?.id === id && previous.position === position ? previous : { id, position })
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      setTarget(previous => previous?.id === id ? null : previous)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      // A step belongs to this list; do not let foreign steps reach task/column drop handlers.
      if (!sourceRef.current) {
        if (event.dataTransfer.types.includes(STEP_DRAG_TYPE)) event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const source = sourceRef.current
      const position = dropPosition(event)
      clear()
      if (source !== id) onReorder(source, id, position)
    },
  })

  return { draggedId, target, start, end, rowProps }
}
