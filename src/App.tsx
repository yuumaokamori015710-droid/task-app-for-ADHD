import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  Plus, Pencil, Trash2, Check, Calendar, Download,
  AlertTriangle, X, BookOpen, List, BarChart2, GitBranch, Users, FileSpreadsheet,
  History, RotateCcw, Star, StarOff,
  Cloud, CloudOff, Eye, EyeOff,
} from 'lucide-react'

// ============================================================
// Types
// ============================================================

type Priority    = 'high' | 'medium' | 'low'
type Filter      = 'all' | 'today' | 'thisWeek' | 'overdue'
type ViewMode    = 'list' | 'gantt' | 'tree'
type EffortLevel = 0 | 1 | 2 | 3 | 5

interface CompletionCondition {
  verb: string; verbCustom: string
  target: string; targetCustom: string
  state: string; stateCustom: string
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
  assignee: string
  parentId: string | null
  effort: EffortLevel
  completionCondition: CompletionCondition
  createdAt: string
  // Future: status, reviewDate, roughApprovalMode
}

type HistoryAction =
  | 'created' | 'updated' | 'deleted'
  | 'completed' | 'uncompleted'
  | 'todayAdded' | 'todayRemoved'
  | 'parentChanged'

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

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY      = 'task-app-data'
const SETTINGS_KEY     = 'task-app-settings'
const GIST_FILENAME    = 'neumann-task-app.json'
const MAX_TODAY        = 3
const MAX_HISTORY      = 500   // 保持する履歴の最大件数

// 操作種別ごとの表示設定
const ACTION_CONFIG: Record<HistoryAction, { label: string; icon: React.ReactNode; color: string }> = {
  created:       { label: '追加',         icon: <Plus size={13}/>,       color: 'text-green-600 bg-green-50' },
  updated:       { label: '編集',         icon: <Pencil size={13}/>,     color: 'text-blue-600 bg-blue-50' },
  deleted:       { label: '削除',         icon: <Trash2 size={13}/>,     color: 'text-red-600 bg-red-50' },
  completed:     { label: '完了',         icon: <Check size={13}/>,      color: 'text-navy bg-navy/10' },
  uncompleted:   { label: '完了解除',     icon: <RotateCcw size={13}/>,  color: 'text-gray-600 bg-gray-100' },
  todayAdded:    { label: '今日に追加',   icon: <Star size={13}/>,       color: 'text-yellow-600 bg-yellow-50' },
  todayRemoved:  { label: '今日から除外', icon: <StarOff size={13}/>,    color: 'text-gray-500 bg-gray-100' },
  parentChanged: { label: '親タスク変更', icon: <GitBranch size={13}/>,  color: 'text-purple-600 bg-purple-50' },
}
const DAY_PX           = 28
const DEFAULT_ASSIGNEE = '自分'

const VERB_OPTIONS   = ['ドラフトが','要件が','合意が','レビューが','資料が','議事録が','質問への回答が','課題リストが','設計案が','テストが']
const TARGET_OPTIONS = ['自分で','NRIから','上司と','業務部門と','チーム内で','関係者間で']
const STATE_OPTIONS  = ['完成している','確定している','共有済みになっている','フィードバック反映済みになっている','承認されている','着手可能になっている']

const PRIORITY_CONFIG: Record<Priority, { label: string; badge: string; bar: string; barDone: string }> = {
  high:   { label: '高', badge: 'bg-red-100 text-red-700',       bar: 'bg-red-300',    barDone: 'bg-red-200' },
  medium: { label: '中', badge: 'bg-yellow-100 text-yellow-700', bar: 'bg-yellow-300', barDone: 'bg-yellow-200' },
  low:    { label: '低', badge: 'bg-gray-100 text-gray-500',     bar: 'bg-gray-300',   barDone: 'bg-gray-200' },
}

const EFFORT_CONFIG: Record<number, { label: string; short: string; color: string }> = {
  0: { label: '未設定',        short: '-',  color: 'bg-gray-100 text-gray-400' },
  1: { label: 'S（〜1時間）',  short: 'S',  color: 'bg-green-100 text-green-600' },
  2: { label: 'M（半日程度）', short: 'M',  color: 'bg-blue-100 text-blue-600' },
  3: { label: 'L（1日程度）',  short: 'L',  color: 'bg-orange-100 text-orange-600' },
  5: { label: 'XL（複数日）',  short: 'XL', color: 'bg-red-100 text-red-600' },
}

const TEACHINGS = [
  { num: '①', title: '入口を減らす',       principle: '並行作業を減らすべし。',          example: '現在進行中のタスク数に厳格な上限を設け、それ以外の依頼は一旦別のストック場所に置く。' },
  { num: '②', title: '制約を先に固定する', principle: '迷いを遮断すべし。',              example: '「今日はこの領域以外には手を出さない」といった制約を最初に設定し、判断の計算資源を節約する。' },
  { num: '③', title: '他者の頭脳を組み込む', principle: '自分一人で完結させないべし。', example: '6割程度の思考ができた段階で他者に共有し、前提のズレや抜け漏れを早い段階で指摘してもらう。' },
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

const fmtCondition = (cc: CompletionCondition) => {
  const v = cc.verb==='other' ? cc.verbCustom : cc.verb
  const t = cc.target==='other' ? cc.targetCustom : cc.target
  const s = cc.state==='other' ? cc.stateCustom : cc.state
  return [v,t,s].filter(Boolean).join('')
}

// Tree helpers
function wouldCreateCycle(taskId: string, proposedParentId: string, tasks: Task[]): boolean {
  const visited = new Set<string>()
  let cur: string | null = proposedParentId
  while (cur) {
    if (cur === taskId) return true
    if (visited.has(cur)) return false
    visited.add(cur)
    cur = tasks.find(t=>t.id===cur)?.parentId ?? null
  }
  return false
}

function getPathEffort(taskId: string, tasks: Task[], visited = new Set<string>()): number {
  if (visited.has(taskId)) return 0
  visited.add(taskId)
  const task = tasks.find(t=>t.id===taskId)
  if (!task) return 0
  const own = task.effort as number
  if (!task.parentId) return own
  return own + getPathEffort(task.parentId, tasks, visited)
}

const NODE_W = 200, NODE_H = 88, H_GAP = 28, V_GAP = 72

function buildTreeLayout(tasks: Task[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  let nextLeafX = 0
  const layOut = (id: string, depth: number): number => {
    const children = tasks.filter(t=>t.parentId===id)
    if (children.length===0) {
      pos.set(id, { x: nextLeafX, y: depth*(NODE_H+V_GAP) })
      const cx = nextLeafX + NODE_W/2
      nextLeafX += NODE_W + H_GAP
      return cx
    }
    const cxs = children.map(c=>layOut(c.id, depth+1))
    const center = (cxs[0] + cxs[cxs.length-1]) / 2
    pos.set(id, { x: center - NODE_W/2, y: depth*(NODE_H+V_GAP) })
    return center
  }
  tasks.filter(t=>!t.parentId).forEach(r=>{layOut(r.id,0); nextLeafX+=H_GAP})
  return pos
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
    data.tasks = (data.tasks ?? []).map(t => ({
      ...t,
      memo:        (t as Task).memo        ?? '',
      assignee:    (t as Task).assignee    ?? DEFAULT_ASSIGNEE,
      dueTime:     (t as Task).dueTime     ?? '',
      parentId:    (t as Task).parentId    ?? null,
      effort:      (t as Task).effort      ?? 0,
      completedAt: (t as Task).completedAt ?? null,
    }))
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
    description: 'ノイマン式タスク管理 - 自動バックアップ',
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
  '労力':        EFFORT_CONFIG[t.effort]?.short ?? '-',
  '完了条件':    fmtCondition(t.completionCondition),
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
    {wch:8},{wch:20},{wch:10},{wch:8},{wch:32},{wch:12},
  ]
  // ヘッダー行のスタイル（背景色）
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'タスク一覧')
  XLSX.writeFile(wb, `neumann-tasks-${todayStr()}.xlsx`)
}

// ============================================================
// ConditionSelect
// ============================================================

interface ConditionSelectProps {
  label: string; options: string[]
  value: string; customValue: string
  onChange:(v:string)=>void; onCustomChange:(v:string)=>void
}
const ConditionSelect: React.FC<ConditionSelectProps> = ({label,options,value,customValue,onChange,onCustomChange}) => (
  <div className="flex flex-col gap-1 flex-1 min-w-0">
    <label className="text-xs text-gray-500">{label}</label>
    <select value={value} onChange={e=>onChange(e.target.value)}
      className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-navy bg-white">
      <option value="">未設定</option>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
      <option value="other">その他（自由入力）</option>
    </select>
    {value==='other' && (
      <input type="text" value={customValue} onChange={e=>onCustomChange(e.target.value)} placeholder="自由入力..."
        className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-navy"/>
    )}
  </div>
)

// ============================================================
// TaskModal
// ============================================================

const emptyCC = (): CompletionCondition => ({verb:'',verbCustom:'',target:'',targetCustom:'',state:'',stateCustom:''})
const makeNewTask = (): Task => ({
  id:genId(), title:'', memo:'', dueDate:'', dueTime:'', priority:'medium',
  completed:false, completedAt:null, isToday:false, assignee:DEFAULT_ASSIGNEE,
  parentId:null, effort:0, completionCondition:emptyCC(),
  createdAt: new Date().toISOString(),
})

interface TaskModalProps {
  initial: Task | null
  allTasks: Task[]
  knownAssignees: string[]
  onSave: (t: Task) => void
  onClose: () => void
}

const TaskModal: React.FC<TaskModalProps> = ({ initial, allTasks, knownAssignees, onSave, onClose }) => {
  const [form, setForm] = useState<Task>(initial ?? makeNewTask())
  const [assigneeMode, setAssigneeMode] = useState<'select'|'new'>(
    initial && !knownAssignees.includes(initial.assignee) ? 'new' : 'select'
  )
  const [newAssigneeDraft, setNewAssigneeDraft] = useState(
    initial && !knownAssignees.includes(initial.assignee) ? initial.assignee : ''
  )

  const cc = form.completionCondition
  const setCC = (f: keyof CompletionCondition, v: string) =>
    setForm(p=>({...p, completionCondition:{...p.completionCondition,[f]:v}}))
  const preview = fmtCondition(cc)

  const availableParents = allTasks.filter(t => t.id!==form.id && !wouldCreateCycle(form.id, t.id, allTasks))
  const effectiveAssignee = assigneeMode==='new' ? (newAssigneeDraft.trim() || DEFAULT_ASSIGNEE) : form.assignee

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{initial?'タスクを編集':'タスクを追加'}</h2>
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

          {/* メモ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">メモ</label>
            <textarea value={form.memo}
              onChange={e=>setForm(p=>({...p,memo:e.target.value}))}
              placeholder="補足・背景・リンクなど自由記述..."
              rows={3}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy resize-y"/>
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

          {/* 親タスク・労力 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">親タスク</label>
              <select value={form.parentId??''}
                onChange={e=>setForm(p=>({...p,parentId:e.target.value||null}))}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-white">
                <option value="">なし（ルート）</option>
                {availableParents.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">労力</label>
              <select value={form.effort} onChange={e=>setForm(p=>({...p,effort:Number(e.target.value) as EffortLevel}))}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-white">
                {[0,1,2,3,5].map(v=><option key={v} value={v}>{EFFORT_CONFIG[v].label}</option>)}
              </select>
            </div>
          </div>

          {/* 完了条件 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">完了条件</label>
            <div className="flex gap-2">
              <ConditionSelect label="動詞" options={VERB_OPTIONS} value={cc.verb} customValue={cc.verbCustom} onChange={v=>setCC('verb',v)} onCustomChange={v=>setCC('verbCustom',v)}/>
              <ConditionSelect label="対象" options={TARGET_OPTIONS} value={cc.target} customValue={cc.targetCustom} onChange={v=>setCC('target',v)} onCustomChange={v=>setCC('targetCustom',v)}/>
              <ConditionSelect label="状態" options={STATE_OPTIONS} value={cc.state} customValue={cc.stateCustom} onChange={v=>setCC('state',v)} onCustomChange={v=>setCC('stateCustom',v)}/>
            </div>
            {preview && (
              <p className="mt-2 text-xs bg-gray-50 text-gray-600 rounded px-3 py-2">
                完了条件: <span className="font-medium text-gray-800">{preview}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">キャンセル</button>
          <button onClick={()=>form.title.trim()&&onSave({...form,assignee:effectiveAssignee})}
            disabled={!form.title.trim()}
            className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark disabled:opacity-40 disabled:cursor-not-allowed">
            {initial?'保存':'追加'}
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
  onComplete:(id:string)=>void; onToday:(id:string)=>void
  onEdit:(t:Task)=>void; onDelete:(id:string)=>void
  hideAssignee?: boolean
}

const TaskCard: React.FC<TaskCardProps> = ({task,onComplete,onToday,onEdit,onDelete,hideAssignee=false}) => {
  const pc         = PRIORITY_CONFIG[task.priority]
  const ec         = EFFORT_CONFIG[task.effort]
  const cond       = fmtCondition(task.completionCondition)
  const overdue    = !task.completed && isOverdue(task.dueDate)
  const todayDue   = !task.completed && !!task.dueDate && isToday(task.dueDate)

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
              <span className={`text-sm font-medium ${task.completed?'line-through text-gray-400':todayDue?'text-red-700':'text-gray-800'}`}>
                {task.title}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${pc.badge}`}>{pc.label}</span>
              {task.effort>0 && <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${ec.color}`}>{ec.short}</span>}
              {!hideAssignee && task.assignee!==DEFAULT_ASSIGNEE && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-navy/10 text-navy flex-shrink-0">→ {task.assignee}</span>
              )}
            </div>
            {cond && <p className="text-xs text-gray-400 mt-0.5 truncate">完了条件: {cond}</p>}
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
  knownAssignees: string[]
  columnOrder: string[]
  onReorderTasks: (tasks: Task[]) => void
  onReorderColumns: (order: string[]) => void
  onComplete:(id:string)=>void; onToday:(id:string)=>void
  onEdit:(t:Task)=>void; onDelete:(id:string)=>void
}

const AssigneeCols: React.FC<AssigneeColsProps> = ({
  tasks, knownAssignees, columnOrder,
  onReorderTasks, onReorderColumns,
  onComplete, onToday, onEdit, onDelete,
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
  const cols = orderedAssignees
    .map(a => ({ assignee: a, tasks: tasks.filter(t => t.assignee === a) }))
    .filter(c => c.tasks.length > 0)

  const clear = () => {
    setDragTaskId(null); setDragColName(null)
    setDropTaskId(null); setDropColName(null)
  }

  // タスクをカード上にドロップ
  const dropOnTask = (targetId: string, targetAssignee: string) => {
    if (!dragTaskId || dragTaskId === targetId) { clear(); return }
    const dragged = { ...tasks.find(t => t.id === dragTaskId)!, assignee: targetAssignee }
    const rest    = tasks.filter(t => t.id !== dragTaskId)
    let idx = rest.findIndex(t => t.id === targetId)
    if (dropPos === 'after') idx++
    rest.splice(idx, 0, dragged)
    onReorderTasks(rest)
    clear()
  }

  // タスクを列の空白にドロップ（列の末尾へ）
  const dropOnCol = (targetAssignee: string) => {
    if (!dragTaskId) { clear(); return }
    const dragged = { ...tasks.find(t => t.id === dragTaskId)!, assignee: targetAssignee }
    onReorderTasks([...tasks.filter(t => t.id !== dragTaskId), dragged])
    clear()
  }

  // 列ヘッダーへドロップ（列の並び替え）
  const dropOnColHeader = (targetAssignee: string) => {
    if (!dragColName || dragColName === targetAssignee) { clear(); return }
    const newOrder = [...orderedAssignees]
    newOrder.splice(newOrder.indexOf(dragColName), 1)
    newOrder.splice(newOrder.indexOf(targetAssignee), 0, dragColName)
    onReorderColumns(newOrder)
    clear()
  }

  if (!cols.length) return (
    <div className="text-center py-12 text-gray-400 text-sm">タスクがありません</div>
  )

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
        {cols.map(({ assignee, tasks: colTasks }) => {
          const active       = colTasks.filter(t => !t.completed).length
          const isSelf       = assignee === DEFAULT_ASSIGNEE
          const isColTarget  = dropColName === assignee && !!dragColName && dragColName !== assignee
          const isDraggingCol = dragColName === assignee

          return (
            <div
              key={assignee}
              style={{ width: COL_W }}
              className={`flex-shrink-0 transition-opacity ${isDraggingCol ? 'opacity-30' : ''}`}
              onDragOver={e => { e.preventDefault(); if (dragTaskId) setDropColName(assignee) }}
              onDrop={() => { if (dragTaskId) dropOnCol(assignee) }}
            >
              {/* 列ヘッダー（ドラッグで列並び替え） */}
              <div
                draggable
                onDragStart={e => { e.stopPropagation(); setDragColName(assignee); setDragTaskId(null) }}
                onDragEnd={clear}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropColName(assignee) }}
                onDrop={e => { e.stopPropagation(); dropOnColHeader(assignee) }}
                className={[
                  'flex items-center justify-between px-3 py-2.5 rounded-lg mb-2 cursor-grab select-none transition-all',
                  isSelf ? 'bg-navy/10' : 'bg-amber-50 border border-amber-200',
                  isColTarget ? 'ring-2 ring-navy shadow-md' : '',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-300 text-base leading-none">⠿</span>
                  <Users size={13} className={isSelf ? 'text-navy' : 'text-amber-600'} />
                  <span className={`text-sm font-semibold ${isSelf ? 'text-navy' : 'text-amber-700'}`}>
                    {assignee}
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
                        onDrop={e => { e.stopPropagation(); dropOnTask(task.id, assignee) }}
                        className={`transition-opacity cursor-grab ${isDragging ? 'opacity-25' : ''}`}
                      >
                        <TaskCard task={task} hideAssignee
                          onComplete={onComplete} onToday={onToday}
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
  const withDates = tasks.filter(t=>t.dueDate)
  const today = new Date(); today.setHours(0,0,0,0)
  const allMs = withDates.flatMap(t=>[new Date(t.createdAt.split('T')[0]+'T00:00:00').getTime(),new Date(t.dueDate+'T00:00:00').getTime()])
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
  const ROW_H = 44
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex">
        <div className="w-48 flex-shrink-0 border-r border-gray-100 bg-white">
          <div className="h-9 bg-gray-50 border-b border-gray-200"/>
          {withDates.map(task=>{
            const td = !task.completed&&!!task.dueDate&&isToday(task.dueDate)
            return (
              <div key={task.id} className={`flex items-center gap-1.5 px-3 border-b border-gray-100 ${task.completed?'opacity-40':''} ${td?'bg-red-50':''}`} style={{height:ROW_H}}>
                {task.isToday&&<span className="w-1.5 h-1.5 rounded-full bg-navy flex-shrink-0"/>}
                {td&&<span className="text-red-500 flex-shrink-0">🔥</span>}
                <span className={`text-xs truncate ${td?'text-red-700 font-semibold':'text-gray-700'}`}>{task.title}</span>
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
                    <div className={`absolute h-6 top-[10px] rounded flex items-center ${task.completed?pc.barDone+' opacity-50':td?'bg-red-500':pc.bar}`}
                      style={{left:x,width:barW}} title={`${task.title}`}>
                      {task.completed&&<Check size={11} className="ml-1.5 text-gray-600 flex-shrink-0"/>}
                    </div>
                    {overdue&&!td&&<div className="absolute w-1.5 h-6 top-[10px] bg-red-600 rounded-r opacity-70 z-10" style={{left:endX-6}}/>}
                    <span className={`absolute text-xs top-[12px] whitespace-nowrap ${td?'text-red-600 font-medium':overdue?'text-red-500':'text-gray-400'}`} style={{left:endX+4}}>
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
        <div className="flex items-center gap-1.5"><span>🔥</span><span>今日締め切り</span></div>
      </div>
    </div>
  )
}

// ============================================================
// TreeView
// ============================================================

const TreeView: React.FC<{
  tasks:Task[]
  onSetParent:(taskId:string,parentId:string|null)=>void
  onEdit:(t:Task)=>void
}> = ({tasks,onSetParent,onEdit}) => {
  const [draggingId,   setDraggingId]  = useState<string|null>(null)
  const [dropTargetId, setDropTargetId]= useState<string|null>(null)

  const positions = buildTreeLayout(tasks)
  let maxX=0,maxY=0
  for(const [,p] of positions){maxX=Math.max(maxX,p.x+NODE_W);maxY=Math.max(maxY,p.y+NODE_H)}
  const canvasW = maxX+H_GAP*2, canvasH = maxY+V_GAP

  const pathEffortMap = new Map(tasks.map(t=>[t.id,getPathEffort(t.id,tasks)]))
  const leaves = tasks.filter(t=>!tasks.some(o=>o.parentId===t.id))
  const leafEfforts = leaves.map(l=>pathEffortMap.get(l.id)??0).filter(e=>e>0)
  const minE = leafEfforts.length?Math.min(...leafEfforts):-1
  const maxE = leafEfforts.length?Math.max(...leafEfforts):-1

  const handleDrop = (targetId:string|null) => {
    if(!draggingId) return
    if(targetId===draggingId){setDraggingId(null);setDropTargetId(null);return}
    if(targetId&&wouldCreateCycle(draggingId,targetId,tasks)){setDraggingId(null);setDropTargetId(null);return}
    onSetParent(draggingId,targetId)
    setDraggingId(null);setDropTargetId(null)
  }

  if(!tasks.length) return <div className="text-center py-12 text-gray-400 text-sm">タスクを追加してください</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-100 border border-green-400 inline-block"/>最軽パス</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300 inline-block"/>最重パス</span>
        <span className="text-gray-400">ドラッグ→別タスクにドロップで親子関係設定 / 空白ドロップでルートに戻す</span>
      </div>
      <div className="border border-gray-200 rounded-lg bg-gray-50 overflow-auto"
        onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(null)}
        style={{minHeight:Math.max(canvasH+32,200)}}>
        <div className="relative m-4" style={{width:canvasW,height:canvasH}}>
          <svg className="absolute inset-0 pointer-events-none" width={canvasW} height={canvasH}>
            {tasks.filter(t=>t.parentId).map(task=>{
              const cp=positions.get(task.id),pp=positions.get(task.parentId!)
              if(!cp||!pp) return null
              const x1=pp.x+NODE_W/2,y1=pp.y+NODE_H,x2=cp.x+NODE_W/2,y2=cp.y,my=(y1+y2)/2
              return <path key={task.id} d={`M${x1} ${y1} C${x1} ${my},${x2} ${my},${x2} ${y2}`} fill="none" stroke="#cbd5e1" strokeWidth="1.5"/>
            })}
          </svg>
          {tasks.map(task=>{
            const pos=positions.get(task.id)
            if(!pos) return null
            const isLeaf=!tasks.some(t=>t.parentId===task.id)
            const pathE=pathEffortMap.get(task.id)??0
            const isMinLeaf=isLeaf&&pathE===minE&&minE>0
            const isMaxLeaf=isLeaf&&pathE===maxE&&maxE>0&&minE!==maxE
            const ec=EFFORT_CONFIG[task.effort]
            const td=!task.completed&&!!task.dueDate&&isToday(task.dueDate)
            return (
              <div key={task.id}
                draggable
                onDragStart={()=>setDraggingId(task.id)}
                onDragEnd={()=>{setDraggingId(null);setDropTargetId(null)}}
                onDragOver={e=>{e.preventDefault();e.stopPropagation();setDropTargetId(task.id)}}
                onDrop={e=>{e.stopPropagation();handleDrop(task.id)}}
                style={{position:'absolute',left:pos.x,top:pos.y,width:NODE_W,height:NODE_H}}
                className={['bg-white rounded-lg border-2 cursor-grab select-none flex flex-col overflow-hidden',
                  dropTargetId===task.id?'border-navy bg-navy/5 shadow-md':'',
                  draggingId===task.id?'opacity-40 border-gray-200':'border-gray-200 shadow-sm hover:shadow',
                  isMinLeaf?'ring-2 ring-green-400':'',isMaxLeaf?'ring-2 ring-red-300':'',
                  td?'border-red-500':'',
                ].join(' ')}
              >
                {td&&<div className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 flex items-center gap-1"><span>🔥</span>今日締め切り</div>}
                <div className="p-2.5 flex flex-col gap-1 flex-1 justify-between">
                  <div className="flex items-start gap-1.5">
                    <p className="text-xs font-semibold text-gray-800 flex-1 leading-tight line-clamp-2">{task.title}</p>
                    {task.effort>0&&<span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-medium ${ec.color}`}>{ec.short}</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {task.assignee!==DEFAULT_ASSIGNEE&&<span className="text-xs text-gray-400">→{task.assignee}</span>}
                    {task.dueDate&&<span className={`text-xs flex items-center gap-0.5 ${td?'text-red-500':isOverdue(task.dueDate)?'text-red-400':'text-gray-400'}`}><Calendar size={10}/>{fmtDate(task.dueDate)}{task.dueTime?' '+task.dueTime:''}</span>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${isMinLeaf?'text-green-600':isMaxLeaf?'text-red-500':'text-gray-400'}`}>
                      {pathE>0?`パス ${pathE}`:''}{isMinLeaf?' ✓最軽':isMaxLeaf?' ⚠最重':''}
                    </span>
                    <div className="flex gap-0.5">
                      {task.parentId&&<button onPointerDown={e=>e.stopPropagation()} onClick={()=>onSetParent(task.id,null)} className="text-xs text-gray-300 hover:text-gray-600 px-1">↑外す</button>}
                      <button onPointerDown={e=>e.stopPropagation()} onClick={()=>onEdit(task)} className="text-xs text-gray-300 hover:text-navy px-1">編集</button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {leaves.length>1&&leafEfforts.length>0&&(
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">パス労力サマリー（末端タスク）</h3>
          <div className="space-y-1.5">
            {leaves.filter(l=>(pathEffortMap.get(l.id)??0)>0).sort((a,b)=>(pathEffortMap.get(a.id)??0)-(pathEffortMap.get(b.id)??0)).map(leaf=>{
              const pe=pathEffortMap.get(leaf.id)??0
              const isMin=pe===minE,isMax=pe===maxE&&minE!==maxE
              return (
                <div key={leaf.id} className="flex items-center gap-3">
                  <span className={`text-xs w-2 h-2 rounded-full flex-shrink-0 ${isMin?'bg-green-400':isMax?'bg-red-400':'bg-gray-300'}`}/>
                  <span className="text-xs text-gray-700 truncate flex-1">{leaf.title}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-24 bg-gray-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${isMin?'bg-green-400':isMax?'bg-red-400':'bg-blue-300'}`} style={{width:`${maxE>0?Math.round((pe/maxE)*100):0}%`}}/>
                    </div>
                    <span className={`text-xs font-medium w-6 text-right ${isMin?'text-green-600':isMax?'text-red-500':'text-gray-500'}`}>{pe}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
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
  const [token,      setToken]      = useState(settings.githubToken)
  const [gistId,     setGistId]     = useState(settings.gistId)
  const [showToken,  setShowToken]  = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [testMsg,    setTestMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  const isConnected = !!settings.githubToken

  const handleConnect = async () => {
    if (!token.trim()) return
    setTesting(true); setTestMsg(null)
    const username = await gistValidateToken(token.trim())
    if (username) {
      setTestMsg({ ok: true, text: `✅ 接続成功（${username}）` })
      onSave(token.trim(), gistId.trim())
    } else {
      setTestMsg({ ok: false, text: '❌ トークンが無効です。スコープに gist が含まれているか確認してください。' })
    }
    setTesting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-navy"/>
            <h2 className="font-semibold text-gray-800">GitHub Gist 連携</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* 接続中ステータス */}
          {isConnected && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
              <p className="font-medium text-green-700">✅ 接続中</p>
              {settings.gistId && (
                <p className="text-xs text-green-600 mt-0.5">
                  Gist ID: <a href={`https://gist.github.com/${settings.gistId}`} target="_blank" rel="noreferrer"
                    className="underline">{settings.gistId}</a>
                </p>
              )}
              {settings.lastSynced && (
                <p className="text-xs text-green-600 mt-0.5">最終同期: {fmtDateTime(settings.lastSynced)}</p>
              )}
              <p className="text-xs text-green-600 mt-0.5">
                ステータス: {syncStatus === 'syncing' ? '同期中...' : syncStatus === 'error' ? '同期エラー' : '正常'}
              </p>
            </div>
          )}

          {/* トークン作成手順 */}
          {!isConnected && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700 space-y-1.5">
              <p className="font-bold text-sm">Personal Access Token の取得手順</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-600">
                <li>GitHub → Settings → Developer settings</li>
                <li>Personal access tokens → Tokens (classic)</li>
                <li>「Generate new token」をクリック</li>
                <li>スコープは <code className="bg-blue-100 px-1 rounded font-mono">gist</code> のみ選択（最小権限）</li>
                <li>生成されたトークンをコピーして以下に貼り付け</li>
              </ol>
            </div>
          )}

          {/* トークン入力 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Personal Access Token
            </label>
            <div className="flex gap-2 items-center">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e => { setToken(e.target.value); setTestMsg(null) }}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-navy"
              />
              <button onClick={() => setShowToken(v => !v)} className="text-gray-400 hover:text-gray-600 p-1">
                {showToken ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
            <p className="text-xs text-amber-600 mt-1">
              ⚠️ トークンはこの端末の localStorage に保存されます（gistスコープのみ付与で被害を最小化）
            </p>
          </div>

          {/* 既存 Gist ID（2台目用） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              既存の Gist ID
              <span className="ml-1.5 text-xs text-gray-400 font-normal">2台目以降はここに入力 / 空白なら自動作成</span>
            </label>
            <input
              type="text"
              value={gistId}
              onChange={e => setGistId(e.target.value)}
              placeholder="例: a1b2c3d4e5f6... （1台目のGist設定画面で確認）"
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>

          {/* テスト結果 */}
          {testMsg && (
            <p className={`text-sm leading-snug ${testMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testMsg.text}
            </p>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <div>
            {isConnected && (
              <button onClick={() => { onDisconnect(); onClose() }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                連携を解除
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
              {isConnected ? '閉じる' : 'キャンセル'}
            </button>
            <button onClick={handleConnect} disabled={!token.trim() || testing}
              className="px-4 py-2 text-sm bg-navy text-white rounded-md hover:bg-navy-dark disabled:opacity-40 disabled:cursor-not-allowed">
              {testing ? '確認中...' : isConnected ? 'トークンを更新' : '接続'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// HistoryModal — 操作履歴
// ============================================================

const HistoryModal: React.FC<{ history: HistoryEntry[]; onClose: () => void; onClear: () => void }> = ({
  history, onClose, onClear,
}) => {
  // 日付ごとにグループ化
  const grouped = history.reduce<Record<string, HistoryEntry[]>>((acc, entry) => {
    // ローカル日付キー
    const d = new Date(entry.timestamp)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    ;(acc[key] = acc[key] ?? []).push(entry)
    return acc
  }, {})

  const dateKeys = Object.keys(grouped).sort().reverse()

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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <History size={18} className="text-navy"/>
            <h2 className="font-semibold text-gray-800">操作履歴</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{history.length}件</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
        </div>

        {/* 履歴リスト */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {history.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">操作履歴はまだありません</p>
          ) : (
            <div className="space-y-5">
              {dateKeys.map(key => (
                <div key={key}>
                  <p className="text-xs font-bold text-gray-400 mb-2 sticky top-0 bg-white pb-1">
                    {fmtDateKey(key)}
                  </p>
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
          <button onClick={()=>{ if(window.confirm('履歴をすべて削除しますか？')) onClear() }}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors">
            履歴をクリア
          </button>
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
  const [filter,         setFilter]         = useState<Filter>('all')
  const [viewMode,       setViewMode]       = useState<ViewMode>('list')
  const [showModal,      setShowModal]      = useState(false)
  const [editTask,       setEditTask]       = useState<Task|null>(null)
  const [deleteId,       setDeleteId]       = useState<string|null>(null)
  const [todayWarn,      setTodayWarn]      = useState(false)
  const [showTeachings,  setShowTeachings]  = useState(false)
  const [showHistory,    setShowHistory]    = useState(false)
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
            setTasks((data.tasks ?? []).map(t => ({
              ...t,
              memo:        (t as Task).memo        ?? '',
              dueTime:     (t as Task).dueTime     ?? '',
              parentId:    (t as Task).parentId    ?? null,
              effort:      (t as Task).effort      ?? 0,
              completedAt: (t as Task).completedAt ?? null,
              assignee:    (t as Task).assignee    ?? DEFAULT_ASSIGNEE,
            })))
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

  // 履歴エントリを先頭に追加（上限超えたら古いものを削除）
  const addHistory = (action: HistoryAction, task: Task, detail?: string) => {
    const entry: HistoryEntry = {
      id: genId(), timestamp: new Date().toISOString(),
      action, taskId: task.id, taskTitle: task.title, detail,
    }
    setHistory(prev => [entry, ...prev].slice(0, MAX_HISTORY))
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

  const todayTasks       = tasks.filter(t=>t.isToday)
  const todayActiveCount = todayTasks.filter(t=>!t.completed).length

  const allSectionTasks = tasks.filter(t=>{
    if(t.isToday) return false
    switch(filter){
      case 'today':    return !!t.dueDate&&isToday(t.dueDate)
      case 'thisWeek': return !!t.dueDate&&isThisWeek(t.dueDate)
      case 'overdue':  return !t.completed&&!!t.dueDate&&isOverdue(t.dueDate)
      default:         return true
    }
  })

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

  const handleEdit = (task: Task) => { setEditTask(task); setShowModal(true) }

  const handleDeleteConfirm = () => {
    if (!deleteId) return
    const task = tasks.find(t => t.id === deleteId)
    setTasks(prev => prev.filter(t => t.id !== deleteId))
    if (task) addHistory('deleted', task)
    setDeleteId(null)
  }

  const handleReorderTasks   = (newTasks: Task[])   => setTasks(newTasks)
  const handleReorderColumns = (newOrder: string[]) => setColumnOrder(newOrder)

  const handleSetParent = (taskId: string, parentId: string | null) => {
    const task   = tasks.find(t => t.id === taskId)
    const parent = parentId ? tasks.find(t => t.id === parentId) : null
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, parentId } : t))
    if (task) addHistory('parentChanged', task, parent ? `親: 「${parent.title}」` : 'ルートに変更')
  }

  const cardProps = {
    onComplete:handleComplete, onToday:handleToday,
    onEdit:handleEdit, onDelete:(id:string)=>setDeleteId(id),
  }

  const dateLabel = new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'})

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* ===== Header ===== */}
      <header className="bg-navy text-white px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-wide">ノイマン式タスク管理</h1>
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
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors" title="操作履歴">
              <History size={14}/><span className="hidden md:inline">履歴</span>
              {history.length > 0 && (
                <span className="bg-white/30 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">
                  {history.length > 99 ? '99+' : history.length}
                </span>
              )}
            </button>
            {/* ビュー切替 */}
            <div className="flex rounded-md overflow-hidden border border-white/20">
              {([
                {mode:'list'  as ViewMode, icon:<List size={14}/>,      label:'リスト'},
                {mode:'gantt' as ViewMode, icon:<BarChart2 size={14}/>, label:'ガント'},
                {mode:'tree'  as ViewMode, icon:<GitBranch size={14}/>, label:'ツリー'},
              ]).map(({mode,icon,label},i)=>(
                <button key={mode} onClick={()=>setViewMode(mode)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-sm transition-colors ${i>0?'border-l border-white/20':''} ${viewMode===mode?'bg-white/25':'hover:bg-white/10'}`}
                  title={label}>{icon}<span className="hidden sm:inline text-xs">{label}</span></button>
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

        {/* ガントビュー */}
        {viewMode==='gantt' && (
          <section>
            <div className="mb-4"><h2 className="font-semibold text-gray-800">ガントチャート</h2><p className="text-xs text-gray-500 mt-0.5">全タスクの期限・進捗を時系列で確認</p></div>
            <GanttChart tasks={tasks}/>
          </section>
        )}

        {/* ツリービュー */}
        {viewMode==='tree' && (
          <section>
            <div className="mb-4"><h2 className="font-semibold text-gray-800">タスクツリー</h2><p className="text-xs text-gray-500 mt-0.5">親子関係・パス労力を可視化。ドラッグ&ドロップで依存関係を設定</p></div>
            <TreeView tasks={tasks} onSetParent={handleSetParent} onEdit={handleEdit}/>
          </section>
        )}

        {/* リストビュー */}
        {viewMode==='list' && (
          <>
            {/* 今日の3つ — 中央寄せ */}
            <section className="bg-gray-100 rounded-lg p-5 max-w-2xl mx-auto">
              <div className="flex items-start justify-between mb-4">
                <div><h2 className="font-semibold text-gray-800">今日の3つ</h2><p className="text-xs text-gray-500 mt-0.5">今日やる最重要タスク（最大3つ）</p></div>
                <span className={`text-sm font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${todayActiveCount>=MAX_TODAY?'bg-red-100 text-red-600':'bg-navy/10 text-navy'}`}>
                  {todayActiveCount} / {MAX_TODAY}
                </span>
              </div>
              {todayTasks.length===0
                ? <div className="text-center py-6 text-gray-400 text-sm">タスクカードの「今日」ボタンで追加できます</div>
                : <div className="space-y-2">{todayTasks.map(t=><TaskCard key={t.id} task={t} {...cardProps}/>)}</div>
              }
            </section>

            {/* 全タスク — 宛先別カラム・フル幅 */}
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <h2 className="font-semibold text-gray-800">全タスク</h2>
                <div className="flex gap-1 flex-wrap">
                  {([
                    {key:'all'      as Filter,label:'すべて'},
                    {key:'today'    as Filter,label:'今日'},
                    {key:'thisWeek' as Filter,label:'今週'},
                    {key:'overdue'  as Filter,label:'期限切れ'},
                  ]).map(f=>(
                    <button key={f.key} onClick={()=>setFilter(f.key)}
                      className={`text-xs px-3 py-1.5 rounded-md transition-colors ${filter===f.key?'bg-navy text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <AssigneeCols
                tasks={allSectionTasks}
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
        <TaskModal initial={editTask} allTasks={tasks} knownAssignees={knownAssignees}
          onSave={handleSave} onClose={()=>{setShowModal(false);setEditTask(null)}}/>
      )}
      {showTeachings && <TeachingsModal onClose={()=>setShowTeachings(false)}/>}
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
          onClear={()=>setHistory([])}
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
