import { allRows, saveRows } from './local-store'
import type { EntryRow, HandlingRecord, LevelReport } from './types'

// 缺陷处置领域层：列表、详情抽屉、处理意见、设备巡视待整改清单都从这里读，
// 所有改动即时落进同一份底稿（localStorage），刷新、重开页面看到的都是这份。

export const DEFECT_MODULE = 'defect'

export type DefectLevel = '危急缺陷' | '严重缺陷' | '一般缺陷'
export type DefectStatus = '待处理' | '处理中' | '已消除' | '已升级'

/** 处理期限按缺陷等级分档：危急 1 天、严重 7 天、一般 180 天。 */
export const DEFECT_LEVELS: DefectLevel[] = ['危急缺陷', '严重缺陷', '一般缺陷']
export const LEVEL_DEADLINE_DAYS: Record<DefectLevel, number> = {
  危急缺陷: 1,
  严重缺陷: 7,
  一般缺陷: 180,
}
/** 距期限不足该天数（且尚未消除）时单独标成临期。 */
export const EXPIRING_SOON_DAYS = 3

/** 设备巡视待整改清单的状态口径，沿用巡视模块既有状态。 */
export type RectifyStatus = '待整改' | '整改中' | '已整改'

export type RectifyItem = {
  缺陷编号: string
  缺陷设备: string
  缺陷等级: DefectLevel
  整改期限: string
  处理人: string
  处理情况: RectifyStatus
  处理结论: string
}

export type DeadlineInfo = {
  期限: string
  已超期: boolean
  超期天数: number
  临期: boolean
  剩余天数: number
}

function pad(num: number): string {
  return String(num).padStart(2, '0')
}

/** 本地日期（YYYY-MM-DD），避免 UTC 时区把日期往前拨一天。 */
export function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

export function addDays(base: string, days: number): string {
  const date = parseDate(base)
  if (!date) {
    return base
  }
  date.setDate(date.getDate() + days)
  return toDateOnly(date)
}

export function canonicalLevel(value: unknown): DefectLevel | null {
  const text = String(value ?? '').trim()
  const hit = DEFECT_LEVELS.find((level) => level === text)
  return hit ?? null
}

export function sortLevelReports(reports: LevelReport[]): LevelReport[] {
  return [...reports].sort((a, b) => a.上报时间.localeCompare(b.上报时间))
}

/** 缺陷等级冲突时以最近一次上报为准。 */
export function latestLevelReport(row: EntryRow): LevelReport | null {
  const reports = Array.isArray(row.等级上报) ? (row.等级上报 as LevelReport[]) : []
  const valid = sortLevelReports(
    reports.filter((report) => canonicalLevel(report.缺陷等级) !== null),
  )
  return valid.length ? valid[valid.length - 1] : null
}

function isLevelReport(value: unknown): value is LevelReport {
  if (!value || typeof value !== 'object') {
    return false
  }
  const report = value as Record<string, unknown>
  return typeof report.缺陷等级 === 'string' && typeof report.上报时间 === 'string'
}

function isHandlingRecord(value: unknown): value is HandlingRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.处理意见 === 'string' &&
    typeof record.处理结论 === 'string' &&
    typeof record.处理人 === 'string' &&
    typeof record.提交时间 === 'string'
  )
}

/**
 * 兼容升级老数据：把既有缺陷记录补齐等级上报时间线、按等级口径修正期限与状态。
 * 只补缺、不改用户已经手工维护过的值，保证沿用既有缺陷口径。
 */
function normalize(raw: EntryRow): EntryRow {
  const reportsRaw = Array.isArray(raw.等级上报) ? (raw.等级上报 as unknown[]) : []
  const reports: LevelReport[] = sortLevelReports(
    reportsRaw.filter(isLevelReport).map((report) => ({
      缺陷等级: canonicalLevel(report.缺陷等级) ?? '一般缺陷',
      上报时间: report.上报时间,
      上报来源: typeof report.上报来源 === 'string' ? report.上报来源 : undefined,
    })),
  )

  const currentLevel = canonicalLevel(raw.缺陷等级)
  if (currentLevel && !reports.some((report) => report.缺陷等级 === currentLevel)) {
    const base =
      typeof raw.发现日期 === 'string' && raw.发现日期
        ? String(raw.发现日期)
        : toDateOnly(new Date())
    reports.push({
      缺陷等级: currentLevel,
      上报时间: `${base}T08:00`,
      上报来源: typeof raw.上报来源 === 'string' ? String(raw.上报来源) : undefined,
    })
  }
  if (!reports.length) {
    reports.push({
      缺陷等级: '一般缺陷',
      上报时间: `${toDateOnly(new Date())}T08:00`,
      上报来源: '初始登记',
    })
  }
  sortLevelReports(reports)

  const latest = reports[reports.length - 1]
  const level: DefectLevel = canonicalLevel(latest.缺陷等级) ?? '一般缺陷'
  const status = String(raw.status ?? '待处理')

  // 已有合法期限就沿用；占位/非法数据按等级分档重算。
  const rawDeadline = typeof raw.处理期限 === 'string' ? String(raw.处理期限) : ''
  const 处理期限 = parseDate(rawDeadline)
    ? rawDeadline
    : addDays(latest.上报时间.slice(0, 10), LEVEL_DEADLINE_DAYS[level])

  const record = isHandlingRecord(raw.处理记录)
    ? (raw.处理记录 as HandlingRecord)
    : undefined
  const 处理人 =
    typeof raw.处理人 === 'string' && raw.处理人.trim() !== ''
      ? String(raw.处理人)
      : record?.处理人 ?? ''

  return {
    ...raw,
    status,
    pending: status !== '已消除',
    abnormal: status === '已升级',
    缺陷等级: level,
    处理期限,
    处理人,
    缺陷状态: status,
    处理记录: record,
    等级上报: reports,
  }
}

function isNormalized(row: EntryRow): boolean {
  return (
    canonicalLevel(row.缺陷等级) !== null &&
    Array.isArray(row.等级上报) &&
    parseDate(String(row.处理期限 ?? '')) !== null
  )
}

function ensureDefects(): EntryRow[] {
  const rows = allRows()[DEFECT_MODULE] ?? []
  if (rows.length === 0 || rows.some((row) => !isNormalized(row))) {
    const next = rows.map(normalize)
    saveRows(DEFECT_MODULE, next)
    return next
  }
  return rows
}

export function listDefects(): EntryRow[] {
  return ensureDefects()
}

export function getDefect(id: number): EntryRow | null {
  return listDefects().find((row) => Number(row.id) === id) ?? null
}

function persist(rows: EntryRow[]): void {
  saveRows(DEFECT_MODULE, rows)
}

function syncRow(row: EntryRow): EntryRow {
  const level = latestLevelReport(row)?.缺陷等级
  const synced = normalize({
    ...row,
    缺陷等级: canonicalLevel(level) ?? '一般缺陷',
  })
  return synced
}

function updateRow(id: number, patch: Partial<EntryRow>): EntryRow | null {
  const rows = listDefects()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return null
  }
  const nextRow = syncRow({ ...rows[index], ...patch })
  const next = [...rows]
  next[index] = nextRow
  persist(next)
  return nextRow
}

export type DefectDraft = {
  缺陷设备: string
  缺陷描述: string
  发现人: string
  缺陷等级: DefectLevel
}

export type DefectMutationResult = { ok: boolean; message: string; id?: number }

/** 登记缺陷：自动编号，写入第一份等级上报，期限按等级分档。 */
export function createDefect(draft: DefectDraft): DefectMutationResult {
  const 设备 = draft.缺陷设备.trim()
  if (!设备) {
    return { ok: false, message: '请先填写缺陷设备' }
  }
  const rows = listDefects()
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const now = new Date()
  const today = toDateOnly(now)
  const stamp = `${today}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  const level = canonicalLevel(draft.缺陷等级) ?? '一般缺陷'
  const row: EntryRow = normalize({
    id,
    status: '待处理',
    pending: true,
    abnormal: false,
    缺陷编号: `DEFE-${String(id).padStart(4, '0')}`,
    缺陷设备: 设备,
    缺陷等级: level,
    缺陷描述: draft.缺陷描述.trim(),
    发现人: draft.发现人.trim(),
    发现日期: today,
    处理期限: addDays(today, LEVEL_DEADLINE_DAYS[level]),
    处理人: '',
    缺陷状态: '待处理',
    上报来源: '设备巡视',
    等级上报: [{ 缺陷等级: level, 上报时间: stamp, 上报来源: '初始登记' }],
  })
  persist([...rows, row])
  return { ok: true, message: `缺陷 ${String(row.缺陷编号)} 已登记`, id }
}

/**
 * 保存缺陷底稿（详情抽屉）：等级变动就追加一次上报并按新等级重排期限；
 * 处理期限若由用户显式给出则以用户的为准。
 */
export function saveDefectProfile(
  id: number,
  patch: { 缺陷等级?: DefectLevel; 处理期限?: string; 处理人?: string; 缺陷描述?: string },
): DefectMutationResult {
  const target = getDefect(id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的缺陷记录` }
  }
  const now = new Date()
  const stamp = `${toDateOnly(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  const reports = Array.isArray(target.等级上报)
    ? [...(target.等级上报 as LevelReport[])]
    : []
  const currentLevel = canonicalLevel(target.缺陷等级) ?? '一般缺陷'
  let nextDeadline =
    typeof patch.处理期限 === 'string' && patch.处理期限.trim() !== ''
      ? patch.处理期限.trim()
      : String(target.处理期限 ?? '')

  if (patch.缺陷等级 && patch.缺陷等级 !== currentLevel) {
    reports.push({ 缺陷等级: patch.缺陷等级, 上报时间: stamp, 上报来源: '人工修订' })
    // 等级变了，期限按新档次重排；除非这次同时显式改了期限。
    if (typeof patch.处理期限 !== 'string') {
      nextDeadline = addDays(toDateOnly(now), LEVEL_DEADLINE_DAYS[patch.缺陷等级])
    }
  }

  updateRow(id, {
    等级上报: sortLevelReports(reports),
    处理期限: nextDeadline,
    处理人: patch.处理人 !== undefined ? patch.处理人.trim() : target.处理人,
    缺陷描述:
      patch.缺陷描述 !== undefined ? patch.缺陷描述.trim() : target.缺陷描述,
  })
  return { ok: true, message: '缺陷底稿已保存' }
}

/**
 * 提交处理：同一条缺陷只留一条处理记录，重复提交直接覆盖同一条。
 * 首次提交把状态推进到「处理中」。
 */
export function submitHandling(
  id: number,
  payload: { 处理意见: string; 处理结论: string; 处理人: string },
): DefectMutationResult {
  const target = getDefect(id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的缺陷记录` }
  }
  if (String(target.status) === '已消除') {
    return { ok: false, message: '该缺陷已确认消除，处理意见不再变更' }
  }
  const 处理人 = payload.处理人.trim()
  const 处理意见 = payload.处理意见.trim()
  const 处理结论 = payload.处理结论.trim()
  if (!处理人) {
    return { ok: false, message: '请填写处理人后再提交' }
  }
  if (!处理意见 && !处理结论) {
    return { ok: false, message: '请至少填写处理意见或处理结论' }
  }
  const now = new Date()
  const stamp = `${toDateOnly(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  // 只有一条记录：重复提交在原位更新，不新增。
  const record: HandlingRecord = { 处理意见, 处理结论, 处理人, 提交时间: stamp }
  // 已升级的缺陷保留升级标记，其余首次提交推进到「处理中」。
  const nextStatus = String(target.status) === '已升级' ? '已升级' : '处理中'
  updateRow(id, {
    status: nextStatus,
    pending: true,
    abnormal: nextStatus === '已升级',
    处理人,
    处理记录: record,
  })
  return {
    ok: true,
    message:
      String(target.status) === '处理中'
        ? '处理意见已更新（同一条缺陷仅保留最新一份）'
        : '处理意见已提交，缺陷进入处理中',
  }
}

/** 确认消除：处理结论定稿，巡视待整改清单同步标成已整改。 */
export function confirmEliminated(id: number): DefectMutationResult {
  const target = getDefect(id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的缺陷记录` }
  }
  if (String(target.status) === '已消除') {
    return { ok: false, message: '该缺陷已经是「已消除」，不用重复操作' }
  }
  updateRow(id, {
    status: '已消除',
    pending: false,
    abnormal: false,
    缺陷状态: '已消除',
  })
  return { ok: true, message: `缺陷 ${String(target.缺陷编号)} 已确认消除，巡视待整改清单已同步` }
}

/** 上报升级：等级上调一档并记一次上报，期限按新档次重排。 */
export function escalateDefect(id: number): DefectMutationResult {
  const target = getDefect(id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的缺陷记录` }
  }
  const level = canonicalLevel(target.缺陷等级) ?? '一般缺陷'
  if (level === '危急缺陷') {
    return { ok: false, message: '已经是最高等级「危急缺陷」，无法继续升级' }
  }
  const nextLevel: DefectLevel = level === '一般缺陷' ? '严重缺陷' : '危急缺陷'
  const result = saveDefectProfile(id, { 缺陷等级: nextLevel })
  if (!result.ok) {
    return result
  }
  updateRow(id, { status: '已升级', pending: true, abnormal: true, 缺陷状态: '已升级' })
  return { ok: true, message: `缺陷已升级为「${nextLevel}」，处理期限已按新档次重排` }
}

/** 期限状态：临期（含到期当天）与已超期分开标；已消除的不再提示。 */
export function deadlineInfo(row: EntryRow, today: Date = new Date()): DeadlineInfo {
  const todayOnly = parseDate(toDateOnly(today)) ?? today
  const deadline = parseDate(String(row.处理期限 ?? ''))
  const closed = String(row.status) === '已消除'
  if (!deadline || closed) {
    return {
      期限: String(row.处理期限 ?? ''),
      已超期: false,
      超期天数: 0,
      临期: false,
      剩余天数: 0,
    }
  }
  const diffDays = Math.round((deadline.getTime() - todayOnly.getTime()) / 86_400_000)
  return {
    期限: String(row.处理期限),
    已超期: diffDays < 0,
    超期天数: diffDays < 0 ? -diffDays : 0,
    临期: diffDays >= 0 && diffDays <= EXPIRING_SOON_DAYS,
    剩余天数: diffDays,
  }
}

/**
 * 设备巡视的待整改清单：直接从缺陷底稿派生，不另存一份，
 * 所以缺陷确认消除、处理结论定稿后，这里立即回写为已整改。
 */
export function patrolRectifyList(): RectifyItem[] {
  return listDefects().map((row) => {
    let 处理情况: RectifyStatus
    if (String(row.status) === '已消除') {
      处理情况 = '已整改'
    } else if (String(row.status) === '处理中' || String(row.status) === '已升级') {
      处理情况 = '整改中'
    } else {
      处理情况 = '待整改'
    }
    const record = isHandlingRecord(row.处理记录) ? (row.处理记录 as HandlingRecord) : null
    return {
      缺陷编号: String(row.缺陷编号 ?? ''),
      缺陷设备: String(row.缺陷设备 ?? ''),
      缺陷等级: canonicalLevel(row.缺陷等级) ?? '一般缺陷',
      整改期限: String(row.处理期限 ?? ''),
      处理人: String(row.处理人 ?? ''),
      处理情况,
      处理结论: record?.处理结论 ?? '',
    }
  })
}
