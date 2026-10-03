/**
 * 缺陷处置领域模型：列表、详情抽屉、处理意见、巡视待整改清单全部从这里读写。
 * 数据独立持久化在 localStorage（defect-store 键），刷新或重新打开页面后仍是同一份。
 */

export type DefectLevel = '紧急' | '重大' | '一般'

export type DefectStatus = '待处理' | '处理中' | '已消除' | '已升级'

export type RectificationStatus = '待整改' | '已整改'

// 沿用既有缺陷口径：紧急/重大/一般三级。上报等级不在口径内时按一般兜底。
export const DEFECT_LEVELS: DefectLevel[] = ['紧急', '重大', '一般']

// 处理期限按缺陷等级分档（自最近一次上报之日起算）。
export const LEVEL_DEADLINE_DAYS: Record<DefectLevel, number> = {
  紧急: 1,
  重大: 7,
  一般: 30,
}

export const DEFECT_STATUSES: DefectStatus[] = ['待处理', '处理中', '已消除', '已升级']

// 距处理期限还剩几天以内算临期（含已超期）。
export const NEAR_DEADLINE_DAYS = 2

export type HandleRecord = {
  action: '提交处理' | '确认消除' | '上报升级'
  handler: string
  opinion: string
  handledAt: string
}

export type ReportRecord = {
  level: DefectLevel
  reportedAt: string
  reporter: string
  source: '登记' | '上报'
  patrolId?: number
}

export type DefectRecord = {
  id: number
  code: string
  equipment: string
  description: string
  discoverer: string
  level: DefectLevel
  status: DefectStatus
  deadline: string
  handler: string
  // 历次上报，按时间追加；最新一条是当前缺陷等级的口径来源（冲突以最近一次上报为准）。
  reports: ReportRecord[]
  // 处理意见流水：每提交一次处理追加一条；同一条缺陷重复提交只保留第一次。
  handling: HandleRecord[]
  conclusion: string
  conclusionAt: string
  createdAt: string
}

export type RectificationItem = {
  id: number
  defectCode: string
  equipment: string
  level: DefectLevel
  description: string
  source: '巡视上报' | '处理结论'
  patrolId: number
  patrolCode: string
  station: string
  content: string
  status: RectificationStatus
  createdAt: string
}

export function normalizeLevel(value: unknown): DefectLevel {
  return DEFECT_LEVELS.includes(value as DefectLevel) ? (value as DefectLevel) : '一般'
}

function toDateOnly(value: string): string {
  return value.slice(0, 10)
}

export function todayString(): string {
  return toDateOnly(new Date().toISOString())
}

export function addDays(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toDateOnly(date.toISOString())
}

// 按等级分档计算处理期限：从上上报日期起算。
export function deadlineFor(level: DefectLevel, reportedAt: string): string {
  return addDays(reportedAt, LEVEL_DEADLINE_DAYS[level])
}

// 剩余天数（负数表示已超期）。
export function daysUntil(deadline: string, today = todayString()): number {
  const due = new Date(`${deadline}T00:00:00`).getTime()
  const now = new Date(`${today}T00:00:00`).getTime()
  return Math.round((due - now) / 86400000)
}

// 临期：未结案（待处理/处理中）且距期限不超过 NEAR_DEADLINE_DAYS 天，超期也算。
export function isNearDeadline(record: Pick<DefectRecord, 'status' | 'deadline'>): boolean {
  if (record.status === '已消除' || record.status === '已升级') {
    return false
  }
  return daysUntil(record.deadline) <= NEAR_DEADLINE_DAYS
}
