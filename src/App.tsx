import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  Plus, Pencil, Trash2, Check, Calendar, Download,
  AlertTriangle, X, BookOpen, Users, FileSpreadsheet, List, BarChart2,
  History, RotateCcw, Star, StarOff,
  Cloud, CloudOff, Eye, EyeOff, Pin, PinOff, ClipboardList, TrendingUp,
} from 'lucide-react'

// ============================================================
// Types
// ============================================================

type Priority    = 'high' | 'medium' | 'low'
type ViewMode    = 'list' | 'gantt'
type BoardGroupMode = 'assignee' | 'priority' | 'due'
type DueGroup = 'overdue' | 'today' | 'thisWeek' | 'later' | 'noDate' | 'completed'

interface MiniStep {
  id: string
  text: string
  done: boolean
}

interface Issue {
  text: string
}

interface Task {
  id: string
  title: string
  memo: string              // フリーメモ
  dueDate: string           // 'YYYY-MM-DD'
  dueTime: '' | 'AM' | 'PM'
  priority: Priority
  completed: boolean
  completedAt: string | null  // 完了日時（ISO）
  isToday: boolean
  pinned: boolean
  assignee: string
  miniSteps: MiniStep[]
  issue: Issue
  createdAt: string
}

type HistoryAction =
  | 'created' | 'updated' | 'deleted'
  | 'completed' | 'uncompleted'
  | 'todayAdded' | 'todayRemoved'
  | 'pinned' | 'unpinned'
  | 'autoDeleted'

interface HistoryEntry {
  id: string
  timestamp: string     // ISO
  action: HistoryAction
  taskId: string
  taskTitle: string
  detail?: string       // 補足情報
}

interface AppData {
  tasks: Task[]
  history: HistoryEntry[]
  columnOrder: string[]   // 宛先列の表示順
}

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'disconnected'

interface AppSettings {
  githubToken: string
  gistId: string
  lastSynced: string | null
}

interface TaskTemplate {
  id: string
  title: string
  description: string
  task: Pick<Task, 'title' | 'memo' | 'priority' | 'miniSteps' | 'issue'>
}

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY      = 'task-app-data'
const SETTINGS_KEY     = 'task-app-settings'
const GIST_FILENAME    = 'neumann-task-app.json'
const MAX_TODAY        = 3
const COMPLETED_HIDE_DAYS = 7
const MIN_MINI_STEPS = 3
const DAY_PX = 28

// 操作種別ごとの表示設定
const ACTION_CONFIG: Record<HistoryAction, { label: string; icon: React.ReactNode; color: string }> = {
  created:       { label: '追加',         icon: <Plus size={13}/>,       color: 'text-green-600 bg-green-50' },
  updated:       { label: '編集',         icon: <Pencil size={13}/>,     color: 'text-blue-600 bg-blue-50' },
  deleted:       { label: '削除',         icon: <Trash2 size={13}/>,     color: 'text-red-600 bg-red-50' },
  completed:     { label: '完了',         icon: <Check size={13}/>,      color: 'text-navy bg-navy/10' },
  uncompleted:   { label: '完了解除',     icon: <RotateCcw size={13}/>,  color: 'text-gray-600 bg-gray-100' },
  todayAdded:    { label: '今日に追加',   icon: <Star size={13}/>,       color: 'text-yellow-600 bg-yellow-50' },
  todayRemoved:  { label: '今日から除外', icon: <StarOff size={13}/>,    color: 'text-gray-500 bg-gray-100' },
  pinned:        { label: 'ピン留め',     icon: <Pin size={13}/>,        color: 'text-sky-600 bg-sky-50' },
  unpinned:      { label: 'ピン解除',     icon: <PinOff size={13}/>,     color: 'text-gray-500 bg-gray-100' },
  autoDeleted:   { label: '棚卸削除',     icon: <Trash2 size={13}/>,     color: 'text-red-600 bg-red-50' },
}
const DEFAULT_ASSIGNEE = '自分'

const PRIORITY_CONFIG: Record<Priority, { label: string; badge: string; bar: string; barDone: string }> = {
  high:   { label: '高', badge: 'bg-red-100 text-red-700',       bar: 'bg-red-300',    barDone: 'bg-red-200' },
  medium: { label: '中', badge: 'bg-yellow-100 text-yellow-700', bar: 'bg-yellow-300', barDone: 'bg-yellow-200' },
  low:    { label: '低', badge: 'bg-gray-100 text-gray-500',     bar: 'bg-gray-300',   barDone: 'bg-gray-200' },
}
const PRIORITY_ORDER: Priority[] = ['high', 'medium', 'low']
const DUE_GROUPS: DueGroup[] = ['overdue', 'today', 'thisWeek', 'later', 'noDate', 'completed']
const DUE_GROUP_LABELS: Record<DueGroup, string> = {
  overdue: '期限切れ',
  today: '今日',
  thisWeek: '今週',
  later: '今後',
  noDate: '期限なし',
  completed: '完了済み',
}

const TEACHINGS = [
  { num: '①', title: '入口を減らす',       principle: '並行作業を減らすべし。',          example: '現在進行中のタスク数に厳格な上限を設け、それ以外の依頼は一旦別のストック場所に置く。' },
  { num: '②', title: '制約を先に固定する', principle: '迷いを遮断すべし。',              example: '「今日はこの領域以外には手を出さない」といった制約を最初に設定し、判断の計算資源を節約する。' },
  { num: '③', title: '他者の頭脳を組み込む', principle: '自分一人で完結させないべし。', example: '6割程度の思考ができた段階で他者に共有し、前提のズレや抜け漏れを早い段階で指摘してもらう。' },
]

const makeTemplateSteps = (texts: string[]): MiniStep[] =>
  texts.map((text, i) => ({ id: `template-step-${i}`, text, done: false }))

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'request-review',
    title: '確認依頼',
    description: '相手に見てほしい資料や判断を渡す',
    task: {
      title: '確認依頼を送る',
      memo: '誰に: \n何を: \nどの段階まで: 判断できる状態まで\nどうする: 確認依頼する',
      priority: 'medium',
      miniSteps: makeTemplateSteps(['確認してほしい対象を1つに絞る', '相手に見てほしい観点を書く', '期限と返答方法を添えて送る']),
      issue: { text: '相手が最短で判断できる問いは何か' },
    },
  },
  {
    id: 'meeting-follow',
    title: '会議後フォロー',
    description: '会議後の抜け漏れを防ぐ',
    task: {
      title: '会議後フォローを完了する',
      memo: '誰に: 参加者\n何を: 決定事項と次アクション\nどの段階まで: 各担当が動ける状態まで\nどうする: 共有する',
      priority: 'high',
      miniSteps: makeTemplateSteps(['決定事項を3行で書く', '担当者と期限を入れる', '参加者に共有して確認を取る']),
      issue: { text: '次に止まりそうな論点は何か' },
    },
  },
  {
    id: 'proposal-draft',
    title: '企画作成',
    description: '白紙の企画を小さく進める',
    task: {
      title: '企画の初稿を作る',
      memo: '誰に: \n何を: 企画初稿\nどの段階まで: レビューに出せる状態まで\nどうする: 作成する',
      priority: 'medium',
      miniSteps: makeTemplateSteps(['目的と対象者を1文で書く', '解決する課題を3つ出す', '初稿を作ってレビュー依頼する']),
      issue: { text: 'この企画が解く本質的な問いは何か' },
    },
  },
]

// ============================================================
// Utilities
// ============================================================

const genId    = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}`
// ローカル日付を使う（toISOStringはUTCなのでタイムゾーンのズレが生じる）
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const isToday  = (d: string) => d === todayStr()

const isThisWeek = (d: string): boolean => {
  if (!d) return false
  const date = new Date(d+'T00:00:00')
  const now = new Date(); now.setHours(0,0,0,0)
  const dow = now.getDay()
  const mon = new Date(now); mon.setDate(now.getDate()-(dow===0?6:dow-1))
  const sun = new Date(mon); sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,999)
  return date >= mon && date <= sun
}

const isOverdue  = (d: string) => !!d && d < todayStr()

const fmtDate = (d: string) =>
  d ? new Date(d+'T00:00:00').toLocaleDateString('ja-JP',{month:'short',day:'numeric'}) : ''

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})

const addDaysStr = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const endOfWeekStr = () => {
  const d = new Date()
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const getDueGroup = (task: Task): DueGroup => {
  if (task.completed) return 'completed'
  if (!task.dueDate) return 'noDate'
  if (isOverdue(task.dueDate)) return 'overdue'
  if (isToday(task.dueDate)) return 'today'
  if (isThisWeek(task.dueDate)) return 'thisWeek'
  return 'later'
}

const applyDueGroup = (task: Task, group: DueGroup): Task => {
  if (group === 'completed') {
    return { ...task, completed: true, completedAt: task.completedAt ?? new Date().toISOString() }
  }
  const dueDate =
    group === 'overdue' ? addDaysStr(-1) :
    group === 'today' ? todayStr() :
    group === 'thisWeek' ? endOfWeekStr() :
    group === 'later' ? addDaysStr(7) :
    ''
  return { ...task, completed: false, completedAt: null, dueDate }
}

const extractFirstMatch = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return ''
}

const inferCompletionCondition = (task: Pick<Task, 'title'|'memo'|'assignee'>) => {
  const text = `${task.title}\n${task.memo}`.trim()
  const who = task.assignee || DEFAULT_ASSIGNEE
  const what = extractFirstMatch(text, [
    /(?:何を|対象|成果物|内容)[:：]\s*([^\n]+)/i,
    /(.+?)(?:を|について)(?:作成|共有|確認|連絡|送付|提出|完了|整理|レビュー|依頼)/,
  ]) || task.title.trim()
  const stage = extractFirstMatch(text, [
    /(?:どの段階まで|段階|状態|完了条件)[:：]\s*([^\n]+)/i,
    /(?:までに|まで)\s*([^\n]+)/,
  ]) || '完了扱いにできる段階まで'
  const action = extractFirstMatch(text, [
    /(?:どうする|対応|アクション)[:：]\s*([^\n]+)/i,
    /(作成|共有|確認|連絡|送付|提出|完了|整理|レビュー|依頼|更新|調整|回答)(?:する|して|$)/,
  ]) || '進める'

  return { who, what, stage, action }
}

const fmtCondition = (task: Pick<Task, 'title'|'memo'|'assignee'>) => {
  const c = inferCompletionCondition(task)
  return `${c.who}に、${c.what}を、${c.stage}、${c.action}`
}

const emptyMiniSteps = (): MiniStep[] =>
  Array.from({ length: MIN_MINI_STEPS }, () => ({ id: genId(), text: '', done: false }))

const normalizeMiniSteps = (steps: unknown): MiniStep[] => {
  const list = Array.isArray(steps)
    ? steps.map((s, i) => {
        const step = s as Partial<MiniStep>
        return {
          id: step.id || `${genId()}-${i}`,
          text: step.text ?? '',
          done: !!step.done,
        }
      })
    : []
  while (list.length < MIN_MINI_STEPS) list.push({ id: genId(), text: '', done: false })
  return list
}

const ISSUE_CRITERIA = [
  '本質的な問い',
  '深い仮説',
  '答えが出せること',
]

const emptyIssue = (): Issue => ({ text: '' })

const normalizeIssue = (issue: unknown): Issue => {
  const raw = (issue ?? {}) as Partial<Issue>
  return {
    text: raw.text ?? '',
  }
}

const normalizeTask = (t: Partial<Task>): Task => ({
  id: t.id ?? genId(),
  title: t.title ?? '',
  memo: t.memo ?? '',
  dueDate: t.dueDate ?? '',
  dueTime: t.dueTime ?? '',
  priority: t.priority ?? 'medium',
  completed: !!t.completed,
  completedAt: t.completedAt ?? null,
  isToday: !!t.isToday,
  pinned: !!t.pinned,
  assignee: t.assignee ?? DEFAULT_ASSIGNEE,
  miniSteps: normalizeMiniSteps((t as { miniSteps?: unknown }).miniSteps),
  issue: normalizeIssue((t as { issue?: unknown }).issue),
  createdAt: t.createdAt ?? new Date().toISOString(),
})

const getCurrentMiniStep = (task: Task) => {
  const steps = normalizeMiniSteps(task.miniSteps).filter(s => s.text.trim())
  if (!steps.length) return null
  const idx = steps.findIndex(s => !s.done)
  const currentIndex = idx >= 0 ? idx : steps.length - 1
  return { step: steps[currentIndex], index: currentIndex + 1, total: steps.length, allDone: idx < 0 }
}

const sortTasksForWork = (items: Task[]) => [...items].sort((a, b) => {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.completed !== b.completed) return a.completed ? 1 : -1
  const aDue = a.dueDate || '9999-12-31'
  const bDue = b.dueDate || '9999-12-31'
  if (aDue !== bDue) return aDue.localeCompare(bDue)
  return a.createdAt.localeCompare(b.createdAt)
})

const isHiddenCompletedTask = (task: Task) => {
  if (!task.completed || !task.completedAt) return false
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - COMPLETED_HIDE_DAYS)
  return new Date(task.completedAt) < cutoff
}

// ============================================================
// localStorage
// ============================================================

const loadData = (): AppData => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tasks: [], history: [], columnOrder: [] }
    const data = JSON.parse(raw) as AppData
    data.history     = data.history     ?? []   // 後方互換
    data.columnOrder = data.columnOrder ?? []   // 後方互換
    data.tasks = (data.tasks ?? []).map(t => normalizeTask(t))
    return data
  } catch { return { tasks: [], history: [], columnOrder: [] } }
}

const saveData = (data: AppData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

// ============================================================
// Settings（Gist連携設定）
// ============================================================

const defaultSettings = (): AppSettings => ({ githubToken: '', gistId: '', lastSynced: null })

const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings()
  } catch { return defaultSettings() }
}

const saveSettings = (s: AppSettings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))

// ============================================================
// GitHub Gist API
// ============================================================

const GIST_HEADERS = (token: string) => ({
  Authorization: `token ${token}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.github.v3+json',
})

/** トークンを検証し、GitHubユーザー名を返す（無効なら null） */
async function gistValidateToken(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/user', { headers: GIST_HEADERS(token) })
    if (!res.ok) return null
    const user = await res.json()
    return user.login ?? null
  } catch { return null }
}

/** Gistからデータを取得する */
async function gistLoad(token: string, gistId: string): Promise<AppData | null> {
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: GIST_HEADERS(token) })
    if (!res.ok) return null
    const gist = await res.json()
    const content = gist.files?.[GIST_FILENAME]?.content
    return content ? JSON.parse(content) as AppData : null
  } catch { return null }
}

/** Gistにデータを保存し、Gist ID を返す（初回は自動作成） */
async function gistSave(token: string, gistId: string, data: AppData): Promise<string> {
  const body = JSON.stringify({
    description: 'ADHD専用タスク管理 - 自動バックアップ',
    public: false,
    files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } },
  })
  const headers = GIST_HEADERS(token)

  if (gistId) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { method: 'PATCH', headers, body })
    if (!res.ok) throw new Error('Gist update failed')
    return gistId
  } else {
    const res = await fetch('https://api.github.com/gists', { method: 'POST', headers, body })
    if (!res.ok) throw new Error('Gist create failed')
    const gist = await res.json()
    return gist.id as string
  }
}

// ============================================================
// Export functions
// ============================================================

const toExportRow = (t: Task) => ({
  'タイトル':    t.title,
  '宛先':        t.assignee,
  'メモ':        t.memo,
  '優先度':      PRIORITY_CONFIG[t.priority].label,
  '期限':        t.dueDate,
  '時間帯':      t.dueTime,
  '完了':        t.completed ? '完了' : '未完了',
  '完了日時':    t.completedAt ? fmtDateTime(t.completedAt) : '',
  '今日の3つ':   t.isToday ? 'はい' : 'いいえ',
  '完了条件':    fmtCondition(t),
  '現在ステップ': (() => {
    const current = getCurrentMiniStep(t)
    return current ? `${current.index}/${current.total} ${current.step.text}` : ''
  })(),
  'イシュー':    t.issue.text,
  'イシュー観点': ISSUE_CRITERIA.join(' / '),
  '作成日':      t.createdAt.split('T')[0],
})

const handleExportCSV = (tasks: Task[]) => {
  const rows = tasks.map(toExportRow)
  const headers = Object.keys(rows[0] ?? {})
  const csv = [headers, ...rows.map(r => headers.map(h => `"${String((r as Record<string,string>)[h] ?? '').replace(/"/g,'""')}"`))]
    .map(r=>r.join(',')).join('\n')
  const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=`tasks-${todayStr()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

const handleExportExcel = (tasks: Task[]) => {
  const rows = tasks.map(toExportRow)
  const ws = XLSX.utils.json_to_sheet(rows)
  // 列幅設定
  ws['!cols'] = [
    {wch:32},{wch:12},{wch:40},{wch:8},{wch:12},{wch:8},
    {wch:8},{wch:20},{wch:10},{wch:48},{wch:32},{wch:40},{wch:24},{wch:12},
  ]
  // ヘッダー行のスタイル（背景色）
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'タスク一覧')
  XLSX.writeFile(wb, `neumann-tasks-${todayStr()}.xlsx`)
}

// ============================================================
// TaskModal
// ============================================================

const makeNewTask = (): Task => ({
  id:genId(), title:'', memo:'', dueDate:'', dueTime:'', priority:'medium',
  completed:false, completedAt:null, isToday:false, assignee:DEFAULT_ASSIGNEE,
  pinned:false,
  miniSteps: emptyMiniSteps(), issue: emptyIssue(),
  createdAt: new Date().toISOString(),
})

interface TaskModalProps {
  initial: Task | null
  isDraft?: boolean
  knownAssignees: string[]
  onSave: (t: Task) => void
  onClose: () => void
}

const TaskModal: React.FC<TaskModalProps> = ({ initial, isDraft = false, knownAssignees, onSave, onClose }) => {
  const [form, setForm] = useState<Task>(initial ?? makeNewTask())
  const [assigneeMode, setAssigneeMode] = useState<'select'|'new'>(
    initial && !knownAssignees.includes(initial.assignee) ? 'new' : 'select'
  )
  const [newAssigneeDraft, setNewAssigneeDraft] = useState(
    initial && !knownAssignees.includes(initial.assignee) ? initial.assignee : ''
  )

  const effectiveAssignee = assigneeMode==='new' ? (newAssigneeDraft.trim() || DEFAULT_ASSIGNEE) : form.assignee
  const preview = fmtCondition({ ...form, assignee: effectiveAssignee })
  const miniSteps = normalizeMiniSteps(form.miniSteps)
  const setMiniStep = (id: string, patch: Partial<MiniStep>) =>
    setForm(p => ({ ...p, miniSteps: normalizeMiniSteps(p.miniSteps).map(s => s.id === id ? { ...s, ...patch } : s) }))
  const addMiniStep = () =>
    setForm(p => ({ ...p, miniSteps: [...normalizeMiniSteps(p.miniSteps), { id: genId(), text: '', done: false }] }))
  const removeMiniStep = (id: string) =>
    setForm(p => {
      const next = normalizeMiniSteps(p.miniSteps).filter(s => s.id !== id)
      return { ...p, miniSteps: normalizeMiniSteps(next) }
    })
  const setIssue = (patch: Partial<Issue>) =>
    setForm(p => ({ ...p, issue: { ...normalizeIssue(p.issue), ...patch } }))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{initial && !isDraft ? 'タスクを編集' : 'タスクを追加'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
        </div>
        <div className="px-6 py-5 space-y-4">

          {/* タスク名 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">タスク名 <span className="text-red-400">*</span></label>
            <input type="text" value={form.title} autoFocus
              onChange={e=>setForm(p=>({...p,title:e.target.value}))}
              placeholder="タスク名を入力..."
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"/>
          </div>

          {/* 宛先 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">宛先</label>
            <div className="flex gap-2">
              <select value={assigneeMode==='new'?'__new__':form.assignee}
                onChange={e=>{
                  if(e.target.value==='__new__'){setAssigneeMode('new');setForm(p=>({...p,assignee:newAssigneeDraft}))}
                  else{setAssigneeMode('select');setForm(p=>({...p,assignee:e.target.value}))}
                }}
                className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-white">
                {knownAssignees.map(a=><option key={a} value={a}>{a}</option>)}
                <option value="__new__">＋ 新しく追加...</option>
              </select>
              {assigneeMode==='new' && (
                <input type="text" value={newAssigneeDraft} autoFocus
                  onChange={e=>{setNewAssigneeDraft(e.target.value);setForm(p=>({...p,assignee:e.target.value}))}}
                  placeholder="例: 田中さん"
                  className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"/>
              )}
            </div>
          </div>

          {/* 期限日・時間帯・優先度 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">期限日・時間帯</label>
              <div className="flex gap-1.5">
                <input type="date" value={form.dueDate}
                  onChange={e=>setForm(p=>({...p,dueDate:e.target.value}))}
                  className="flex-1 min-w-0 border border-gray-200 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"/>
                <select value={form.dueTime} onChange={e=>setForm(p=>({...p,dueTime:e.target.value as Task['dueTime']}))}
                  className="w-20 border border-gray-200 rounded-md px-1 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-white">
                  <option value="">-</option><option value="AM">AM</option><option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">優先度</label>
              <select value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value as Priority}))}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-white">
                <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
              </select>
            </div>
          </div>

          {/* ミニステップ */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700">ミニステップ</label>
              <button type="button" onClick={addMiniStep}
                className="flex items-center gap-1 text-xs text-navy hover:text-navy-dark">
                <Plus size={13}/>ステップ追加
              </button>
            </div>
            <div className="space-y-2">
              {miniSteps.map((step, i) => (
                <div key={step.id} className="flex items-center gap-2">
                  <button type="button" onClick={()=>setMiniStep(step.id, { done: !step.done })}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      step.done ? 'bg-navy border-navy' : 'border-gray-300 hover:border-navy'
                    }`}>
                    {step.done && <Check size={11} className="text-white"/>}
                  </button>
                  <span className="text-xs text-gray-400 w-8 flex-shrink-0">#{i + 1}</span>
                  <input type="text" value={step.text}
                    onChange={e=>setMiniStep(step.id, { text: e.target.value })}
                    placeholder={`ステップ${i + 1}`}
                    className="flex-1 min-w-0 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"/>
                  {miniSteps.length > MIN_MINI_STEPS && (
                    <button type="button" onClick={()=>removeMiniStep(step.id)}
                      className="p-1 text-gray-300 hover:text-red-500">
                      <Trash2 size={14}/>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* メモ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">メモ</label>
            <textarea value={form.memo}
              onChange={e=>setForm(p=>({...p,memo:e.target.value}))}
              placeholder="補足・背景・リンクなど自由記述..."
              rows={4}
              className="w-full min-h-28 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy resize-y"/>
          </div>

          {/* イシュー */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">イシュー</label>
            <textarea value={form.issue.text}
              onChange={e=>setIssue({ text: e.target.value })}
              placeholder="このタスクで答えを出したい本質的な問い..."
              rows={2}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy resize-y"/>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {ISSUE_CRITERIA.map((label, i) => (
                <div key={label} className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 rounded px-2 py-2">
                  <span className="font-semibold text-navy flex-shrink-0">{i + 1}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 完了条件 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">完了条件（自動）</label>
            <p className="text-xs bg-gray-50 text-gray-600 rounded px-3 py-2 leading-relaxed">
              {preview}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">キャンセル</button>
          <button onClick={()=>form.title.trim()&&onSave(normalizeTask({...form,assignee:effectiveAssignee}))}
            disabled={!form.title.trim()}
            className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark disabled:opacity-40 disabled:cursor-not-allowed">
            {initial && !isDraft ? '保存' : '追加'}
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
  onComplete:(id:string)=>void; onToday:(id:string)=>void; onPin:(id:string)=>void
  onStepToggle:(taskId:string, stepId:string)=>void
  onEdit:(t:Task)=>void; onDelete:(id:string)=>void
  hideAssignee?: boolean
}

const TaskCard: React.FC<TaskCardProps> = ({task,onComplete,onToday,onPin,onStepToggle,onEdit,onDelete,hideAssignee=false}) => {
  const pc         = PRIORITY_CONFIG[task.priority]
  const cond       = fmtCondition(task)
  const overdue    = !task.completed && isOverdue(task.dueDate)
  const todayDue   = !task.completed && !!task.dueDate && isToday(task.dueDate)
  const visibleSteps = normalizeMiniSteps(task.miniSteps).filter(s => s.text.trim())
  const completedStepCount = visibleSteps.filter(s => s.done).length

  return (
    <div className={[
      'rounded-md overflow-hidden border-2 transition-all',
      task.completed       ? 'opacity-50 border-gray-200'            : '',
      todayDue             ? 'border-red-500 urgent-glow'            : (!task.completed ? 'border-gray-200' : ''),
    ].join(' ')}>

      {/* 今日締め切りバナー */}
      {todayDue && (
        <div className="flex items-center gap-2 bg-red-500 text-white text-sm font-bold px-4 py-2">
          <span className="animate-bounce inline-block text-base">🔥</span>
          今日が締め切りです！
          <span className="animate-bounce inline-block text-base">🔥</span>
        </div>
      )}

      <div className="bg-white px-4 py-3">
        {/* 上段：チェックボックス ＋ タイトル等 ＋ アクション */}
        <div className="flex gap-3 items-start">
          <button onClick={()=>onComplete(task.id)}
            className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              task.completed ? 'bg-navy border-navy' : 'border-gray-300 hover:border-navy'
            }`}>
            {task.completed && <Check size={11} className="text-white"/>}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={()=>onPin(task.id)}
                title={task.pinned?'ピン留めを外す':'ピン留めする'}
                className={`p-0.5 rounded transition-colors ${task.pinned?'text-sky-600 bg-sky-50':'text-gray-300 hover:text-sky-600 hover:bg-sky-50'}`}>
                <Pin size={13}/>
              </button>
              <span className={`text-sm font-medium ${task.completed?'line-through text-gray-400':todayDue?'text-red-700':'text-gray-800'}`}>
                {task.title}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${pc.badge}`}>{pc.label}</span>
              {!hideAssignee && task.assignee!==DEFAULT_ASSIGNEE && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-navy/10 text-navy flex-shrink-0">→ {task.assignee}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5 truncate">完了条件: {cond}</p>
            {task.issue.text && (
              <div className="mt-2 text-xs bg-amber-50 text-amber-800 rounded px-3 py-2 leading-relaxed">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold flex-shrink-0">Issue</span>
                  <span className="truncate flex-1">{task.issue.text}</span>
                </div>
              </div>
            )}
            {task.dueDate && (
              <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${
                todayDue ? 'text-red-600' : overdue ? 'text-red-500' : 'text-gray-400'
              }`}>
                <Calendar size={11}/>
                <span>{fmtDate(task.dueDate)}{task.dueTime?` ${task.dueTime}`:''}{overdue&&!todayDue?'（期限切れ）':''}</span>
              </div>
            )}
            {task.completed && task.completedAt && (
              <p className="text-xs text-gray-400 mt-1">✓ {fmtDateTime(task.completedAt)} に完了</p>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={()=>onToday(task.id)}
              title={task.isToday?'今日の3つから外す':'今日の3つに追加'}
              className={`text-xs px-2 py-1 rounded transition-colors ${task.isToday?'bg-navy text-white':'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              今日
            </button>
            <button onClick={()=>onEdit(task)} className="p-1 text-gray-400 hover:text-gray-700"><Pencil size={14}/></button>
            <button onClick={()=>onDelete(task.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14}/></button>
          </div>
        </div>

        {visibleSteps.length > 0 && (
          <div className="mt-3 rounded px-3 py-2 text-xs leading-relaxed bg-blue-50 text-blue-700">
            <div className="font-semibold mb-1">
              ステップ完了 {completedStepCount}/{visibleSteps.length}
            </div>
            <div className="space-y-0.5">
              {visibleSteps.map((step, i) => (
                <div key={step.id} className="flex items-start gap-1.5">
                  <button
                    type="button"
                    onClick={() => onStepToggle(task.id, step.id)}
                    title={step.done ? 'ステップを未完了にする' : 'ステップを完了にする'}
                    className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      step.done ? 'bg-navy border-navy text-white' : 'border-blue-300 bg-white hover:border-navy'
                    }`}
                  >
                    {step.done && <Check size={9}/>}
                  </button>
                  <span className={step.done ? 'line-through opacity-60' : ''}>
                    {i + 1}. {step.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* メモ：カード全幅で表示 */}
        {task.memo && (
          <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded px-3 py-2 whitespace-pre-wrap leading-relaxed">
            {task.memo}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// AssigneeColumns — DnD対応（列・カード両方）
// ============================================================

const COL_W = 360  // 列幅 (px)

interface AssigneeColsProps {
  tasks: Task[]
  groupMode: BoardGroupMode
  knownAssignees: string[]
  columnOrder: string[]
  onReorderTasks: (tasks: Task[]) => void
  onReorderColumns: (order: string[]) => void
  onComplete:(id:string)=>void; onToday:(id:string)=>void; onPin:(id:string)=>void
  onStepToggle:(taskId:string, stepId:string)=>void
  onEdit:(t:Task)=>void; onDelete:(id:string)=>void
}

const AssigneeCols: React.FC<AssigneeColsProps> = ({
  tasks, groupMode, knownAssignees, columnOrder,
  onReorderTasks, onReorderColumns,
  onComplete, onToday, onPin, onStepToggle, onEdit, onDelete,
}) => {
  const [dragTaskId,  setDragTaskId]  = useState<string|null>(null)
  const [dragColName, setDragColName] = useState<string|null>(null)
  const [dropTaskId,  setDropTaskId]  = useState<string|null>(null)
  const [dropColName, setDropColName] = useState<string|null>(null)
  const [dropPos,     setDropPos]     = useState<'before'|'after'>('after')

  // columnOrder に従って並べる（未登録は末尾に追加）
  const orderedAssignees = [
    ...columnOrder.filter(a => knownAssignees.includes(a)),
    ...knownAssignees.filter(a => !columnOrder.includes(a)),
  ]
  const orderedGroups = groupMode === 'priority' ? PRIORITY_ORDER : groupMode === 'due' ? DUE_GROUPS : orderedAssignees
  const orderIndex = new Map(orderedGroups.map((a, i) => [a, i]))
  const cols = orderedGroups
    .map(group => ({
      key: group,
      label: groupMode === 'priority' ? PRIORITY_CONFIG[group as Priority].label : groupMode === 'due' ? DUE_GROUP_LABELS[group as DueGroup] : group,
      tasks: sortTasksForWork(tasks.filter(t =>
        groupMode === 'priority' ? t.priority === group :
        groupMode === 'due' ? getDueGroup(t) === group :
        t.assignee === group
      )),
    }))
    .filter(c => c.tasks.length > 0)
    .sort((a, b) => {
      if (groupMode !== 'assignee') return (orderIndex.get(a.key) ?? 0) - (orderIndex.get(b.key) ?? 0)
      if (a.key === DEFAULT_ASSIGNEE) return -1
      if (b.key === DEFAULT_ASSIGNEE) return 1
      const activeDiff = b.tasks.filter(t => !t.completed).length - a.tasks.filter(t => !t.completed).length
      if (activeDiff !== 0) return activeDiff
      return (orderIndex.get(a.key) ?? 0) - (orderIndex.get(b.key) ?? 0)
    })

  const clear = () => {
    setDragTaskId(null); setDragColName(null)
    setDropTaskId(null); setDropColName(null)
  }

  // タスクをカード上にドロップ
  const dropOnTask = (targetId: string, targetGroup: string) => {
    if (!dragTaskId || dragTaskId === targetId) { clear(); return }
    const base = tasks.find(t => t.id === dragTaskId)!
    const dragged = groupMode === 'priority'
      ? { ...base, priority: targetGroup as Priority }
      : groupMode === 'due'
        ? applyDueGroup(base, targetGroup as DueGroup)
      : { ...base, assignee: targetGroup }
    const rest    = tasks.filter(t => t.id !== dragTaskId)
    let idx = rest.findIndex(t => t.id === targetId)
    if (dropPos === 'after') idx++
    rest.splice(idx, 0, dragged)
    onReorderTasks(rest)
    clear()
  }

  // タスクを列の空白にドロップ（列の末尾へ）
  const dropOnCol = (targetGroup: string) => {
    if (!dragTaskId) { clear(); return }
    const base = tasks.find(t => t.id === dragTaskId)!
    const dragged = groupMode === 'priority'
      ? { ...base, priority: targetGroup as Priority }
      : groupMode === 'due'
        ? applyDueGroup(base, targetGroup as DueGroup)
      : { ...base, assignee: targetGroup }
    onReorderTasks([...tasks.filter(t => t.id !== dragTaskId), dragged])
    clear()
  }

  // 列ヘッダーへドロップ（列の並び替え）
  const dropOnColHeader = (targetGroup: string) => {
    if (groupMode !== 'assignee') { clear(); return }
    if (!dragColName || dragColName === targetGroup) { clear(); return }
    const newOrder = [...orderedAssignees]
    newOrder.splice(newOrder.indexOf(dragColName), 1)
    newOrder.splice(newOrder.indexOf(targetGroup), 0, dragColName)
    onReorderColumns(newOrder)
    clear()
  }

  if (!cols.length) return (
    <div className="text-center py-12 text-gray-400 text-sm">タスクがありません</div>
  )

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
        {cols.map(({ key, label, tasks: colTasks }) => {
          const active       = colTasks.filter(t => !t.completed).length
          const isSelf       = groupMode === 'assignee' && key === DEFAULT_ASSIGNEE
          const isPriority   = groupMode === 'priority'
          const isDue        = groupMode === 'due'
          const isColTarget  = dropColName === key && !!dragColName && dragColName !== key
          const isDraggingCol = dragColName === key

          return (
            <div
              key={key}
              style={{ width: COL_W }}
              className={`flex-shrink-0 transition-opacity ${isDraggingCol ? 'opacity-30' : ''}`}
              onDragOver={e => { e.preventDefault(); if (dragTaskId) setDropColName(key) }}
              onDrop={() => { if (dragTaskId) dropOnCol(key) }}
            >
              {/* 列ヘッダー（ドラッグで列並び替え） */}
              <div
                draggable={groupMode === 'assignee'}
                onDragStart={e => { e.stopPropagation(); setDragColName(key); setDragTaskId(null) }}
                onDragEnd={clear}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropColName(key) }}
                onDrop={e => { e.stopPropagation(); dropOnColHeader(key) }}
                className={[
                  'flex items-center justify-between px-3 py-2.5 rounded-lg mb-2 select-none transition-all',
                  groupMode === 'assignee' ? 'cursor-grab' : '',
                  isPriority ? PRIORITY_CONFIG[key as Priority].badge : isDue ? 'bg-sky-50 border border-sky-200 text-sky-700' : isSelf ? 'bg-navy/10' : 'bg-amber-50 border border-amber-200',
                  isColTarget ? 'ring-2 ring-navy shadow-md' : '',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  {groupMode === 'assignee' && <span className="text-gray-300 text-base leading-none">⠿</span>}
                  {isPriority ? <BarChart2 size={13}/> : isDue ? <Calendar size={13}/> : <Users size={13} className={isSelf ? 'text-navy' : 'text-amber-600'} />}
                  <span className={`text-sm font-semibold ${isPriority || isDue ? '' : isSelf ? 'text-navy' : 'text-amber-700'}`}>
                    {isPriority ? `優先度 ${label}` : label}
                  </span>
                </div>
                <span className="text-xs text-gray-500 bg-white px-1.5 py-0.5 rounded-full">
                  {active}件
                </span>
              </div>

              {/* タスクカード一覧 */}
              <div className="space-y-1 min-h-[40px]">
                {colTasks.map(task => {
                  const isTarget  = dropTaskId === task.id && !!dragTaskId && dragTaskId !== task.id
                  const isDragging = dragTaskId === task.id

                  return (
                    <div key={task.id}>
                      {/* ドロップライン（前） */}
                      {isTarget && dropPos === 'before' && (
                        <div className="h-1 bg-navy/60 rounded mx-2 mb-1" />
                      )}

                      <div
                        draggable
                        onDragStart={e => { e.stopPropagation(); setDragTaskId(task.id); setDragColName(null) }}
                        onDragEnd={clear}
                        onDragOver={e => {
                          e.preventDefault(); e.stopPropagation()
                          if (!dragTaskId) return
                          setDropTaskId(task.id); setDropColName(null)
                          const r = e.currentTarget.getBoundingClientRect()
                          setDropPos(e.clientY < r.top + r.height / 2 ? 'before' : 'after')
                        }}
                        onDrop={e => { e.stopPropagation(); dropOnTask(task.id, key) }}
                        className={`transition-opacity cursor-grab ${isDragging ? 'opacity-25' : ''}`}
                      >
                        <TaskCard task={task} hideAssignee={groupMode === 'assignee'}
                          onComplete={onComplete} onToday={onToday} onPin={onPin}
                          onStepToggle={onStepToggle}
                          onEdit={onEdit} onDelete={onDelete} />
                      </div>

                      {/* ドロップライン（後） */}
                      {isTarget && dropPos === 'after' && (
                        <div className="h-1 bg-navy/60 rounded mx-2 mt-1" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// GanttChart
// ============================================================

const GanttChart: React.FC<{tasks:Task[]}> = ({tasks}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const withDates = sortTasksForWork(tasks.filter(t=>t.dueDate))
  const today = new Date(); today.setHours(0,0,0,0)
  const allMs = withDates.flatMap(t=>[
    new Date(t.createdAt.split('T')[0]+'T00:00:00').getTime(),
    new Date(t.dueDate+'T00:00:00').getTime(),
  ])
  const rawMin = allMs.length?Math.min(...allMs):today.getTime()
  const rawMax = allMs.length?Math.max(...allMs):today.getTime()
  const winStart = new Date(Math.min(rawMin,today.getTime()-14*86400000))
  const winEnd   = new Date(Math.max(rawMax,today.getTime()+28*86400000))
  const dow = winStart.getDay(); winStart.setDate(winStart.getDate()-(dow===0?6:dow-1))
  const totalDays = Math.ceil((winEnd.getTime()-winStart.getTime())/86400000)+7
  const chartWidth = totalDays*DAY_PX
  const dayOffset = (d:Date) => Math.floor((d.getTime()-winStart.getTime())/86400000)
  const todayX = dayOffset(today)*DAY_PX
  const weeks: Date[] = []
  const cur = new Date(winStart)
  while(cur.getTime()<=winEnd.getTime()+7*86400000){weeks.push(new Date(cur));cur.setDate(cur.getDate()+7)}
  useEffect(()=>{if(scrollRef.current)scrollRef.current.scrollLeft=Math.max(0,todayX-120)},[todayX])
  if(!withDates.length) return <div className="bg-white border border-gray-200 rounded-lg py-12 text-center text-gray-400 text-sm">期限日が設定されたタスクがありません</div>
  const ROW_H = 52
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex">
        <div className="w-64 flex-shrink-0 border-r border-gray-100 bg-white">
          <div className="h-9 bg-gray-50 border-b border-gray-200"/>
          {withDates.map(task=>{
            const td = !task.completed&&!!task.dueDate&&isToday(task.dueDate)
            const current = getCurrentMiniStep(task)
            return (
              <div key={task.id} className={`px-3 border-b border-gray-100 flex flex-col justify-center ${task.completed?'opacity-40':''} ${td?'bg-red-50':''}`} style={{height:ROW_H}}>
                <div className="flex items-center gap-1.5 min-w-0">
                  {task.isToday&&<span className="w-1.5 h-1.5 rounded-full bg-navy flex-shrink-0"/>}
                  {td&&<span className="text-red-500 flex-shrink-0">!</span>}
                  <span className={`text-xs truncate ${td?'text-red-700 font-semibold':'text-gray-700'}`}>{task.title}</span>
                </div>
                {current && <span className="text-[11px] text-gray-400 truncate">Step {current.index}/{current.total}: {current.step.text}</span>}
              </div>
            )
          })}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-x-auto">
          <div style={{width:chartWidth}}>
            <div className="relative h-9 bg-gray-50 border-b border-gray-200">
              {weeks.map((w,i)=>(
                <div key={i} className="absolute top-0 bottom-0 flex items-center border-l border-gray-200" style={{left:dayOffset(w)*DAY_PX}}>
                  <span className="text-xs text-gray-400 pl-1.5 whitespace-nowrap">{w.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'})}</span>
                </div>
              ))}
            </div>
            <div className="relative">
              {weeks.map((w,i)=><div key={i} className="absolute top-0 bottom-0 border-l border-gray-100" style={{left:dayOffset(w)*DAY_PX}}/>)}
              <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10 opacity-75" style={{left:todayX}}/>
              {withDates.map(task=>{
                const start=new Date(task.createdAt.split('T')[0]+'T00:00:00')
                const end=new Date(task.dueDate+'T00:00:00')
                const x=Math.max(0,dayOffset(start))*DAY_PX
                const endX=Math.max(x+DAY_PX,dayOffset(end)*DAY_PX)
                const barW=endX-x
                const pc=PRIORITY_CONFIG[task.priority]
                const overdue=!task.completed&&isOverdue(task.dueDate)
                const td=!task.completed&&isToday(task.dueDate)
                return (
                  <div key={task.id} className={`relative border-b border-gray-100 ${td?'bg-red-50':''}`} style={{height:ROW_H}}>
                    <div className={`absolute h-6 top-[13px] rounded flex items-center ${task.completed?pc.barDone+' opacity-50':td?'bg-red-500':pc.bar}`}
                      style={{left:x,width:barW}} title={`${task.title}`}>
                      {task.completed&&<Check size={11} className="ml-1.5 text-gray-600 flex-shrink-0"/>}
                    </div>
                    {overdue&&!td&&<div className="absolute w-1.5 h-6 top-[13px] bg-red-600 rounded-r opacity-70 z-10" style={{left:endX-6}}/>}
                    <span className={`absolute text-xs top-[15px] whitespace-nowrap ${td?'text-red-600 font-medium':overdue?'text-red-500':'text-gray-400'}`} style={{left:endX+4}}>
                      {fmtDate(task.dueDate)}{task.dueTime?' '+task.dueTime:''}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
        <div className="flex items-center gap-1.5"><div className="w-0.5 h-4 bg-red-400 opacity-75"/><span>今日</span></div>
        <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-navy"/><span>今日の3つ</span></div>
        <div className="flex items-center gap-1.5"><span className="text-red-500">!</span><span>今日締め切り</span></div>
      </div>
    </div>
  )
}

// ============================================================
// GistSettingsModal
// ============================================================

interface GistSettingsModalProps {
  settings: AppSettings
  syncStatus: SyncStatus
  onSave: (token: string, gistId: string) => void
  onDisconnect: () => void
  onClose: () => void
}

const GistSettingsModal: React.FC<GistSettingsModalProps> = ({
  settings, syncStatus, onSave, onDisconnect, onClose,
}) => {
  const [token, setToken] = useState(settings.githubToken)
  const [gistId, setGistId] = useState(settings.gistId)
  const [showToken, setShowToken] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  const handleSave = async () => {
    const trimmedToken = token.trim()
    if (!trimmedToken) {
      setMessage('GitHub tokenを入力してください')
      return
    }

    setChecking(true)
    setMessage('')
    const username = await gistValidateToken(trimmedToken)
    setChecking(false)
    if (!username) {
      setMessage('GitHub tokenを確認できませんでした')
      return
    }

    onSave(trimmedToken, gistId.trim())
    setMessage(`${username} と接続しました`)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-navy"/>
            <h2 className="font-semibold text-gray-800">GitHub Gist 設定</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">GitHub token</label>
            <div className="flex gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e=>setToken(e.target.value)}
                placeholder="gist 権限つき token"
                className="flex-1 min-w-0 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
              />
              <button
                type="button"
                onClick={()=>setShowToken(v=>!v)}
                className="w-10 border border-gray-200 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-700"
                title={showToken ? '非表示' : '表示'}
              >
                {showToken ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Gist ID</label>
            <input
              type="text"
              value={gistId}
              onChange={e=>setGistId(e.target.value)}
              placeholder="空欄なら初回同期時に自動作成"
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>

          <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
            状態: {syncStatus==='syncing' ? '同期中' : syncStatus==='success' ? '同期済み' : syncStatus==='error' ? '同期失敗' : settings.githubToken ? '接続中' : '未設定'}
            {settings.lastSynced && <span> / 最終同期: {fmtDateTime(settings.lastSynced)}</span>}
          </div>

          {message && <p className="text-xs text-gray-500">{message}</p>}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <button
            onClick={()=>{ onDisconnect(); setToken(''); setGistId(''); setMessage('接続を解除しました') }}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            接続を解除
          </button>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">閉じる</button>
            <button
              onClick={handleSave}
              disabled={checking}
              className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {checking ? '確認中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// HistoryModal — 作業の軌跡
// ============================================================

const HistoryModal: React.FC<{ history: HistoryEntry[]; onClose: () => void }> = ({
  history, onClose,
}) => {
  const [tab, setTab] = useState<'timeline' | 'analysis'>('timeline')
  // 日付ごとにグループ化
  const grouped = history.reduce<Record<string, HistoryEntry[]>>((acc, entry) => {
    // ローカル日付キー
    const d = new Date(entry.timestamp)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    ;(acc[key] = acc[key] ?? []).push(entry)
    return acc
  }, {})

  const dateKeys = Object.keys(grouped).sort().reverse()
  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)
  const recentHistory = history.filter(entry => new Date(entry.timestamp) >= sevenDaysAgo)
  const completedCount = history.filter(entry => entry.action === 'completed').length
  const recentCompletedCount = recentHistory.filter(entry => entry.action === 'completed').length
  const todayAddedCount = history.filter(entry => entry.action === 'todayAdded').length
  const uniqueTaskCount = new Set(history.map(entry => entry.taskId)).size
  const actionCounts = history.reduce<Record<string, number>>((acc, entry) => {
    const label = ACTION_CONFIG[entry.action].label
    acc[label] = (acc[label] ?? 0) + 1
    return acc
  }, {})
  const busiestKey = dateKeys.reduce((best, key) => grouped[key].length > (grouped[best]?.length ?? 0) ? key : best, dateKeys[0] ?? '')

  const fmtDateKey = (key: string) => {
    const today = todayStr()
    const yd = new Date(); yd.setDate(yd.getDate()-1)
    const yesterday = `${yd.getFullYear()}-${String(yd.getMonth()+1).padStart(2,'0')}-${String(yd.getDate()).padStart(2,'0')}`
    if (key === today)     return '今日'
    if (key === yesterday) return '昨日'
    return new Date(key+'T00:00:00').toLocaleDateString('ja-JP', { month:'long', day:'numeric' })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[84vh] flex flex-col">

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <History size={18} className="text-navy"/>
            <h2 className="font-semibold text-gray-800">作業の軌跡</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{history.length}件</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
        </div>

        <div className="px-6 pt-4 flex gap-2 flex-shrink-0">
          <button onClick={() => setTab('timeline')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${tab === 'timeline' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            履歴
          </button>
          <button onClick={() => setTab('analysis')}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md transition-colors ${tab === 'analysis' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <TrendingUp size={13}/>分析
          </button>
        </div>

        {/* 履歴リスト */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {tab === 'analysis' ? (
            history.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-12">分析できる履歴はまだありません</p>
            ) : (
              <div className="space-y-4">
                <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 leading-relaxed">
                  作業の軌跡から、完了ペースや着手傾向を見える化します。将来的には週次レポートや先延ばし傾向の提案に拡張できます。
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs text-gray-400">総完了数</p>
                    <p className="text-2xl font-semibold text-navy mt-1">{completedCount}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs text-gray-400">直近7日の完了</p>
                    <p className="text-2xl font-semibold text-navy mt-1">{recentCompletedCount}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs text-gray-400">今日の3つ投入</p>
                    <p className="text-2xl font-semibold text-navy mt-1">{todayAddedCount}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs text-gray-400">登場タスク数</p>
                    <p className="text-2xl font-semibold text-navy mt-1">{uniqueTaskCount}</p>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-gray-100 p-4">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">操作別の内訳</h3>
                    <div className="space-y-2">
                      {Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
                        <div key={label} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-gray-600">{label}</span>
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{count}件</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-4">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">進み方メモ</h3>
                    <div className="space-y-2 text-sm text-gray-600 leading-relaxed">
                      <p>一番動いた日: <span className="font-medium text-gray-800">{busiestKey ? fmtDateKey(busiestKey) : '-'}</span></p>
                      <p>直近7日の操作: <span className="font-medium text-gray-800">{recentHistory.length}件</span></p>
                      <p>完了に寄った作業が見えるほど、次週の「今日の3つ」を決めやすくなります。</p>
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : history.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">作業の軌跡はまだありません</p>
          ) : (
            <div className="space-y-5">
              <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
                タスクの追加、編集、完了、ピン留めなどをすべて保持します。カード一覧から非表示になった完了タスクも、ここから過去の作業としてたどれます。
              </div>
              {dateKeys.map(key => (
                <div key={key}>
                  <div className="sticky top-0 bg-white pb-1 mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-400">{fmtDateKey(key)}</p>
                    <span className="text-[11px] text-gray-400">{grouped[key].length}件</span>
                  </div>
                  <div className="space-y-0.5">
                    {grouped[key].map(entry => {
                      const cfg = ACTION_CONFIG[entry.action]
                      return (
                        <div key={entry.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                          {/* アイコン */}
                          <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${cfg.color}`}>
                            {cfg.icon}
                          </span>
                          {/* 内容 */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700 leading-snug">
                              <span className="font-medium">{cfg.label}</span>
                              <span className="text-gray-400 mx-1">—</span>
                              <span className="text-gray-700">{entry.taskTitle}</span>
                            </p>
                            {entry.detail && (
                              <p className="text-xs text-gray-400 mt-0.5">{entry.detail}</p>
                            )}
                          </div>
                          {/* 時刻 */}
                          <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
                            {new Date(entry.timestamp).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' })}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <p className="text-xs text-gray-400">履歴は自動削除されません</p>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TeachingsModal
// ============================================================

const TeachingsModal: React.FC<{onClose:()=>void}> = ({onClose}) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2"><BookOpen size={18} className="text-navy"/><h2 className="font-semibold text-gray-800">ノイマンの教え</h2></div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
      </div>
      <div className="px-6 py-5 space-y-5">
        {TEACHINGS.map((t,i)=>(
          <React.Fragment key={t.num}>
            {i>0&&<hr className="border-gray-100"/>}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full">教え {t.num}</span>
                <h3 className="font-semibold text-gray-800">{t.title}</h3>
              </div>
              <p className="text-sm font-medium text-gray-700">{t.principle}</p>
              <p className="text-sm text-gray-500 leading-relaxed"><span className="font-medium text-gray-600">具体例：</span>{t.example}</p>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="flex justify-end px-6 py-4 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark">閉じる</button>
      </div>
    </div>
  </div>
)

// ============================================================
// Dialog
// ============================================================

interface TemplatesModalProps {
  onUse: (template: TaskTemplate) => void
  onClose: () => void
}

const TemplatesModal: React.FC<TemplatesModalProps> = ({ onUse, onClose }) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[84vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-navy"/>
          <h2 className="font-semibold text-gray-800">タスクテンプレート</h2>
          <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">有料機能イメージ</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
      </div>
      <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
        <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 leading-relaxed">
          よくある仕事を、完了条件・ミニステップ・イシュー付きで開始できます。将来的にはAIで職種別テンプレートを自動生成する想定です。
        </p>
        {TASK_TEMPLATES.map(template => (
          <div key={template.id} className="border border-gray-100 rounded-lg p-4 bg-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-800">{template.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
              </div>
              <button onClick={() => onUse(template)}
                className="flex-shrink-0 text-xs px-3 py-1.5 rounded-md bg-navy text-white hover:bg-navy-dark">
                使う
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {template.task.miniSteps.map((step, i) => (
                <div key={`${template.id}-${i}`} className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-2 leading-relaxed">
                  {i + 1}. {step.text}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-amber-800 bg-amber-50 rounded px-3 py-2">
              Issue: {template.task.issue.text}
            </p>
          </div>
        ))}
      </div>
      <div className="flex justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
        <button onClick={onClose} className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark">閉じる</button>
      </div>
    </div>
  </div>
)

interface DialogProps {
  icon:React.ReactNode; iconColor:string; title:string; body:string
  confirmLabel:string; confirmClass:string; onConfirm:()=>void; onCancel:()=>void
}
const Dialog: React.FC<DialogProps> = ({icon,iconColor,title,body,confirmLabel,confirmClass,onConfirm,onCancel}) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
      <div className="flex items-start gap-3 mb-5">
        <span className={`flex-shrink-0 mt-0.5 ${iconColor}`}>{icon}</span>
        <div><p className="text-sm font-medium text-gray-800">{title}</p><p className="text-xs text-gray-500 mt-1">{body}</p></div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">キャンセル</button>
        <button onClick={onConfirm} className={`px-4 py-2 text-sm rounded-md ${confirmClass}`}>{confirmLabel}</button>
      </div>
    </div>
  </div>
)

// ============================================================
// App
// ============================================================

export default function App() {
  const [tasks,          setTasks]          = useState<Task[]>([])
  const [history,        setHistory]        = useState<HistoryEntry[]>([])
  const [columnOrder,    setColumnOrder]    = useState<string[]>([])
  const [settings,       setSettings]       = useState<AppSettings>(defaultSettings())
  const [syncStatus,     setSyncStatus]     = useState<SyncStatus>('disconnected')
  const [isLoaded,       setIsLoaded]       = useState(false)
  const [viewMode,       setViewMode]       = useState<ViewMode>('list')
  const [boardGroupMode, setBoardGroupMode] = useState<BoardGroupMode>('assignee')
  const [showModal,      setShowModal]      = useState(false)
  const [editTask,       setEditTask]       = useState<Task|null>(null)
  const [deleteId,       setDeleteId]       = useState<string|null>(null)
  const [todayWarn,      setTodayWarn]      = useState(false)
  const [showTeachings,  setShowTeachings]  = useState(false)
  const [showHistory,    setShowHistory]    = useState(false)
  const [showTemplates,  setShowTemplates]  = useState(false)
  const [showGistSettings, setShowGistSettings] = useState(false)

  // settingsRef: sync effect 内で最新の settings を参照するため
  const settingsRef = useRef<AppSettings>(defaultSettings())
  useEffect(() => { settingsRef.current = settings }, [settings])

  // 初期ロード：Gist設定があれば Gist 優先、なければ localStorage
  useEffect(() => {
    const s = loadSettings()
    setSettings(s)
    settingsRef.current = s

    const doLoad = async () => {
      if (s.githubToken && s.gistId) {
        setSyncStatus('syncing')
        try {
          const data = await gistLoad(s.githubToken, s.gistId)
          if (data) {
            setTasks((data.tasks ?? []).map(t => normalizeTask(t)))
            setHistory(data.history ?? [])
            setColumnOrder(data.columnOrder ?? [])
            setSyncStatus('success')
            setTimeout(() => setSyncStatus('idle'), 2000)
            setIsLoaded(true)
            return
          }
        } catch {}
        setSyncStatus('error')
      } else if (s.githubToken) {
        setSyncStatus('idle')   // トークンあり・Gist未作成
      }
      // localStorage フォールバック
      const local = loadData()
      setTasks(local.tasks)
      setHistory(local.history)
      setColumnOrder(local.columnOrder ?? [])
      setIsLoaded(true)
    }
    doLoad()
  }, [])

  // localStorage への保存
  useEffect(() => {
    if (!isLoaded) return
    saveData({ tasks, history, columnOrder })
  }, [tasks, history, columnOrder, isLoaded])

  // Gist への自動同期（3秒デバウンス）
  const syncTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!isLoaded) return
    const s = settingsRef.current
    if (!s.githubToken) return

    if (syncTimer.current) clearTimeout(syncTimer.current)
    setSyncStatus('syncing')

    syncTimer.current = setTimeout(async () => {
      try {
        const newGistId = await gistSave(s.githubToken, s.gistId, { tasks, history, columnOrder })
        setSettings(prev => {
          const next = { ...prev, gistId: newGistId, lastSynced: new Date().toISOString() }
          saveSettings(next)
          return next
        })
        setSyncStatus('success')
        setTimeout(() => setSyncStatus('idle'), 3000)
      } catch {
        setSyncStatus('error')
      }
    }, 3000)

    return () => { if (syncTimer.current) clearTimeout(syncTimer.current) }
  }, [tasks, history, columnOrder, isLoaded])

  // 履歴エントリを先頭に追加（履歴は全保持）
  const addHistory = (action: HistoryAction, task: Task, detail?: string) => {
    const entry: HistoryEntry = {
      id: genId(), timestamp: new Date().toISOString(),
      action, taskId: task.id, taskTitle: task.title, detail,
    }
    setHistory(prev => [entry, ...prev])
  }

  // Gist 接続
  const handleGistConnect = (token: string, gistId: string) => {
    const next = { ...settings, githubToken: token, gistId }
    setSettings(next); saveSettings(next)
    // 即時同期をトリガー（isLoaded は true なので effect が走る）
  }

  // Gist 切断
  const handleGistDisconnect = () => {
    const next = defaultSettings()
    setSettings(next); saveSettings(next)
    setSyncStatus('disconnected')
  }

  const knownAssignees = [DEFAULT_ASSIGNEE,
    ...Array.from(new Set(tasks.map(t=>t.assignee).filter((a):a is string=>!!a&&a!==DEFAULT_ASSIGNEE))).sort()
  ]

  const cardVisibleTasks = tasks.filter(t => !isHiddenCompletedTask(t))
  const todayTasks       = sortTasksForWork(cardVisibleTasks.filter(t=>t.isToday))
  const todayActiveCount = todayTasks.filter(t=>!t.completed).length

  const allSectionTasks = sortTasksForWork(cardVisibleTasks.filter(t=>!t.isToday))

  const handleSave = (task: Task) => {
    const isNew = !tasks.find(t => t.id === task.id)
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === task.id)
      return idx >= 0 ? prev.map(t => t.id === task.id ? task : t) : [...prev, task]
    })
    addHistory(isNew ? 'created' : 'updated', task)
    setShowModal(false); setEditTask(null)
  }

  // 完了チェック時に日時を記録
  const handleComplete = (id: string) => {
    const task = tasks.find(t => t.id === id); if (!task) return
    const nowCompleted = !task.completed
    setTasks(prev => prev.map(t => t.id !== id ? t : {
      ...t, completed: nowCompleted, completedAt: nowCompleted ? new Date().toISOString() : null,
    }))
    addHistory(nowCompleted ? 'completed' : 'uncompleted', task)
  }

  const handleToday = (id: string) => {
    const task = tasks.find(t => t.id === id); if (!task) return
    if (!task.isToday && todayActiveCount >= MAX_TODAY) { setTodayWarn(true); return }
    const adding = !task.isToday
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isToday: adding } : t))
    addHistory(adding ? 'todayAdded' : 'todayRemoved', task)
  }

  const handlePin = (id: string) => {
    const task = tasks.find(t => t.id === id); if (!task) return
    const nextPinned = !task.pinned
    setTasks(prev => prev.map(t => t.id === id ? { ...t, pinned: nextPinned } : t))
    addHistory(nextPinned ? 'pinned' : 'unpinned', task)
  }

  const handleUseTemplate = (template: TaskTemplate) => {
    const task = normalizeTask({
      ...makeNewTask(),
      ...template.task,
      miniSteps: template.task.miniSteps.map(step => ({ ...step, id: genId(), done: false })),
    })
    setEditTask(task)
    setShowTemplates(false)
    setShowModal(true)
  }

  const handleStepToggle = (taskId: string, stepId: string) => {
    const task = tasks.find(t => t.id === taskId); if (!task) return
    const steps = normalizeMiniSteps(task.miniSteps)
    const step = steps.find(s => s.id === stepId); if (!step) return
    const nextDone = !step.done
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t,
      miniSteps: normalizeMiniSteps(t.miniSteps).map(s => s.id === stepId ? { ...s, done: nextDone } : s),
    } : t))
    addHistory('updated', task, `ステップ${nextDone ? '完了' : '未完了'}: ${step.text}`)
  }

  const handleEdit = (task: Task) => { setEditTask(task); setShowModal(true) }

  const handleDeleteConfirm = () => {
    if (!deleteId) return
    const task = tasks.find(t => t.id === deleteId)
    setTasks(prev => prev.filter(t => t.id !== deleteId))
    if (task) addHistory('deleted', task)
    setDeleteId(null)
  }

  const handleReorderTasks = (visibleTasks: Task[]) => {
    setTasks(prev => {
      const visibleIds = new Set(visibleTasks.map(t => t.id))
      const mergedVisible = visibleTasks.map(t => prev.find(p => p.id === t.id) ? t : t)
      return [...mergedVisible, ...prev.filter(t => !visibleIds.has(t.id))]
    })
  }
  const handleReorderColumns = (newOrder: string[]) => setColumnOrder(newOrder)

  const cardProps = {
    onComplete:handleComplete, onToday:handleToday, onPin:handlePin,
    onStepToggle:handleStepToggle,
    onEdit:handleEdit, onDelete:(id:string)=>setDeleteId(id),
  }

  const dateLabel = new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'})

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* ===== Header ===== */}
      <header className="bg-navy text-white px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-wide">ADHD専用タスク管理</h1>
            <p className="text-xs text-blue-200 mt-0.5">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {/* Gist 同期ステータス + 設定 */}
            <button onClick={()=>setShowGistSettings(true)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                syncStatus==='error'   ? 'bg-red-500/30 hover:bg-red-500/40' :
                syncStatus==='success' ? 'bg-green-500/20 hover:bg-green-500/30' :
                'bg-white/10 hover:bg-white/20'
              }`}
              title="GitHub Gist 設定"
            >
              {syncStatus==='syncing'
                ? <Cloud size={14} className="animate-pulse"/>
                : settings.githubToken
                  ? <Cloud size={14}/>
                  : <CloudOff size={14} className="opacity-60"/>
              }
              <span className="hidden md:inline text-xs">
                {syncStatus==='syncing'  ? '同期中...'
                 :syncStatus==='success' ? '同期済み'
                 :syncStatus==='error'   ? '同期失敗'
                 :settings.githubToken  ? 'Gist接続中'
                 :'Gist未設定'}
              </span>
            </button>

            <button onClick={()=>setShowTeachings(true)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors">
              <BookOpen size={14}/><span className="hidden md:inline">ノイマンの教え</span>
            </button>
            <button onClick={()=>setShowHistory(true)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors" title="作業の軌跡">
              <History size={14}/><span className="hidden md:inline">軌跡</span>
              {history.length > 0 && (
                <span className="bg-white/30 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">
                  {history.length > 99 ? '99+' : history.length}
                </span>
              )}
            </button>
            <button onClick={()=>setShowTemplates(true)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors" title="タスクテンプレート">
              <ClipboardList size={14}/><span className="hidden md:inline">テンプレ</span>
            </button>
            <div className="flex rounded-md overflow-hidden border border-white/20">
              {([
                {mode:'list' as ViewMode, icon:<List size={14}/>, label:'リスト'},
                {mode:'gantt' as ViewMode, icon:<BarChart2 size={14}/>, label:'ガント'},
              ]).map(({mode, icon, label}, i)=>(
                <button key={mode} onClick={()=>setViewMode(mode)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-sm transition-colors ${i>0?'border-l border-white/20':''} ${viewMode===mode?'bg-white/25':'hover:bg-white/10'}`}
                  title={label}>
                  {icon}<span className="hidden sm:inline text-xs">{label}</span>
                </button>
              ))}
            </div>
            {/* エクスポート */}
            <button onClick={()=>handleExportExcel(tasks)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors" title="Excelエクスポート">
              <FileSpreadsheet size={14}/><span className="hidden sm:inline">Excel</span>
            </button>
            <button onClick={()=>handleExportCSV(tasks)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors" title="CSVエクスポート">
              <Download size={14}/><span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={()=>{setEditTask(null);setShowModal(true)}}
              className="flex items-center gap-1.5 text-sm bg-white text-navy font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors">
              <Plus size={14}/><span className="hidden sm:inline">タスクを追加</span><span className="sm:hidden">追加</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {viewMode === 'gantt' && (
          <section>
            <div className="mb-4">
              <h2 className="font-semibold text-gray-800">ガントチャート</h2>
              <p className="text-xs text-gray-500 mt-0.5">期限と現在ステップを時系列で確認</p>
            </div>
            <GanttChart tasks={tasks}/>
          </section>
        )}

        {viewMode === 'list' && (
          <>
            {/* 今日の3つ — 中央寄せ */}
            <section className="bg-gray-100 rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div><h2 className="font-semibold text-gray-800">今日の3つ</h2><p className="text-xs text-gray-500 mt-0.5">今日やる最重要タスク（最大3つ）</p></div>
                <span className={`text-sm font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${todayActiveCount>=MAX_TODAY?'bg-red-100 text-red-600':'bg-navy/10 text-navy'}`}>
                  {todayActiveCount} / {MAX_TODAY}
                </span>
              </div>
              {todayTasks.length===0
                ? <div className="text-center py-6 text-gray-400 text-sm">タスクカードの「今日」ボタンで追加できます</div>
                : <div className="grid gap-3 md:grid-cols-3">{todayTasks.map(t=><TaskCard key={t.id} task={t} {...cardProps}/>)}</div>
              }
            </section>

            {/* 全タスク — 宛先別カラム・フル幅 */}
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-semibold text-gray-800">全タスク</h2>
                  <div className="flex rounded-md overflow-hidden border border-gray-200 bg-white">
                    {([
                      {key:'assignee' as BoardGroupMode,label:'宛先'},
                      {key:'priority' as BoardGroupMode,label:'優先度'},
                      {key:'due' as BoardGroupMode,label:'期限日'},
                    ]).map((mode, i)=>(
                      <button key={mode.key} onClick={()=>setBoardGroupMode(mode.key)}
                        className={`text-xs px-3 py-1.5 transition-colors ${i>0?'border-l border-gray-200':''} ${boardGroupMode===mode.key?'bg-navy text-white':'text-gray-600 hover:bg-gray-50'}`}>
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <AssigneeCols
                tasks={allSectionTasks}
                groupMode={boardGroupMode}
                knownAssignees={knownAssignees}
                columnOrder={columnOrder}
                onReorderTasks={handleReorderTasks}
                onReorderColumns={handleReorderColumns}
                {...cardProps}
              />
            </section>
          </>
        )}
      </main>

      {/* Modals */}
      {showModal && (
        <TaskModal initial={editTask} knownAssignees={knownAssignees}
          isDraft={!!editTask && !tasks.some(t=>t.id===editTask.id)}
          onSave={handleSave} onClose={()=>{setShowModal(false);setEditTask(null)}}/>
      )}
      {showTeachings && <TeachingsModal onClose={()=>setShowTeachings(false)}/>}
      {showTemplates && <TemplatesModal onUse={handleUseTemplate} onClose={()=>setShowTemplates(false)}/>}
      {showGistSettings && (
        <GistSettingsModal
          settings={settings}
          syncStatus={syncStatus}
          onSave={handleGistConnect}
          onDisconnect={handleGistDisconnect}
          onClose={()=>setShowGistSettings(false)}
        />
      )}
      {showHistory && (
        <HistoryModal
          history={history}
          onClose={()=>setShowHistory(false)}
        />
      )}
      {deleteId && (
        <Dialog icon={<AlertTriangle size={20}/>} iconColor="text-red-500"
          title="タスクを削除しますか？" body="この操作は元に戻せません。"
          confirmLabel="削除する" confirmClass="bg-red-500 text-white hover:bg-red-600"
          onConfirm={handleDeleteConfirm} onCancel={()=>setDeleteId(null)}/>
      )}
      {todayWarn && (
        <Dialog icon={<AlertTriangle size={20}/>} iconColor="text-yellow-500"
          title="「今日の3つ」は上限に達しています"
          body="今日やるタスクは3つまでです。既存のタスクを外してから追加してください。"
          confirmLabel="わかりました" confirmClass="bg-navy text-white hover:bg-navy-dark"
          onConfirm={()=>setTodayWarn(false)} onCancel={()=>setTodayWarn(false)}/>
      )}
    </div>
  )
}
