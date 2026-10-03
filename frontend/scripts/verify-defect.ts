// 逻辑自检：垫片 localStorage 后直接驱动缺陷底稿，验证持久化、分档期限、去重与回写。
const mem = new Map<string, string>()
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
} as any

import {
  defectStats,
  getDefect,
  listDefects,
  listRectifications,
  reportDefect,
  resolveDefect,
  submitHandling,
} from '../src/data/defect-store'
import { daysUntil, isNearDeadline } from '../src/data/defect-model'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures++
    console.error(`FAIL ${name} ${extra}`)
  }
}

// 1. 新底稿自带示例，期限按等级分档
const all = listDefects()
const urgent = all.find((d) => d.level === '紧急')!
const major = all.find((d) => d.level === '重大')!
const normal = all.find((d) => d.level === '一般')!
check('紧急期限=1天', daysUntil(urgent.deadline) === 1, urgent.deadline)
check('重大期限=7天', daysUntil(major.deadline) === 7, major.deadline)
check('一般期限=30天', daysUntil(normal.deadline) === 30, normal.deadline)
check('紧急示例临期', isNearDeadline(urgent))
check('一般示例不临期', !isNearDeadline(normal))

// 2. 提交处理：处理人/意见落底稿，刷新后仍在，重复提交只留一条
const target = major.id
const first = submitHandling(target, { handler: '赵工', opinion: '已停电核查' })
check('首次提交成功', first.ok, first.message)
let saved = getDefect(target)!
check('处理人已落底稿', saved.handler === '赵工')
check('处理意见已落底稿', saved.handling.length === 1 && saved.handling[0].opinion === '已停电核查')
check('状态转处理中', saved.status === '处理中')
// 模拟“刷新”：清掉模块缓存做不到，但 getDefect 每次都从持久层读，直接重读即可
saved = getDefect(target)!
check('重读后处理人不丢', saved.handler === '赵工')
const again = submitHandling(target, { handler: '钱工', opinion: '再来一次' })
check('重复提交被拒绝', !again.ok, again.message)
saved = getDefect(target)!
check('重复提交不覆盖处理人', saved.handler === '赵工')
check('处理流水仍只有一条', saved.handling.filter((h) => h.action === '提交处理').length === 1)

// 3. 列表与详情同源
const listRow = listDefects({ level: '重大' })[0]
const detailRow = getDefect(listRow.id)!
check('列表与详情等级一致', listRow.level === detailRow.level && listRow.level === '重大')

// 4. 巡视上报缺陷 -> 进待整改清单；确认消除 -> 处理结论回写；同巡视重复上报只一条
const reported = reportDefect({
  equipment: '2号主变冷控箱',
  level: '重大',
  discoverer: '孙巡视',
  description: '冷控箱加热器不启动',
  patrolId: 99,
  patrolCode: 'PATR-0099',
  station: '某站',
})
check('巡视上报成功', reported.ok, reported.message)
const newId = reported.record!.id
let rects = listRectifications()
check('上报即生成一条待整改', rects.some((r) => r.defectCode === reported.record!.code && r.status === '待整改' && r.source === '巡视上报'))
submitHandling(newId, { handler: '周工', opinion: '更换加热器' })
const resolved = resolveDefect(newId, '更换加热器后试运正常')
check('确认消除成功', resolved.ok, resolved.message)
check('缺陷状态已消除', getDefect(newId)!.status === '已消除')
rects = listRectifications().filter((r) => r.defectCode === reported.record!.code)
check('处理结论回写待整改清单', rects.some((r) => r.source === '处理结论' && r.content === '更换加热器后试运正常'))
const dupResolve = resolveDefect(newId, '又消除一次')
check('重复消除被拒绝', !dupResolve.ok)

// 5. 看板投影：通用存储里的缺陷与底稿一致
const projection = JSON.parse(mem.get('substation-protection:entries')!)
const projected = projection.defect.find((r: any) => r.id === newId)
check('通用底稿已收到投影', projected && projected['缺陷等级'] === '重大' && projected.status === '已消除')

check('统计含临期数', defectStats().some((s) => s.label === '临期缺陷'))

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
