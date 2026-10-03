<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷处置管理</h2>
        <p class="page-desc">缺陷记录只有一份底稿：列表、详情抽屉、处理意见都从这里读，写完即存，刷新不回退。处理期限按缺陷等级分档，临期单独标出。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记缺陷记录</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷处置清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-warn">临期：{{ expiringCount }}</span>
      <span class="legend-item legend-danger">已超期：{{ overdueCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>期限提示</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '缺陷编号'">
              <button class="link" type="button" @click="openDetail(row)">{{ row[column] }}</button>
            </template>
            <template v-else-if="column === '缺陷等级'">
              <span :class="['level-badge', levelClass(String(row[column]))]">{{ row[column] }}</span>
            </template>
            <template v-else-if="column === '处理期限'">
              {{ row[column] }}
            </template>
            <template v-else>{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</template>
          </td>
          <td>
            <span v-if="deadlineMap.get(Number(row.id))?.已超期" class="tag tag-danger">
              已超期 {{ deadlineMap.get(Number(row.id))?.超期天数 }} 天
            </span>
            <span v-else-if="deadlineMap.get(Number(row.id))?.临期" class="tag tag-warn">
              临期（剩 {{ deadlineMap.get(Number(row.id))?.剩余天数 }} 天）
            </span>
            <span v-else class="tag tag-ok">正常</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button class="link" type="button" @click="openHandling(row)">提交处理</button>
            <button class="link" type="button" @click="eliminate(row)">确认消除</button>
            <button class="link" type="button" @click="escalate(row)">上报升级</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无缺陷处置数据，可先登记缺陷记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷处置记录 · 同一条缺陷重复提交处理只保留最新一条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记缺陷 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <div class="modal-panel">
        <header class="modal-head">
          <h3>登记缺陷记录</h3>
          <button class="btn ghost" type="button" @click="creating = false">关闭</button>
        </header>
        <div class="form-grid">
          <label class="form-item">
            <span>缺陷设备 *</span>
            <input v-model="createForm.缺陷设备" placeholder="如：220kV××变电站 1号主变差动保护装置" />
          </label>
          <label class="form-item">
            <span>缺陷等级 *</span>
            <select v-model="createForm.缺陷等级">
              <option v-for="level in DEFECT_LEVELS" :key="level" :value="level">{{ level }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>发现人</span>
            <input v-model="createForm.发现人" placeholder="发现缺陷的值班人员" />
          </label>
          <label class="form-item form-wide">
            <span>缺陷描述</span>
            <textarea v-model="createForm.缺陷描述" rows="3" placeholder="缺陷现象、影响范围"></textarea>
          </label>
        </div>
        <p class="form-tip">
          等级选定后按档次自动排期限（危急 {{ levelDays('危急缺陷') }} 天 / 严重 {{ levelDays('严重缺陷') }} 天 / 一般 {{ levelDays('一般缺陷') }} 天），保存后可在详情里修订。
        </p>
        <footer v-if="createError" class="error-text">{{ createError }}</footer>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">保存到底稿</button>
        </footer>
      </div>
    </div>

    <!-- 缺陷详情抽屉：与清单同源，退出再打开看到的还是这份 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <div>
            <h3>{{ detail.缺陷编号 }} · 缺陷详情</h3>
            <p class="page-desc">抽屉与缺陷清单读的是同一份底稿，修订保存后两侧同时更新。</p>
          </div>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>

        <div class="drawer-body">
          <section class="drawer-section">
            <h4>基础信息</h4>
            <dl class="detail-grid">
              <div><dt>缺陷设备</dt><dd>{{ detail.缺陷设备 }}</dd></div>
              <div><dt>发现人</dt><dd>{{ detail.发现人 || '—' }}</dd></div>
              <div><dt>当前状态</dt><dd>{{ detail.status }}</dd></div>
              <div>
                <dt>生效缺陷等级</dt>
                <dd>
                  <span :class="['level-badge', levelClass(profile.缺陷等级)]">{{ profile.缺陷等级 }}</span>
                  <span class="muted">以最近一次上报为准</span>
                </dd>
              </div>
              <div class="detail-wide">
                <dt>缺陷描述</dt>
                <dd>{{ detail.缺陷描述 || '—' }}</dd>
              </div>
            </dl>
          </section>

          <section class="drawer-section">
            <h4>等级上报记录（冲突时最近一次生效）</h4>
            <ul class="timeline">
              <li v-for="(report, index) in levelReports" :key="index" class="timeline-item">
                <span :class="['level-badge', levelClass(report.缺陷等级)]">{{ report.缺陷等级 }}</span>
                <span class="timeline-meta">{{ report.上报时间.replace('T', ' ') }} · {{ report.上报来源 || '未注明来源' }}</span>
              </li>
            </ul>
          </section>

          <section class="drawer-section">
            <h4>处置底稿</h4>
            <div class="form-grid">
              <label class="form-item">
                <span>缺陷等级</span>
                <select v-model="profile.缺陷等级">
                  <option v-for="level in DEFECT_LEVELS" :key="level" :value="level">{{ level }}</option>
                </select>
              </label>
              <label class="form-item">
                <span>处理期限</span>
                <input v-model="profile.处理期限" type="date" />
              </label>
              <label class="form-item form-wide">
                <span>处理人</span>
                <input v-model="profile.处理人" placeholder="负责处置的人员" />
              </label>
            </div>
            <p class="form-tip">
              等级调整会追加一次上报并按新档次重排期限；手工改过的期限以手工为准。
              当前期限
              <span v-if="detailDeadline.已超期" class="tag tag-danger">已超期 {{ detailDeadline.超期天数 }} 天</span>
              <span v-else-if="detailDeadline.临期" class="tag tag-warn">临期（剩 {{ detailDeadline.剩余天数 }} 天）</span>
              <span v-else class="tag tag-ok">正常</span>
            </p>
            <div class="inline-actions">
              <button class="btn primary" type="button" @click="saveProfile">保存修订</button>
              <button class="btn" type="button" @click="escalate(detail)">上报升级</button>
              <button class="btn" type="button" @click="eliminate(detail)">确认消除</button>
            </div>
          </section>

          <section class="drawer-section">
            <h4>处理意见与结论</h4>
            <p v-if="existingHandling" class="form-tip">
              现有一条 {{ existingHandling.提交时间.replace('T', ' ') }} 由「{{ existingHandling.处理人 }}」提交的记录；再次提交会覆盖这一条，不会新增。
            </p>
            <div class="form-grid">
              <label class="form-item form-wide">
                <span>处理意见</span>
                <textarea v-model="handling.处理意见" rows="3" placeholder="处置措施、安排情况"></textarea>
              </label>
              <label class="form-item form-wide">
                <span>处理结论（确认消除后会回写到设备巡视待整改清单）</span>
                <textarea v-model="handling.处理结论" rows="2" placeholder="结论性描述"></textarea>
              </label>
              <label class="form-item">
                <span>处理人</span>
                <input v-model="handling.处理人" placeholder="处理人姓名" />
              </label>
            </div>
            <div class="inline-actions">
              <button class="btn primary" type="button" @click="submitHandlingForm">提交处理</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  DEFECT_LEVELS,
  LEVEL_DEADLINE_DAYS,
  confirmEliminated,
  createDefect,
  deadlineInfo,
  escalateDefect,
  getDefect,
  latestLevelReport,
  listDefects,
  saveDefectProfile,
  submitHandling,
  type DeadlineInfo,
  type DefectLevel,
} from '@/data/defect'
import type { EntryRow, HandlingRecord, LevelReport } from '@/data/types'

const columns = ['缺陷编号', '缺陷设备', '缺陷等级', '发现人', '处理期限', '处理人'] as const
const statuses = ['待处理', '处理中', '已消除', '已升级']
const filterFields: string[] = ['缺陷编号', '缺陷设备', '缺陷等级']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const deadlineMap = computed(() => {
  const map = new Map<number, DeadlineInfo>()
  for (const row of rows.value) {
    map.set(Number(row.id), deadlineInfo(row))
  }
  return map
})

const stats = computed(() => [
  { label: '待处理缺陷', value: rows.value.filter((row) => String(row.status) === '待处理').length },
  { label: '处理中缺陷', value: rows.value.filter((row) => String(row.status) === '处理中').length },
  {
    label: '临期/超期',
    value: rows.value.filter((row) => {
      const info = deadlineMap.value.get(Number(row.id))
      return Boolean(info && (info.临期 || info.已超期))
    }).length,
  },
  {
    label: '本月消除数',
    value: rows.value.filter((row) => {
      const record = row.处理记录
      return (
        String(row.status) === '已消除' &&
        record &&
        typeof record === 'object' &&
        String((record as HandlingRecord).提交时间).slice(0, 7) === todayMonth()
      )
    }).length,
  },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const expiringCount = computed(
  () => rows.value.filter((row) => deadlineMap.value.get(Number(row.id))?.临期).length,
)
const overdueCount = computed(
  () => rows.value.filter((row) => deadlineMap.value.get(Number(row.id))?.已超期).length,
)

function todayMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function levelClass(level: string): string {
  if (level === '危急缺陷') {
    return 'level-critical'
  }
  if (level === '严重缺陷') {
    return 'level-major'
  }
  return 'level-minor'
}

function levelDays(level: DefectLevel): number {
  return LEVEL_DEADLINE_DAYS[level]
}

function reload() {
  errorMessage.value = ''
  try {
    const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
    const matched = listDefects().filter((row) =>
      pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
    )
    rows.value = matched
    total.value = matched.length
    if (detailId.value !== null) {
      syncDetail()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缺陷处置列表读取失败'
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('defect')
}

// ---- 登记 ----
const creating = ref(false)
const createError = ref('')
const createForm = reactive({
  缺陷设备: '',
  缺陷描述: '',
  发现人: '',
  缺陷等级: '一般缺陷' as DefectLevel,
})

function openCreate() {
  createForm.缺陷设备 = ''
  createForm.缺陷描述 = ''
  createForm.发现人 = ''
  createForm.缺陷等级 = '一般缺陷'
  createError.value = ''
  creating.value = true
}

function submitCreate() {
  createError.value = ''
  const result = createDefect({ ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  reload()
}

// ---- 详情抽屉：单一出处，直接读底稿 ----
const detailId = ref<number | null>(null)
const detail = ref<EntryRow | null>(null)
const profile = reactive({
  缺陷等级: '一般缺陷' as DefectLevel,
  处理期限: '',
  处理人: '',
})
const handling = reactive({ 处理意见: '', 处理结论: '', 处理人: '' })

const levelReports = computed<LevelReport[]>(() =>
  detail.value && Array.isArray(detail.value.等级上报)
    ? [...(detail.value.等级上报 as LevelReport[])].sort((a, b) =>
        b.上报时间.localeCompare(a.上报时间),
      )
    : [],
)

const existingHandling = computed<HandlingRecord | null>(
  () => (detail.value?.处理记录 as HandlingRecord | undefined) ?? null,
)

const detailDeadline = computed<DeadlineInfo>(() =>
  detail.value ? deadlineInfo(detail.value) : {
    期限: '',
    已超期: false,
    超期天数: 0,
    临期: false,
    剩余天数: 0,
  },
)

function openDetail(row: EntryRow) {
  detailId.value = Number(row.id)
  errorMessage.value = ''
  syncDetail()
}

function openHandling(row: EntryRow) {
  openDetail(row)
  if (String(row.status) === '已消除') {
    errorMessage.value = '该缺陷已消除，处理记录不再变更'
  }
}

function syncDetail() {
  if (detailId.value === null) {
    return
  }
  const fresh = getDefect(detailId.value)
  if (!fresh) {
    closeDetail()
    return
  }
  detail.value = fresh
  const level = latestLevelReport(fresh)?.缺陷等级
  profile.缺陷等级 = (level as DefectLevel) ?? '一般缺陷'
  profile.处理期限 = String(fresh.处理期限 ?? '')
  profile.处理人 = String(fresh.处理人 ?? '')
  const record = fresh.处理记录 as HandlingRecord | undefined
  handling.处理意见 = record?.处理意见 ?? ''
  handling.处理结论 = record?.处理结论 ?? ''
  handling.处理人 = record?.处理人 ?? String(fresh.处理人 ?? '')
}

function closeDetail() {
  detailId.value = null
  detail.value = null
}

function saveProfile() {
  if (!detail.value) {
    return
  }
  // 只把真正改过的字段交给领域层：只改等级时期限按新档次自动重排；
  // 期限被手工改过则以手工值为准。
  const patch: {
    缺陷等级?: DefectLevel
    处理期限?: string
    处理人?: string
    缺陷描述?: string
  } = {}
  if (profile.缺陷等级 !== (latestLevelReport(detail.value)?.缺陷等级 as DefectLevel)) {
    patch.缺陷等级 = profile.缺陷等级
  }
  if (profile.处理期限 !== String(detail.value.处理期限 ?? '')) {
    patch.处理期限 = profile.处理期限
  }
  if (profile.处理人 !== String(detail.value.处理人 ?? '')) {
    patch.处理人 = profile.处理人
  }
  if (Object.keys(patch).length === 0) {
    errorMessage.value = ''
    return
  }
  const result = saveDefectProfile(Number(detail.value.id), patch)
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function submitHandlingForm() {
  if (!detail.value) {
    return
  }
  const result = submitHandling(Number(detail.value.id), { ...handling })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  reload()
}

function eliminate(row: EntryRow) {
  errorMessage.value = ''
  // 若抽屉里填了意见/结论还没提交，先带着内容一起落到底稿再消除。
  if (detail.value && Number(detail.value.id) === Number(row.id)) {
    if ((handling.处理意见.trim() || handling.处理结论.trim()) && handling.处理人.trim()) {
      const draft = submitHandling(Number(row.id), { ...handling })
      if (!draft.ok) {
        errorMessage.value = draft.message
        return
      }
    }
  }
  const result = confirmEliminated(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function escalate(row: EntryRow) {
  errorMessage.value = ''
  const result = escalateDefect(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

onMounted(reload)
</script>
