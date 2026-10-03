import { listRows, saveRows, takeLegacyDefectRows } from './local-store'
import {
  DEFECT_LEVELS,
  DEFECT_STATUSES,
  deadlineFor,
  isNearDeadline,
  normalizeLevel,
  todayString,
  type DefectLevel,
  type DefectRecord,
  type DefectStatus,
  type HandleRecord,
  type RectificationItem,
} from './defect-model'
import type { EntryRow } from './types'

// 缺陷处置的独立底稿：写完立刻落进这一份，列表/详情/处理意见/巡视待整改都从这里读。
const STORE_KEY = 'substation-protection:defect-store'
const MIGRATION_KEY = 'substation-protection:defect-migrated'

type DefectStoreShape = {
  defects: DefectRecord[]
  rectifications: RectificationItem[]
  seq: number
  rectSeq: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 既有缺陷口径（紧急/重大/一般）。旧底稿里的占位等级不在口径内，按行轮转归入三档。
function levelFromLegacy(row: EntryRow, index: number): DefectLevel {
  const raw = String(row['缺陷等级'] ?? '')
  if (DEFECT_LEVELS.includes(raw as DefectLevel)) {
    return raw as DefectLevel
  }
  return DEFECT_LEVELS[index % DEFECT_LEVELS.length]
}

// 首次启用时把旧通用底稿里的 defect 记录原样迁进来，之后不再迁移。
function migrateLegacyRows(store: DefectStoreShape): DefectStoreShape {
  if (typeof window !== 'undefined' && window.localStorage) {
    if (window.localStorage.getItem(MIGRATION_KEY)) {
      return store
    }
    window.localStorage.setItem(MIGRATION_KEY, '1')
  }
  const legacy = takeLegacyDefectRows()
  if (!legacy.length) {
    return store
  }
  const migrated: DefectRecord[] = legacy.map((row, index) => {
    const level = levelFromLegacy(row, index)
    const reportedAt = String(row['处理期限'] ?? todayString()).slice(0, 10)
    const rawStatus = String(row.status ?? '')
    const status = (DEFECT_STATUSES.includes(rawStatus as DefectStatus)
      ? rawStatus
      : '待处理') as DefectStatus
    const handler = String(row['处理人'] ?? '')
    const report = { level, reportedAt, reporter: String(row['发现人'] ?? ''), source: '登记' as const }
    return {
      id: Number(row.id),
      code: String(row['缺陷编号'] ?? `DEFE-${Number(row.id)}`),
      equipment: String(row['缺陷设备'] ?? ''),
      description: String(row['缺陷描述'] ?? ''),
      discoverer: String(row['发现人'] ?? ''),
      level,
      status,
      // 旧记录已有处理期限就沿用，不再重算；新登记/新上报的才按等级分档。
      deadline: reportedAt,
      handler,
      reports: [report],
      handling: [],
      conclusion: '',
      conclusionAt: '',
      createdAt: reportedAt,
    }
  })
  return {
    ...store,
    // 旧底稿里已有记录就以它为准，不再保留内置示例与其待整改项，避免同编号两条。
    defects: migrated,
    rectifications: [],
    seq: Math.max(store.seq, ...legacy.map((row) => Number(row.id))),
  }
}

function seed(): DefectStoreShape {
  const reportedAt = todayString()
  const mk = (
    id: number,
    level: DefectLevel,
    status: DefectStatus,
    equipment: string,
    description: string,
    patrolId = 0,
  ): DefectRecord => ({
    id,
    code: `DEFE-${String(id).padStart(4, '0')}`,
    equipment,
    description,
    discoverer: '王巡视',
    level,
    status,
    deadline: deadlineFor(level, reportedAt),
    handler: status === '待处理' ? '' : '李检修',
    reports: [
      { level, reportedAt, reporter: '王巡视', source: patrolId ? '上报' : '登记', patrolId: patrolId || undefined },
    ],
    handling:
      status === '待处理'
        ? []
        : [
            {
              action: '提交处理',
              handler: '李检修',
              opinion: '已安排现场核查',
              handledAt: reportedAt,
            },
          ],
    conclusion: status === '已消除' ? '更换备件后试运正常' : '',
    conclusionAt: status === '已消除' ? reportedAt : '',
    createdAt: reportedAt,
  })
  const defects = [
    mk(1, '紧急', '处理中', '1号主变本体瓦斯继电器', '瓦斯继电器内部轻微渗油，需尽快处理', 2),
    mk(2, '重大', '待处理', '110kV 线路保护 A 套', '装置对时异常，事件记录时间偏差'),
    mk(3, '一般', '已消除', '直流系统 1 号充电机', '充电机风扇异响，已清洁保养'),
  ]
  const rectifications: RectificationItem[] = [
    {
      id: 1,
      defectCode: 'DEFE-0001',
      equipment: '1号主变本体瓦斯继电器',
      level: '紧急',
      description: '瓦斯继电器内部轻微渗油，需尽快处理',
      source: '巡视上报',
      patrolId: 2,
      patrolCode: 'PATR-0002',
      station: '设备巡视样例2',
      content: '巡视发现渗油点，已登记缺陷 DEFE-0001',
      status: '待整改',
      createdAt: reportedAt,
    },
  ]
  return { defects, rectifications, seq: 3, rectSeq: 1 }
}

let cache: DefectStoreShape | null = null

function load(): DefectStoreShape {
  if (cache) {
    return cache
  }
  let store: DefectStoreShape
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORE_KEY)
    store = raw ? (JSON.parse(raw) as DefectStoreShape) : seed()
  } else {
    store = seed()
  }
  store = migrateLegacyRows(store)
  persist(store)
  cache = store
  syncLegacyView(store)
  return store
}

function persist(store: DefectStoreShape): void {
  cache = store
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store))
  }
}

// 看板等通用页面仍从旧底稿取数：同步一份只读投影过去，概览统计不会缺缺陷模块。
function syncLegacyView(store: DefectStoreShape): void {
  const projection: EntryRow[] = store.defects.map((item) => ({
    id: item.id,
    status: item.status,
    pending: item.status !== '已消除' && item.status !== '已升级',
    abnormal: item.level === '紧急',
    缺陷编号: item.code,
    缺陷设备: item.equipment,
    缺陷等级: item.level,
    缺陷描述: item.description,
    发现人: item.discoverer,
    处理期限: item.deadline,
    处理人: item.handler,
    缺陷状态: item.status,
  }))
  saveRows('defect', projection)
}

function commit(next: DefectStoreShape): void {
  persist(next)
  syncLegacyView(next)
}

export function listDefects(filters: { keyword?: string; level?: string; status?: string } = {}): DefectRecord[] {
  const keyword = filters.keyword?.trim() ?? ''
  return clone(
    load().defects.filter((row) => {
      if (filters.level && row.level !== filters.level) {
        return false
      }
      if (filters.status && row.status !== filters.status) {
        return false
      }
      if (keyword) {
        const haystack = [row.code, row.equipment, row.description, row.handler].join(' ')
        if (!haystack.includes(keyword)) {
          return false
        }
      }
      return true
    }),
  )
}

export function getDefect(id: number): DefectRecord | undefined {
  const found = load().defects.find((row) => row.id === id)
  return found ? clone(found) : undefined
}

type ReportInput = {
  equipment: string
  description: string
  level: DefectLevel
  discoverer: string
  patrolId?: number
  patrolCode?: string
  station?: string
}

// 登记/上报一条缺陷，期限按等级分档；巡视上报同时进巡视待整改清单。
export function reportDefect(input: ReportInput): { ok: boolean; message: string; record?: DefectRecord } {
  const store = load()
  const reportedAt = todayString()
  const id = store.seq + 1
  const record: DefectRecord = {
    id,
    code: `DEFE-${String(id).padStart(4, '0')}`,
    equipment: input.equipment.trim(),
    description: input.description.trim(),
    discoverer: input.discoverer.trim(),
    level: input.level,
    status: '待处理',
    deadline: deadlineFor(input.level, reportedAt),
    handler: '',
    reports: [
      {
        level: input.level,
        reportedAt,
        reporter: input.discoverer.trim(),
        source: input.patrolId ? '上报' : '登记',
        patrolId: input.patrolId,
      },
    ],
    handling: [],
    conclusion: '',
    conclusionAt: '',
    createdAt: reportedAt,
  }
  const rectifications = [...store.rectifications]
  if (input.patrolId) {
    rectifications.push({
      id: store.rectSeq + 1,
      defectCode: record.code,
      equipment: record.equipment,
      level: record.level,
      description: record.description,
      source: '巡视上报',
      patrolId: input.patrolId,
      patrolCode: input.patrolCode ?? '',
      station: input.station ?? '',
      content: `巡视发现缺陷，已登记 ${record.code}`,
      status: '待整改',
      createdAt: reportedAt,
    })
  }
  commit({
    ...store,
    defects: [record, ...store.defects],
    rectifications,
    seq: id,
    rectSeq: input.patrolId ? store.rectSeq + 1 : store.rectSeq,
  })
  return { ok: true, message: `缺陷 ${record.code} 已登记，处理期限 ${record.deadline}`, record: clone(record) }
}

// 同一设备再次上报：不新建缺陷，按最近一次上报更新等级与分档期限，已消除的重新打开。
export function reReport(
  id: number,
  input: Pick<ReportInput, 'level' | 'description'>,
): { ok: boolean; message: string } {
  const store = load()
  const index = store.defects.findIndex((row) => row.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条缺陷' }
  }
  const current = store.defects[index]
  const reportedAt = todayString()
  const next: DefectRecord = {
    ...current,
    level: input.level,
    description: input.description.trim() || current.description,
    deadline: deadlineFor(input.level, reportedAt),
    status: current.status === '已消除' || current.status === '已升级' ? '处理中' : current.status,
    handler: current.handler,
    reports: [
      ...current.reports,
      { level: input.level, reportedAt, reporter: current.discoverer, source: '上报' },
    ],
  }
  const defects = [...store.defects]
  defects[index] = next
  commit({ ...store, defects })
  return { ok: true, message: `已按最近一次上报更新为「${input.level}」，处理期限 ${next.deadline}` }
}

export type HandleInput = {
  handler: string
  opinion: string
}

// 提交处理：同一条缺陷重复提交只留一条（以第一次为准），不追加流水、不覆盖处理人。
export function submitHandling(id: number, input: HandleInput): { ok: boolean; message: string } {
  const store = load()
  const index = store.defects.findIndex((row) => row.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条缺陷' }
  }
  const current = store.defects[index]
  const handler = input.handler.trim()
  const opinion = input.opinion.trim()
  if (!handler) {
    return { ok: false, message: '请填写处理人' }
  }
  if (!opinion) {
    return { ok: false, message: '请填写处理意见' }
  }
  if (current.handling.some((item) => item.action === '提交处理')) {
    return { ok: false, message: '该缺陷已提交处理，重复提交不再重复记录' }
  }
  const handledAt = todayString()
  const record: HandleRecord = { action: '提交处理', handler, opinion, handledAt }
  const next: DefectRecord = {
    ...current,
    handler,
    status: '处理中',
    handling: [...current.handling, record],
  }
  const defects = [...store.defects]
  defects[index] = next
  commit({ ...store, defects })
  return { ok: true, message: '处理意见已记入同一份底稿' }
}

function appendRectificationFromConclusion(
  store: DefectStoreShape,
  defect: DefectRecord,
  conclusion: string,
): RectificationItem[] {
  const report = defect.reports.find((item) => item.patrolId)
  if (!report || !report.patrolId) {
    return store.rectifications
  }
  const item: RectificationItem = {
    id: store.rectSeq + 1,
    defectCode: defect.code,
    equipment: defect.equipment,
    level: defect.level,
    description: defect.description,
    source: '处理结论',
    patrolId: report.patrolId,
    patrolCode: String(report.patrolId),
    station: '',
    content: conclusion,
    status: '待整改',
    createdAt: todayString(),
  }
  return [...store.rectifications, item]
}

// 确认消除：处理结论回写到设备巡视的待整改清单。
export function resolveDefect(id: number, conclusion: string): { ok: boolean; message: string } {
  const text = conclusion.trim()
  if (!text) {
    return { ok: false, message: '请填写处理结论' }
  }
  const store = load()
  const index = store.defects.findIndex((row) => row.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条缺陷' }
  }
  const current = store.defects[index]
  if (current.status === '已消除') {
    return { ok: false, message: '该缺陷已消除，不用重复操作' }
  }
  const concludedAt = todayString()
  const next: DefectRecord = {
    ...current,
    status: '已消除',
    conclusion: text,
    conclusionAt: concludedAt,
    handling: [
      ...current.handling,
      { action: '确认消除', handler: current.handler || current.discoverer, opinion: text, handledAt: concludedAt },
    ],
  }
  const defects = [...store.defects]
  defects[index] = next
  commit({
    ...store,
    defects,
    rectifications: appendRectificationFromConclusion(store, current, text),
    rectSeq: current.reports.some((item) => item.patrolId) ? store.rectSeq + 1 : store.rectSeq,
  })
  return { ok: true, message: '缺陷已消除，处理结论已回写到设备巡视待整改清单' }
}

export function escalateDefect(id: number, opinion: string): { ok: boolean; message: string } {
  const store = load()
  const index = store.defects.findIndex((row) => row.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条缺陷' }
  }
  const current = store.defects[index]
  if (current.status === '已升级') {
    return { ok: false, message: '该缺陷已升级，不用重复操作' }
  }
  const handledAt = todayString()
  const next: DefectRecord = {
    ...current,
    status: '已升级',
    handling: [
      ...current.handling,
      { action: '上报升级', handler: current.handler || current.discoverer, opinion: opinion.trim() || '上报上级协调处理', handledAt },
    ],
  }
  const defects = [...store.defects]
  defects[index] = next
  commit({ ...store, defects })
  return { ok: true, message: '缺陷已上报升级' }
}

export function listRectifications(patrolId?: number): RectificationItem[] {
  const items = load().rectifications.filter((item) => !patrolId || item.patrolId === patrolId)
  return clone(items.sort((a, b) => b.id - a.id))
}

export function setRectificationStatus(id: number, status: RectificationItem['status']): { ok: boolean; message: string } {
  const store = load()
  const index = store.rectifications.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条待整改项' }
  }
  const rectifications = [...store.rectifications]
  rectifications[index] = { ...rectifications[index], status }
  commit({ ...store, rectifications })
  return { ok: true, message: status === '已整改' ? '待整改项已闭环' : '待整改项已重新打开' }
}

export function defectStats(): { label: string; value: number }[] {
  const defects = load().defects
  const month = todayString().slice(0, 7)
  return [
    { label: '待处理缺陷', value: defects.filter((item) => item.status === '待处理').length },
    { label: '处理中缺陷', value: defects.filter((item) => item.status === '处理中').length },
    { label: '临期缺陷', value: defects.filter((item) => isNearDeadline(item)).length },
    { label: '本月消除数', value: defects.filter((item) => item.conclusionAt.slice(0, 7) === month).length },
  ]
}

export function exportDefectsCsv(): { filename: string; content: string } {
  const header = ['缺陷编号', '缺陷设备', '缺陷等级', '缺陷描述', '发现人', '处理期限', '处理人', '当前状态', '处理结论']
  const lines = [header.join(',')]
  for (const row of load().defects) {
    lines.push(
      [row.code, row.equipment, row.level, row.description, row.discoverer, row.deadline, row.handler, row.status, row.conclusion].join(','),
    )
  }
  return { filename: '缺陷处置-清单.csv', content: `﻿${lines.join('\n')}` }
}

export function resetDefectStore(): void {
  cache = seed()
  persist(cache)
  syncLegacyView(cache)
}

export { normalizeLevel }
