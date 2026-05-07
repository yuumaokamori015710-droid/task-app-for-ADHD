import React, { useState, useEffect, useRef } from 'react'
import {
  Plus, Pencil, Trash2, Check, Calendar, Download,
  AlertTriangle, X, BookOpen, List, BarChart2,
} from 'lucide-react'

// ============================================================
// Types
// ============================================================

type Priority = 'high' | 'medium' | 'low'
type Filter = 'all' | 'today' | 'thisWeek' | 'overdue'
type ViewMode = 'list' | 'gantt'

interface CompletionCondition {
  verb: string
  verbCustom: string
  target: string
  targetCustom: string
  state: string
  stateCustom: string
}

interface Task {
  id: string
  title: string
  dueDate: string       // 'YYYY-MM-DD'
  priority: Priority
  completed: boolean
  isToday: boolean      // marked as one of "today's 3"
  completionCondition: CompletionCondition
  createdAt: string     // ISO string
  // Future fields:
  // status: 'inProgress' | 'reviewing' | 'done'
  // reviewDate: string
  // retrospectiveMemo: string
  // roughApprovalMode: boolean
}

interface WontDoItem {
  id: string
  text: string
}

interface AppData {
  tasks: Task[]
  wontDoItems: WontDoItem[]
}

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY = 'task-app-data'
const MAX_TODAY = 3
const MAX_WONT_DO = 3
const DAY_PX = 28 // Gantt chart: pixels per day

const VERB_OPTIONS = [
  'ドラフトが', '要件が', '合意が', 'レビューが', '資料が', '議事録が',
  '質問への回答が', '課題リストが', '設計案が', 'テストが',
]
const TARGET_OPTIONS = [
  '自分で', 'NRIから', '上司と', '業務部門と', 'チーム内で', '関係者間で',
]
const STATE_OPTIONS = [
  '完成している', '確定している', '共有済みになっている',
  'フィードバック反映済みになっている', '承認されている', '着手可能になっている',
]

const PRIORITY_CONFIG: Record<Priority, { label: string; badge: string; bar: string; barDone: string }> = {
  high:   { label: '高', badge: 'bg-red-100 text-red-700',    bar: 'bg-red-300',    barDone: 'bg-red-200' },
  medium: { label: '中', badge: 'bg-yellow-100 text-yellow-700', bar: 'bg-yellow-300', barDone: 'bg-yellow-200' },
  low:    { label: '低', badge: 'bg-gray-100 text-gray-500',  bar: 'bg-gray-300',   barDone: 'bg-gray-200' },
}

// ============================================================
// Utilities
// ============================================================

const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
const todayStr = () => new Date().toISOString().split('T')[0]
const isToday = (d: string) => d === todayStr()

const isThisWeek = (d: string): boolean => {
  if (!d) return false
  const date = new Date(d + 'T00:00:00')
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const dow = now.getDay()
  const mon = new Date(now); mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999)
  return date >= mon && date <= sun
}

const isOverdue = (d: string): boolean => !!d && d < todayStr()

const fmtDate = (d: string): string => {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

const fmtCondition = (cc: CompletionCondition): string => {
  const v = cc.verb   === 'other' ? cc.verbCustom   : cc.verb
  const t = cc.target === 'other' ? cc.targetCustom : cc.target
  const s = cc.state  === 'other' ? cc.stateCustom  : cc.state
  return [v, t, s].filter(Boolean).join('')
}

// ============================================================
// localStorage
// ============================================================

const loadData = (): AppData => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AppData) : { tasks: [], wontDoItems: [] }
  } catch { return { tasks: [], wontDoItems: [] } }
}

const saveData = (data: AppData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

// ============================================================
// CSV export
// ============================================================

const handleExportCSV = (tasks: Task[]) => {
  const headers = ['タイトル', '優先度', '期限', '完了', '今日の3つ', '完了条件', '作成日']
  const rows = tasks.map(t => [
    `"${t.title.replace(/"/g, '""')}"`,
    PRIORITY_CONFIG[t.priority].label,
    t.dueDate,
    t.completed ? '完了' : '未完了',
    t.isToday ? 'はい' : 'いいえ',
    `"${fmtCondition(t.completionCondition).replace(/"/g, '""')}"`,
    t.createdAt.split('T')[0],
  ])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `tasks-${todayStr()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// ============================================================
// ConditionSelect
// ============================================================

interface ConditionSelectProps {
  label: string; options: string[]
  value: string; customValue: string
  onChange: (v: string) => void; onCustomChange: (v: string) => void
}

const ConditionSelect: React.FC<ConditionSelectProps> = ({
  label, options, value, customValue, onChange, onCustomChange,
}) => (
  <div className="flex flex-col gap-1 flex-1 min-w-0">
    <label className="text-xs text-gray-500">{label}</label>
    <select
      value={value} onChange={e => onChange(e.target.value)}
      className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-navy bg-white"
    >
      <option value="">未設定</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="other">その他（自由入力）</option>
    </select>
    {value === 'other' && (
      <input type="text" value={customValue} onChange={e => onCustomChange(e.target.value)}
        placeholder="自由入力..." className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-navy"
      />
    )}
  </div>
)

// ============================================================
// TaskModal
// ============================================================

const emptyCC = (): CompletionCondition => ({
  verb: '', verbCustom: '', target: '', targetCustom: '', state: '', stateCustom: '',
})

const makeNewTask = (): Task => ({
  id: genId(), title: '', dueDate: '', priority: 'medium',
  completed: false, isToday: false, completionCondition: emptyCC(),
  createdAt: new Date().toISOString(),
})

interface TaskModalProps {
  initial: Task | null
  onSave: (t: Task) => void
  onClose: () => void
}

const TaskModal: React.FC<TaskModalProps> = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState<Task>(initial ?? makeNewTask())
  const cc = form.completionCondition
  const preview = fmtCondition(cc)
  const setCC = (field: keyof CompletionCondition, v: string) =>
    setForm(f => ({ ...f, completionCondition: { ...f.completionCondition, [field]: v } }))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{initial ? 'タスクを編集' : 'タスクを追加'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              タスク名 <span className="text-red-400">*</span>
            </label>
            <input type="text" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="タスク名を入力..." autoFocus
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">期限日</label>
              <input type="date" value={form.dueDate}
                onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">優先度</label>
              <select value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-white"
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">完了条件</label>
            <div className="flex gap-2">
              <ConditionSelect label="動詞" options={VERB_OPTIONS}
                value={cc.verb} customValue={cc.verbCustom}
                onChange={v => setCC('verb', v)} onCustomChange={v => setCC('verbCustom', v)} />
              <ConditionSelect label="対象" options={TARGET_OPTIONS}
                value={cc.target} customValue={cc.targetCustom}
                onChange={v => setCC('target', v)} onCustomChange={v => setCC('targetCustom', v)} />
              <ConditionSelect label="状態" options={STATE_OPTIONS}
                value={cc.state} customValue={cc.stateCustom}
                onChange={v => setCC('state', v)} onCustomChange={v => setCC('stateCustom', v)} />
            </div>
            {preview && (
              <p className="mt-2.5 text-xs bg-gray-50 text-gray-600 rounded px-3 py-2">
                完了条件: <span className="font-medium text-gray-800">{preview}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
            キャンセル
          </button>
          <button onClick={() => form.title.trim() && onSave(form)} disabled={!form.title.trim()}
            className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {initial ? '保存' : '追加'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TaskCard
// ============================================================

interface TaskCardProps {
  task: Task
  onComplete: (id: string) => void
  onToday: (id: string) => void
  onEdit: (t: Task) => void
  onDelete: (id: string) => void
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onComplete, onToday, onEdit, onDelete }) => {
  const pc = PRIORITY_CONFIG[task.priority]
  const condition = fmtCondition(task.completionCondition)
  const overdue = !task.completed && isOverdue(task.dueDate)

  return (
    <div className={`bg-white border border-gray-200 rounded-md px-4 py-3 flex gap-3 items-start ${task.completed ? 'opacity-50' : ''}`}>
      <button onClick={() => onComplete(task.id)}
        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          task.completed ? 'bg-navy border-navy' : 'border-gray-300 hover:border-navy'
        }`}
      >
        {task.completed && <Check size={11} className="text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${task.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
            {task.title}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${pc.badge}`}>{pc.label}</span>
        </div>
        {condition && <p className="text-xs text-gray-400 mt-0.5 truncate">完了条件: {condition}</p>}
        {task.dueDate && (
          <div className={`flex items-center gap-1 mt-1 text-xs ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
            <Calendar size={11} />
            <span>{fmtDate(task.dueDate)}{overdue ? '（期限切れ）' : ''}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => onToday(task.id)}
          title={task.isToday ? '今日の3つから外す' : '今日の3つに追加'}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            task.isToday ? 'bg-navy text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >今日</button>
        <button onClick={() => onEdit(task)} className="p-1 text-gray-400 hover:text-gray-700"><Pencil size={14} /></button>
        <button onClick={() => onDelete(task.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
      </div>
    </div>
  )
}

// ============================================================
// GanttChart
// ============================================================

const GanttChart: React.FC<{ tasks: Task[] }> = ({ tasks }) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const withDates = tasks.filter(t => t.dueDate)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  // Compute date range from all task dates, padded around today
  const allMs = withDates.flatMap(t => [
    new Date(t.createdAt.split('T')[0] + 'T00:00:00').getTime(),
    new Date(t.dueDate + 'T00:00:00').getTime(),
  ])
  const rawMin = allMs.length ? Math.min(...allMs) : today.getTime()
  const rawMax = allMs.length ? Math.max(...allMs) : today.getTime()

  const winStart = new Date(Math.min(rawMin, today.getTime() - 14 * 86400000))
  const winEnd   = new Date(Math.max(rawMax, today.getTime() + 28 * 86400000))

  // Snap winStart to Monday
  const dow = winStart.getDay()
  winStart.setDate(winStart.getDate() - (dow === 0 ? 6 : dow - 1))

  const totalDays = Math.ceil((winEnd.getTime() - winStart.getTime()) / 86400000) + 7
  const chartWidth = totalDays * DAY_PX

  const dayOffset = (d: Date) =>
    Math.floor((d.getTime() - winStart.getTime()) / 86400000)

  const todayX = dayOffset(today) * DAY_PX

  // Weekly ruler marks (every Monday)
  const weeks: Date[] = []
  const cur = new Date(winStart)
  while (cur.getTime() <= winEnd.getTime() + 7 * 86400000) {
    weeks.push(new Date(cur)); cur.setDate(cur.getDate() + 7)
  }

  // Scroll to show today near left after render
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayX - 120)
    }
  }, [todayX])

  if (withDates.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg py-12 text-center text-gray-400 text-sm">
        期限日が設定されたタスクがありません
      </div>
    )
  }

  const ROW_H = 44

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex">
        {/* Fixed left: task name column */}
        <div className="w-44 flex-shrink-0 border-r border-gray-100 bg-white">
          <div className="h-9 bg-gray-50 border-b border-gray-200" />
          {withDates.map(task => (
            <div key={task.id}
              className={`flex items-center gap-1.5 px-3 border-b border-gray-100 ${task.completed ? 'opacity-40' : ''}`}
              style={{ height: ROW_H }}
            >
              {task.isToday && (
                <span className="w-1.5 h-1.5 rounded-full bg-navy flex-shrink-0" title="今日の3つ" />
              )}
              <span className="text-xs text-gray-700 truncate">{task.title}</span>
            </div>
          ))}
        </div>

        {/* Scrollable chart */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto">
          <div style={{ width: chartWidth }}>

            {/* Date ruler */}
            <div className="relative h-9 bg-gray-50 border-b border-gray-200">
              {weeks.map((w, i) => (
                <div key={i}
                  className="absolute top-0 bottom-0 flex items-center border-l border-gray-200"
                  style={{ left: dayOffset(w) * DAY_PX }}
                >
                  <span className="text-xs text-gray-400 pl-1.5 whitespace-nowrap">
                    {w.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>

            {/* Task rows */}
            <div className="relative">
              {/* Week grid lines */}
              {weeks.map((w, i) => (
                <div key={i} className="absolute top-0 bottom-0 border-l border-gray-100"
                  style={{ left: dayOffset(w) * DAY_PX }} />
              ))}

              {/* Today marker */}
              <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10 opacity-75"
                style={{ left: todayX }} />

              {/* Task bars */}
              {withDates.map(task => {
                const start = new Date(task.createdAt.split('T')[0] + 'T00:00:00')
                const end   = new Date(task.dueDate + 'T00:00:00')
                const x     = Math.max(0, dayOffset(start)) * DAY_PX
                const endX  = Math.max(x + DAY_PX, dayOffset(end) * DAY_PX)
                const barW  = endX - x
                const pc    = PRIORITY_CONFIG[task.priority]
                const overdue = !task.completed && isOverdue(task.dueDate)

                return (
                  <div key={task.id}
                    className="relative border-b border-gray-100 flex items-center"
                    style={{ height: ROW_H }}
                  >
                    {/* Main bar */}
                    <div
                      className={`absolute h-6 rounded flex items-center ${task.completed ? pc.barDone + ' opacity-50' : pc.bar}`}
                      style={{ left: x, width: barW }}
                      title={`${task.title}　期限: ${fmtDate(task.dueDate)}`}
                    >
                      {task.completed && <Check size={11} className="ml-1.5 text-gray-600 flex-shrink-0" />}
                    </div>
                    {/* Overdue right-edge marker */}
                    {overdue && (
                      <div className="absolute w-1.5 h-6 bg-red-600 rounded-r opacity-70 z-10"
                        style={{ left: endX - 6 }} />
                    )}
                    {/* Due date label */}
                    <span className={`absolute text-xs whitespace-nowrap ${overdue ? 'text-red-500' : 'text-gray-400'}`}
                      style={{ left: endX + 4 }}
                    >
                      {fmtDate(task.dueDate)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <div className="w-0.5 h-4 bg-red-400 opacity-75" />
          <span>今日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-navy" />
          <span>今日の3つに選択中</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-4 bg-red-600 rounded opacity-70" />
          <span>期限切れ</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TeachingsModal — ノイマンの教え
// ============================================================

const TeachingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-navy" />
          <h2 className="font-semibold text-gray-800">ノイマンの教え</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
      </div>
      <div className="px-6 py-5 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full">教え 1</span>
            <h3 className="font-semibold text-gray-800">今日の3つ</h3>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            1日に「今日やる」として選ぶタスクは<strong>最大3つ</strong>。
            4つ目は入れない。優先順位を強制的に明確にし、
            完了の達成感を毎日積み重ねるための原則。
          </p>
        </div>
        <hr className="border-gray-100" />
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full">教え 3</span>
            <h3 className="font-semibold text-gray-800">やらないことリスト</h3>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            「今週はやらないこと」を意図的に3つ決める。
            やることを絞るのではなく、<strong>やらないことを先に決める</strong>ことで、
            本当に大切な仕事への集中密度を高める。
          </p>
        </div>
      </div>
      <div className="flex justify-end px-6 py-4 border-t border-gray-100">
        <button onClick={onClose}
          className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark"
        >閉じる</button>
      </div>
    </div>
  </div>
)

// ============================================================
// Confirm/Alert Dialog (shared)
// ============================================================

interface DialogProps {
  icon: React.ReactNode; iconColor: string
  title: string; body: string
  confirmLabel: string; confirmClass: string
  onConfirm: () => void; onCancel: () => void
}

const Dialog: React.FC<DialogProps> = ({
  icon, iconColor, title, body, confirmLabel, confirmClass, onConfirm, onCancel,
}) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
      <div className="flex items-start gap-3 mb-5">
        <span className={`flex-shrink-0 mt-0.5 ${iconColor}`}>{icon}</span>
        <div>
          <p className="text-sm font-medium text-gray-800">{title}</p>
          <p className="text-xs text-gray-500 mt-1">{body}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          キャンセル
        </button>
        <button onClick={onConfirm} className={`px-4 py-2 text-sm rounded-md ${confirmClass}`}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
)

// ============================================================
// Main App
// ============================================================

export default function App() {
  const [tasks, setTasks]             = useState<Task[]>([])
  const [wontDo, setWontDo]           = useState<WontDoItem[]>([])
  const [filter, setFilter]           = useState<Filter>('all')
  const [viewMode, setViewMode]       = useState<ViewMode>('list')
  const [showModal, setShowModal]     = useState(false)
  const [editTask, setEditTask]       = useState<Task | null>(null)
  const [deleteId, setDeleteId]       = useState<string | null>(null)
  const [todayWarn, setTodayWarn]     = useState(false)
  const [showTeachings, setShowTeachings] = useState(false)
  const [wontDoInput, setWontDoInput] = useState('')

  useEffect(() => {
    const data = loadData(); setTasks(data.tasks); setWontDo(data.wontDoItems)
  }, [])

  useEffect(() => { saveData({ tasks, wontDoItems: wontDo }) }, [tasks, wontDo])

  // Derived
  const todayTasks       = tasks.filter(t => t.isToday)
  const todayActiveCount = todayTasks.filter(t => !t.completed).length

  const allSectionTasks = tasks.filter(t => {
    if (t.isToday) return false
    switch (filter) {
      case 'today':    return !!t.dueDate && isToday(t.dueDate)
      case 'thisWeek': return !!t.dueDate && isThisWeek(t.dueDate)
      case 'overdue':  return !t.completed && !!t.dueDate && isOverdue(t.dueDate)
      default:         return true
    }
  })

  // Handlers
  const handleSave = (task: Task) => {
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === task.id)
      return idx >= 0 ? prev.map(t => t.id === task.id ? task : t) : [...prev, task]
    })
    setShowModal(false); setEditTask(null)
  }

  const handleComplete = (id: string) =>
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t))

  const handleToday = (id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    if (!task.isToday && todayActiveCount >= MAX_TODAY) { setTodayWarn(true); return }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isToday: !t.isToday } : t))
  }

  const handleEdit = (task: Task) => { setEditTask(task); setShowModal(true) }

  const handleDeleteConfirm = () => {
    if (deleteId) { setTasks(prev => prev.filter(t => t.id !== deleteId)); setDeleteId(null) }
  }

  const handleAddWontDo = () => {
    if (!wontDoInput.trim() || wontDo.length >= MAX_WONT_DO) return
    setWontDo(prev => [...prev, { id: genId(), text: wontDoInput.trim() }])
    setWontDoInput('')
  }

  const dateLabel = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* ===== Header ===== */}
      <header className="bg-navy text-white px-6 py-4 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-wide">ノイマン式タスク管理</h1>
            <p className="text-xs text-blue-200 mt-0.5">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {/* ノイマンの教え */}
            <button
              onClick={() => setShowTeachings(true)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors"
              title="ノイマンの教えを見る"
            >
              <BookOpen size={14} />
              <span className="hidden sm:inline">ノイマンの教え</span>
            </button>
            {/* View toggle */}
            <div className="flex rounded-md overflow-hidden border border-white/20">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-sm transition-colors ${
                  viewMode === 'list' ? 'bg-white/25' : 'hover:bg-white/10'
                }`}
                title="リスト表示"
              >
                <List size={14} />
                <span className="hidden sm:inline text-xs">リスト</span>
              </button>
              <button
                onClick={() => setViewMode('gantt')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-sm transition-colors border-l border-white/20 ${
                  viewMode === 'gantt' ? 'bg-white/25' : 'hover:bg-white/10'
                }`}
                title="ガントチャート表示"
              >
                <BarChart2 size={14} />
                <span className="hidden sm:inline text-xs">ガント</span>
              </button>
            </div>
            {/* CSV */}
            <button
              onClick={() => handleExportCSV(tasks)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors"
            >
              <Download size={14} />
              <span className="hidden sm:inline">CSV</span>
            </button>
            {/* Add task */}
            <button
              onClick={() => { setEditTask(null); setShowModal(true) }}
              className="flex items-center gap-1.5 text-sm bg-white text-navy font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">タスクを追加</span>
              <span className="sm:hidden">追加</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* ===== Gantt View ===== */}
        {viewMode === 'gantt' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-800">ガントチャート</h2>
                <p className="text-xs text-gray-500 mt-0.5">全タスクの期限・進捗を時系列で確認</p>
              </div>
            </div>
            <GanttChart tasks={tasks} />
          </section>
        )}

        {/* ===== List View ===== */}
        {viewMode === 'list' && (
          <>
            {/* 今日の3つ */}
            <section className="bg-gray-100 rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-gray-800">今日の3つ</h2>
                  <p className="text-xs text-gray-500 mt-0.5">今日やる最重要タスク（最大3つ）</p>
                </div>
                <span className={`text-sm font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                  todayActiveCount >= MAX_TODAY ? 'bg-red-100 text-red-600' : 'bg-navy/10 text-navy'
                }`}>
                  {todayActiveCount} / {MAX_TODAY}
                </span>
              </div>
              {todayTasks.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  タスクカードの「今日」ボタンで追加できます
                </div>
              ) : (
                <div className="space-y-2">
                  {todayTasks.map(task => (
                    <TaskCard key={task.id} task={task}
                      onComplete={handleComplete} onToday={handleToday}
                      onEdit={handleEdit} onDelete={id => setDeleteId(id)} />
                  ))}
                </div>
              )}
            </section>

            {/* 全タスク */}
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <h2 className="font-semibold text-gray-800">全タスク</h2>
                <div className="flex gap-1 flex-wrap">
                  {([
                    { key: 'all'      as Filter, label: 'すべて' },
                    { key: 'today'    as Filter, label: '今日' },
                    { key: 'thisWeek' as Filter, label: '今週' },
                    { key: 'overdue'  as Filter, label: '期限切れ' },
                  ]).map(f => (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                      className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                        filter === f.key ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >{f.label}</button>
                  ))}
                </div>
              </div>
              {allSectionTasks.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">タスクがありません</div>
              ) : (
                <div className="space-y-2">
                  {allSectionTasks.map(task => (
                    <TaskCard key={task.id} task={task}
                      onComplete={handleComplete} onToday={handleToday}
                      onEdit={handleEdit} onDelete={id => setDeleteId(id)} />
                  ))}
                </div>
              )}
            </section>

            {/* 今週やらないこと */}
            <section className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-gray-800">今週やらないこと</h2>
                  <p className="text-xs text-gray-500 mt-0.5">意図的に手放すことで集中力を高める</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{wontDo.length} / {MAX_WONT_DO}</span>
              </div>
              {wontDo.length > 0 && (
                <div className="divide-y divide-gray-100 mb-3">
                  {wontDo.map(item => (
                    <div key={item.id} className="flex items-center gap-3 py-2.5">
                      <span className="flex-1 text-sm text-gray-700">{item.text}</span>
                      <button onClick={() => setWontDo(prev => prev.filter(i => i.id !== item.id))}
                        className="text-gray-300 hover:text-red-400 p-0.5 flex-shrink-0"
                      ><X size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
              {wontDo.length < MAX_WONT_DO ? (
                <div className={`flex gap-2 ${wontDo.length > 0 ? 'pt-1' : ''}`}>
                  <input type="text" value={wontDoInput}
                    onChange={e => setWontDoInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddWontDo()}
                    placeholder="やらないことを入力..."
                    className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                  <button onClick={handleAddWontDo} disabled={!wontDoInput.trim()}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 disabled:opacity-40"
                  >追加</button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center pt-1">上限（3つ）に達しました</p>
              )}
            </section>
          </>
        )}
      </main>

      {/* ===== Modals / Dialogs ===== */}

      {showModal && (
        <TaskModal initial={editTask} onSave={handleSave}
          onClose={() => { setShowModal(false); setEditTask(null) }} />
      )}

      {showTeachings && <TeachingsModal onClose={() => setShowTeachings(false)} />}

      {deleteId && (
        <Dialog icon={<AlertTriangle size={20} />} iconColor="text-red-500"
          title="タスクを削除しますか？" body="この操作は元に戻せません。"
          confirmLabel="削除する" confirmClass="bg-red-500 text-white hover:bg-red-600"
          onConfirm={handleDeleteConfirm} onCancel={() => setDeleteId(null)} />
      )}

      {todayWarn && (
        <Dialog icon={<AlertTriangle size={20} />} iconColor="text-yellow-500"
          title="「今日の3つ」は上限に達しています"
          body="今日やるタスクは3つまでです。既存のタスクを外してから追加してください。"
          confirmLabel="わかりました" confirmClass="bg-navy text-white hover:bg-navy-dark"
          onConfirm={() => setTodayWarn(false)} onCancel={() => setTodayWarn(false)} />
      )}
    </div>
  )
}
