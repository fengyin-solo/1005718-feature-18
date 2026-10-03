// 迁移自检：老版本只在通用底稿里留了占位 defect 记录，升级后应被缺陷独立底稿接管。
const mem = new Map<string, string>()

// 预置老版本 localStorage：通用底稿含 3 条占位缺陷，且不存在 defect-store。
mem.set(
  'substation-protection:entries',
  JSON.stringify({
    defect: [
      { id: 1, status: '处理中', pending: true, abnormal: false, 缺陷编号: 'DEFE-0001', 缺陷设备: '旧设备1', 缺陷等级: '缺陷处置样例1', 缺陷描述: '旧描述1', 发现人: '张三', 处理期限: '2026-09-01', 处理人: '李四', 缺陷状态: 'x' },
      { id: 2, status: '已消除', pending: false, abnormal: false, 缺陷编号: 'DEFE-0002', 缺陷设备: '旧设备2', 缺陷等级: '重大', 缺陷描述: '旧描述2', 发现人: '王五', 处理期限: '2026-09-02', 处理人: '赵六', 缺陷状态: 'y' },
    ],
  }),
)
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
} as any

const { listDefects } = await import('../src/data/defect-store')

let failures = 0
const check = (name: string, cond: boolean, extra = '') => {
  console.log(cond ? `PASS ${name}` : `FAIL ${name} ${extra}`)
  if (!cond) failures++
}

const defects = listDefects()
check('旧底稿两条都迁过来', defects.length === 2, `实际 ${defects.length}`)
const first = defects.find((d) => d.id === 1)!
const second = defects.find((d) => d.id === 2)!
check('数据沿用：编号', first.code === 'DEFE-0001')
check('数据沿用：设备', first.equipment === '旧设备1')
check('数据沿用：处理人不丢', first.handler === '李四')
check('口径外等级归到既有口径', ['紧急', '重大', '一般'].includes(first.level), first.level)
check('口径内等级原样保留', second.level === '重大')
check('旧处理期限沿用不重算', first.deadline === '2026-09-01')
check('状态沿用', first.status === '处理中' && second.status === '已消除')

// 第二次加载不再迁移（旧底稿已清空），计数不翻倍
const again = listDefects()
check('再次加载不重复迁移', again.length === 2)
const legacyEntries = JSON.parse(mem.get('substation-protection:entries')!)
check('旧底稿已交出 defect（投影接管）', Array.isArray(legacyEntries.defect) && legacyEntries.defect.length === 2)

process.exit(failures ? 1 : 0)
