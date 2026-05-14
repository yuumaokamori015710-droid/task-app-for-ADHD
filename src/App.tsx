import React, { useState, useEffect, useRef } from 'react'
import {
  Plus, Pencil, Trash2, Check, Calendar, Download,
  AlertTriangle, X, BookOpen, List, BarChart2, GitBranch, Users,
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
  dueDate: string       // 'YYYY-MM-DD'
  dueTime: '' | 'AM' | 'PM'
  priority: Priority
  completed: boolean
  isToday: boolean
  assignee: string
  parentId: string | null
  effort: EffortLevel
  completionCondition: CompletionCondition
  createdAt: string
  // Future: status, reviewDate, retrospectiveMemo, roughApprovalMode
}

interface AppData { tasks: Task[] }

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY      = 'task-app-data'
const MAX_TODAY        = 3
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
  0: { label: '未設定',          short: '-',  color: 'bg-gray-100 text-gray-400' },
  1: { label: 'S（〜1時間）',    short: 'S',  color: 'bg-green-100 text-green-600' },
  2: { label: 'M（半日程度）',   short: 'M',  color: 'bg-blue-100 text-blue-600' },
  3: { label: 'L（1日程度）',    short: 'L',  color: 'bg-orange-100 text-orange-600' },
  5: { label: 'XL（複数日）',    short: 'XL', color: 'bg-red-100 text-red-600' },
}

// ============================================================
// Utilities
// ============================================================

const genId    = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}`
const todayStr = () => new Date().toISOString().split('T')[0]
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

const isOverdue = (d: string) => !!d && d < todayStr()

const fmtDate = (d: string) =>
  d ? new Date(d+'T00:00:00').toLocaleDateString('ja-JP',{month:'short',day:'numeric'}) : ''

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
    cur = tasks.find(t => t.id === cur)?.parentId ?? null
  }
  return false
}

function getPathEffort(taskId: string, tasks: Task[], visited = new Set<string>()): number {
  if (visited.has(taskId)) return 0
  visited.add(taskId)
  const task = tasks.find(t => t.id === taskId)
  if (!task) return 0
  const own = task.effort as number
  if (!task.parentId) return own
  return own + getPathEffort(task.parentId, tasks, visited)
}

const NODE_W = 200, NODE_H = 84, H_GAP = 28, V_GAP = 72

function buildTreeLayout(tasks: Task[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  let nextLeafX = 0

  const layOut = (id: string, depth: number): number => {
    const children = tasks.filter(t => t.parentId === id)
    if (children.length === 0) {
      pos.set(id, { x: nextLeafX, y: depth*(NODE_H+V_GAP) })
      const cx = nextLeafX + NODE_W/2
      nextLeafX += NODE_W + H_GAP
      return cx
    }
    const cxs = children.map(c => layOut(c.id, depth+1))
    const center = (cxs[0] + cxs[cxs.length-1]) / 2
    pos.set(id, { x: center - NODE_W/2, y: depth*(NODE_H+V_GAP) })
    return center
  }

  tasks.filter(t => !t.parentId).forEach(r => {
    layOut(r.id, 0)
    nextLeafX += H_GAP
  })
  return pos
}

// ============================================================
// localStorage
// ============================================================

const loadData = (): AppData => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tasks: [] }
    const data = JSON.parse(raw) as AppData
    data.tasks = (data.tasks ?? []).map(t => ({
      ...t,
      assignee:  t.assignee  ?? DEFAULT_ASSIGNEE,
      dueTime:   (t as Task).dueTime  ?? '',
      parentId:  (t as Task).parentId ?? null,
      effort:    (t as Task).effort   ?? 0,
    }))
    return data
  } catch { return { tasks: [] } }
}

const saveData = (data: AppData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

const handleExportCSV = (tasks: Task[]) => {
  const headers = ['タイトル','宛先','優先度','期限','時間帯','完了','今日の3つ','労力','完了条件','作成日']
  const rows = tasks.map(t => [
    `"${t.title.replace(/"/g,'""')}"`,
    t.assignee, PRIORITY_CONFIG[t.priority].label,
    t.dueDate, t.dueTime,
    t.completed?'完了':'未完了', t.isToday?'はい':'いいえ',
    EFFORT_CONFIG[t.effort]?.short ?? '-',
    `"${fmtCondition(t.completionCondition).replace(/"/g,'""')}"`,
    t.createdAt.split('T')[0],
  ])
  const csv = [headers,...rows].map(r=>r.join(',')).join('\n')
  const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href=url; a.download=`tasks-${todayStr()}.csv`; a.click()
  URL.revokeObjectURL(url)
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
  id:genId(), title:'', dueDate:'', dueTime:'', priority:'medium',
  completed:false, isToday:false, assignee:DEFAULT_ASSIGNEE,
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
    setForm(p => ({...p, completionCondition:{...p.completionCondition,[f]:v}}))
  const preview = fmtCondition(cc)

  const availableParents = allTasks.filter(t =>
    t.id !== form.id && !wouldCreateCycle(form.id, t.id, allTasks)
  )

  const effectiveAssignee = assigneeMode==='new'
    ? (newAssigneeDraft.trim() || DEFAULT_ASSIGNEE)
    : form.assignee

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
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
                  <option value="">-</option>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
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
              <select value={form.parentId ?? ''}
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
  const pc      = PRIORITY_CONFIG[task.priority]
  const ec      = EFFORT_CONFIG[task.effort]
  const cond    = fmtCondition(task.completionCondition)
  const overdue = !task.completed && isOverdue(task.dueDate)
  return (
    <div className={`bg-white border border-gray-200 rounded-md px-4 py-3 flex gap-3 items-start ${task.completed?'opacity-50':''}`}>
      <button onClick={()=>onComplete(task.id)}
        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${task.completed?'bg-navy border-navy':'border-gray-300 hover:border-navy'}`}>
        {task.completed && <Check size={11} className="text-white"/>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-sm font-medium ${task.completed?'line-through text-gray-400':'text-gray-800'}`}>{task.title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${pc.badge}`}>{pc.label}</span>
          {task.effort>0 && <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${ec.color}`}>{ec.short}</span>}
          {!hideAssignee && task.assignee!==DEFAULT_ASSIGNEE && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-navy/10 text-navy flex-shrink-0">→ {task.assignee}</span>
          )}
        </div>
        {cond && <p className="text-xs text-gray-400 mt-0.5 truncate">完了条件: {cond}</p>}
        {task.dueDate && (
          <div className={`flex items-center gap-1 mt-1 text-xs ${overdue?'text-red-500':'text-gray-400'}`}>
            <Calendar size={11}/>
            <span>{fmtDate(task.dueDate)}{task.dueTime?` ${task.dueTime}`:''}{overdue?'（期限切れ）':''}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={()=>onToday(task.id)} title={task.isToday?'今日の3つから外す':'今日の3つに追加'}
          className={`text-xs px-2 py-1 rounded transition-colors ${task.isToday?'bg-navy text-white':'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>今日</button>
        <button onClick={()=>onEdit(task)} className="p-1 text-gray-400 hover:text-gray-700"><Pencil size={14}/></button>
        <button onClick={()=>onDelete(task.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14}/></button>
      </div>
    </div>
  )
}

// ============================================================
// AssigneeColumns — used in list view for 全タスク
// ============================================================

interface AssigneeColsProps {
  tasks: Task[]; knownAssignees: string[]
  onComplete:(id:string)=>void; onToday:(id:string)=>void
  onEdit:(t:Task)=>void; onDelete:(id:string)=>void
}
const AssigneeCols: React.FC<AssigneeColsProps> = ({tasks,knownAssignees,onComplete,onToday,onEdit,onDelete}) => {
  const cols = knownAssignees
    .map(a => ({ assignee:a, tasks:tasks.filter(t=>t.assignee===a) }))
    .filter(c=>c.tasks.length>0)

  if (cols.length===0) return (
    <div className="text-center py-12 text-gray-400 text-sm">タスクがありません</div>
  )
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-4" style={{minWidth:'max-content'}}>
        {cols.map(({assignee,tasks:ct})=>{
          const active = ct.filter(t=>!t.completed).length
          const isSelf = assignee===DEFAULT_ASSIGNEE
          return (
            <div key={assignee} className="w-72 flex-shrink-0">
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg mb-2 ${isSelf?'bg-navy/10':'bg-amber-50 border border-amber-200'}`}>
                <div className="flex items-center gap-2">
                  <Users size={13} className={isSelf?'text-navy':'text-amber-600'}/>
                  <span className={`text-sm font-semibold ${isSelf?'text-navy':'text-amber-700'}`}>{assignee}</span>
                </div>
                <span className="text-xs text-gray-500 bg-white px-1.5 py-0.5 rounded-full">{active}件</span>
              </div>
              <div className="space-y-2">
                {ct.map(task=>(
                  <TaskCard key={task.id} task={task} hideAssignee
                    onComplete={onComplete} onToday={onToday} onEdit={onEdit} onDelete={onDelete}/>
                ))}
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
        <div className="w-44 flex-shrink-0 border-r border-gray-100 bg-white">
          <div className="h-9 bg-gray-50 border-b border-gray-200"/>
          {withDates.map(task=>(
            <div key={task.id} className={`flex items-center gap-1.5 px-3 border-b border-gray-100 ${task.completed?'opacity-40':''}`} style={{height:ROW_H}}>
              {task.isToday && <span className="w-1.5 h-1.5 rounded-full bg-navy flex-shrink-0"/>}
              <span className="text-xs text-gray-700 truncate">{task.title}</span>
            </div>
          ))}
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
                return (
                  <div key={task.id} className="relative border-b border-gray-100" style={{height:ROW_H}}>
                    <div className={`absolute h-6 top-[10px] rounded flex items-center ${task.completed?pc.barDone+' opacity-50':pc.bar}`} style={{left:x,width:barW}} title={`${task.title} 期限:${fmtDate(task.dueDate)}${task.dueTime?' '+task.dueTime:''}`}>
                      {task.completed&&<Check size={11} className="ml-1.5 text-gray-600 flex-shrink-0"/>}
                    </div>
                    {overdue&&<div className="absolute w-1.5 h-6 top-[10px] bg-red-600 rounded-r opacity-70 z-10" style={{left:endX-6}}/>}
                    <span className={`absolute text-xs top-[12px] whitespace-nowrap ${overdue?'text-red-500':'text-gray-400'}`} style={{left:endX+4}}>{fmtDate(task.dueDate)}{task.dueTime?' '+task.dueTime:''}</span>
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
        <div className="flex items-center gap-1.5"><div className="w-1.5 h-4 bg-red-600 rounded opacity-70"/><span>期限切れ</span></div>
      </div>
    </div>
  )
}

// ============================================================
// TreeView — 依存関係・パス労力可視化
// ============================================================

const TreeView: React.FC<{
  tasks: Task[]
  onSetParent: (taskId:string, parentId:string|null)=>void
  onEdit: (t:Task)=>void
}> = ({tasks,onSetParent,onEdit}) => {
  const [draggingId,  setDraggingId]  = useState<string|null>(null)
  const [dropTargetId,setDropTargetId]= useState<string|null>(null)

  const positions = buildTreeLayout(tasks)

  // Canvas size
  let maxX = 0, maxY = 0
  for(const [,p] of positions){ maxX=Math.max(maxX,p.x+NODE_W); maxY=Math.max(maxY,p.y+NODE_H) }
  const canvasW = maxX + H_GAP*2
  const canvasH = maxY + V_GAP

  // Path effort for every node
  const pathEffortMap = new Map(tasks.map(t=>[t.id, getPathEffort(t.id,tasks)]))

  // Leaves and their efforts (for path comparison)
  const leaves = tasks.filter(t=>!tasks.some(o=>o.parentId===t.id))
  const leafEfforts = leaves.map(l=>pathEffortMap.get(l.id)??0).filter(e=>e>0)
  const minE = leafEfforts.length ? Math.min(...leafEfforts) : -1
  const maxE = leafEfforts.length ? Math.max(...leafEfforts) : -1

  const handleDrop = (targetId: string|null) => {
    if(!draggingId) return
    if(targetId===draggingId){setDraggingId(null);setDropTargetId(null);return}
    if(targetId && wouldCreateCycle(draggingId,targetId,tasks)){setDraggingId(null);setDropTargetId(null);return}
    onSetParent(draggingId, targetId)
    setDraggingId(null); setDropTargetId(null)
  }

  if(!tasks.length) return (
    <div className="text-center py-12 text-gray-400 text-sm">タスクを追加してください</div>
  )

  return (
    <div className="space-y-3">
      {/* 凡例 */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-100 border border-green-400 inline-block"/>最軽パス</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300 inline-block"/>最重パス</span>
        <span className="text-gray-400">ドラッグ → 別タスクにドロップで親子関係を設定 / 空白ドロップでルートに戻す</span>
      </div>

      {/* チャートエリア */}
      <div className="border border-gray-200 rounded-lg bg-gray-50 overflow-auto"
        onDragOver={e=>e.preventDefault()}
        onDrop={()=>handleDrop(null)}
        style={{minHeight: Math.max(canvasH+32,200)}}
      >
        <div className="relative m-4" style={{width:canvasW, height:canvasH}}>

          {/* SVG 接続線 */}
          <svg className="absolute inset-0 pointer-events-none" width={canvasW} height={canvasH}>
            {tasks.filter(t=>t.parentId).map(task=>{
              const cp = positions.get(task.id)
              const pp = positions.get(task.parentId!)
              if(!cp||!pp) return null
              const x1=pp.x+NODE_W/2, y1=pp.y+NODE_H
              const x2=cp.x+NODE_W/2, y2=cp.y
              const my=(y1+y2)/2
              return (
                <path key={task.id}
                  d={`M${x1} ${y1} C${x1} ${my},${x2} ${my},${x2} ${y2}`}
                  fill="none" stroke="#cbd5e1" strokeWidth="1.5"/>
              )
            })}
          </svg>

          {/* ノード */}
          {tasks.map(task=>{
            const pos = positions.get(task.id)
            if(!pos) return null
            const isLeaf    = !tasks.some(t=>t.parentId===task.id)
            const pathE     = pathEffortMap.get(task.id)??0
            const isMinLeaf = isLeaf && pathE===minE && minE>0
            const isMaxLeaf = isLeaf && pathE===maxE && maxE>0 && minE!==maxE
            const ec        = EFFORT_CONFIG[task.effort]
            const isDragging= draggingId===task.id
            const isTarget  = dropTargetId===task.id

            return (
              <div key={task.id}
                draggable
                onDragStart={()=>setDraggingId(task.id)}
                onDragEnd={()=>{setDraggingId(null);setDropTargetId(null)}}
                onDragOver={e=>{e.preventDefault();e.stopPropagation();setDropTargetId(task.id)}}
                onDrop={e=>{e.stopPropagation();handleDrop(task.id)}}
                style={{position:'absolute',left:pos.x,top:pos.y,width:NODE_W,height:NODE_H}}
                className={[
                  'bg-white rounded-lg border-2 p-2.5 cursor-grab select-none flex flex-col justify-between',
                  isTarget  ? 'border-navy bg-navy/5 shadow-md' : '',
                  isDragging? 'opacity-40 border-gray-200' : 'border-gray-200 shadow-sm hover:shadow',
                  isMinLeaf ? 'ring-2 ring-green-400' : '',
                  isMaxLeaf ? 'ring-2 ring-red-300'   : '',
                ].join(' ')}
              >
                {/* 上段: タイトル + 労力 */}
                <div className="flex items-start gap-1.5">
                  <p className="text-xs font-semibold text-gray-800 flex-1 leading-tight line-clamp-2">{task.title}</p>
                  {task.effort>0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-medium ${ec.color}`}>{ec.short}</span>
                  )}
                </div>

                {/* 中段: 宛先・期限 */}
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  {task.assignee!==DEFAULT_ASSIGNEE && (
                    <span className="text-xs text-gray-400">→{task.assignee}</span>
                  )}
                  {task.dueDate && (
                    <span className={`text-xs flex items-center gap-0.5 ${!task.completed&&isOverdue(task.dueDate)?'text-red-500':'text-gray-400'}`}>
                      <Calendar size={10}/>{fmtDate(task.dueDate)}{task.dueTime?' '+task.dueTime:''}
                    </span>
                  )}
                </div>

                {/* 下段: パス労力 + ボタン */}
                <div className="flex items-center justify-between mt-1">
                  <span className={`text-xs font-medium ${isMinLeaf?'text-green-600':isMaxLeaf?'text-red-500':'text-gray-400'}`}>
                    {pathE>0 ? `パス ${pathE}` : ''}
                    {isMinLeaf ? ' ✓最軽' : isMaxLeaf ? ' ⚠最重' : ''}
                  </span>
                  <div className="flex gap-0.5">
                    {task.parentId && (
                      <button onPointerDown={e=>e.stopPropagation()} onClick={()=>onSetParent(task.id,null)}
                        className="text-xs text-gray-300 hover:text-gray-600 px-1 rounded">↑外す</button>
                    )}
                    <button onPointerDown={e=>e.stopPropagation()} onClick={()=>onEdit(task)}
                      className="text-xs text-gray-300 hover:text-navy px-1 rounded">編集</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* パス一覧サマリー */}
      {leaves.length>1 && leafEfforts.length>0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">パス労力サマリー（末端タスク）</h3>
          <div className="space-y-1.5">
            {leaves
              .filter(l=>(pathEffortMap.get(l.id)??0)>0)
              .sort((a,b)=>(pathEffortMap.get(a.id)??0)-(pathEffortMap.get(b.id)??0))
              .map(leaf=>{
                const pe = pathEffortMap.get(leaf.id)??0
                const isMin = pe===minE
                const isMax = pe===maxE && minE!==maxE
                const pct = maxE>0 ? Math.round((pe/maxE)*100) : 0
                return (
                  <div key={leaf.id} className="flex items-center gap-3">
                    <span className={`text-xs w-2 h-2 rounded-full flex-shrink-0 ${isMin?'bg-green-400':isMax?'bg-red-400':'bg-gray-300'}`}/>
                    <span className="text-xs text-gray-700 truncate flex-1">{leaf.title}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-24 bg-gray-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${isMin?'bg-green-400':isMax?'bg-red-400':'bg-blue-300'}`} style={{width:`${pct}%`}}/>
                      </div>
                      <span className={`text-xs font-medium w-6 text-right ${isMin?'text-green-600':isMax?'text-red-500':'text-gray-500'}`}>{pe}</span>
                    </div>
                  </div>
                )
              })
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// TeachingsModal
// ============================================================

const TeachingsModal: React.FC<{onClose:()=>void}> = ({onClose}) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2"><BookOpen size={18} className="text-navy"/><h2 className="font-semibold text-gray-800">ノイマンの教え</h2></div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
      </div>
      <div className="px-6 py-5 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full">教え 1</span>
            <h3 className="font-semibold text-gray-800">今日の3つ</h3>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">1日に「今日やる」として選ぶタスクは<strong>最大3つ</strong>。4つ目は入れない。優先順位を強制的に明確にし、完了の達成感を毎日積み重ねるための原則。</p>
        </div>
        <hr className="border-gray-100"/>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full">教え 3</span>
            <h3 className="font-semibold text-gray-800">やらないことリスト</h3>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">「今週はやらないこと」を意図的に決める。やることを絞るのではなく、<strong>やらないことを先に決める</strong>ことで、本当に大切な仕事への集中密度を高める。</p>
        </div>
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
  const [tasks,        setTasks]        = useState<Task[]>([])
  const [filter,       setFilter]       = useState<Filter>('all')
  const [viewMode,     setViewMode]     = useState<ViewMode>('list')
  const [showModal,    setShowModal]    = useState(false)
  const [editTask,     setEditTask]     = useState<Task|null>(null)
  const [deleteId,     setDeleteId]     = useState<string|null>(null)
  const [todayWarn,    setTodayWarn]    = useState(false)
  const [showTeachings,setShowTeachings]= useState(false)

  useEffect(()=>{ const d=loadData(); setTasks(d.tasks) },[])
  useEffect(()=>{ saveData({tasks}) },[tasks])

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

  const handleSave = (task:Task) => {
    setTasks(prev=>{
      const idx=prev.findIndex(t=>t.id===task.id)
      return idx>=0?prev.map(t=>t.id===task.id?task:t):[...prev,task]
    })
    setShowModal(false); setEditTask(null)
  }

  const handleComplete  = (id:string) => setTasks(prev=>prev.map(t=>t.id===id?{...t,completed:!t.completed}:t))
  const handleToday     = (id:string) => {
    const task=tasks.find(t=>t.id===id); if(!task) return
    if(!task.isToday&&todayActiveCount>=MAX_TODAY){setTodayWarn(true);return}
    setTasks(prev=>prev.map(t=>t.id===id?{...t,isToday:!t.isToday}:t))
  }
  const handleEdit      = (task:Task) => { setEditTask(task); setShowModal(true) }
  const handleDeleteConfirm = () => { if(deleteId){setTasks(prev=>prev.filter(t=>t.id!==deleteId));setDeleteId(null)} }
  const handleSetParent = (taskId:string, parentId:string|null) =>
    setTasks(prev=>prev.map(t=>t.id===taskId?{...t,parentId}:t))

  const cardProps = { onComplete:handleComplete, onToday:handleToday, onEdit:handleEdit, onDelete:(id:string)=>setDeleteId(id) }

  const dateLabel = new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'})

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* Header */}
      <header className="bg-navy text-white px-6 py-4 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-wide">ノイマン式タスク管理</h1>
            <p className="text-xs text-blue-200 mt-0.5">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            <button onClick={()=>setShowTeachings(true)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors">
              <BookOpen size={14}/><span className="hidden sm:inline">ノイマンの教え</span>
            </button>
            {/* ビュー切替 */}
            <div className="flex rounded-md overflow-hidden border border-white/20">
              {([
                {mode:'list'  as ViewMode, icon:<List size={14}/>,       label:'リスト'},
                {mode:'gantt' as ViewMode, icon:<BarChart2 size={14}/>,  label:'ガント'},
                {mode:'tree'  as ViewMode, icon:<GitBranch size={14}/>,  label:'ツリー'},
              ]).map(({mode,icon,label},i)=>(
                <button key={mode} onClick={()=>setViewMode(mode)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-sm transition-colors ${i>0?'border-l border-white/20':''} ${viewMode===mode?'bg-white/25':'hover:bg-white/10'}`}
                  title={label}
                >{icon}<span className="hidden sm:inline text-xs">{label}</span></button>
              ))}
            </div>
            <button onClick={()=>handleExportCSV(tasks)}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition-colors">
              <Download size={14}/><span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={()=>{setEditTask(null);setShowModal(true)}}
              className="flex items-center gap-1.5 text-sm bg-white text-navy font-medium px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors">
              <Plus size={14}/><span className="hidden sm:inline">タスクを追加</span><span className="sm:hidden">追加</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">

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
            <div className="mb-4">
              <h2 className="font-semibold text-gray-800">タスクツリー</h2>
              <p className="text-xs text-gray-500 mt-0.5">親子関係・パス労力を可視化。ドラッグ&ドロップで依存関係を設定</p>
            </div>
            <TreeView tasks={tasks} onSetParent={handleSetParent} onEdit={handleEdit}/>
          </section>
        )}

        {/* リストビュー */}
        {viewMode==='list' && (
          <>
            {/* 今日の3つ */}
            <section className="bg-gray-100 rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div><h2 className="font-semibold text-gray-800">今日の3つ</h2><p className="text-xs text-gray-500 mt-0.5">今日やる最重要タスク（最大3つ）</p></div>
                <span className={`text-sm font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${todayActiveCount>=MAX_TODAY?'bg-red-100 text-red-600':'bg-navy/10 text-navy'}`}>
                  {todayActiveCount} / {MAX_TODAY}
                </span>
              </div>
              {todayTasks.length===0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">タスクカードの「今日」ボタンで追加できます</div>
              ) : (
                <div className="space-y-2">{todayTasks.map(t=><TaskCard key={t.id} task={t} {...cardProps}/>)}</div>
              )}
            </section>

            {/* 全タスク — 宛先別カラム */}
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
              <AssigneeCols tasks={allSectionTasks} knownAssignees={knownAssignees} {...cardProps}/>
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
