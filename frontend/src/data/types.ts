/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 缺陷等级的一次上报记录；同一条缺陷多次上报时，以最近一次为准。 */
export type LevelReport = {
  缺陷等级: string
  上报时间: string
  上报来源?: string
}

/** 缺陷处理意见与结论：同一条缺陷只保留一条，重复提交以最新内容覆盖。 */
export type HandlingRecord = {
  处理意见: string
  处理结论: string
  处理人: string
  提交时间: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | LevelReport[] | HandlingRecord | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
