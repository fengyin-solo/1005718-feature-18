<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷处置管理</h2>
        <p class="page-desc">维护缺陷记录，围绕缺陷编号、缺陷设备、缺陷等级、缺陷描述做登记、筛选与状态流转。列表、详情与处理意见同读一份底稿，刷新不回退。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记缺陷记录</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷处置清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'stat-warn': item.label === '临期缺陷' && item.value > 0 }">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-warn">临期/超期：{{ nearCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="filters.keyword" placeholder="按编号/设备/描述/处理人检索" />
      </label>
      <label class="filter-item">
        <span>缺陷等级</span>
        <select v-model="filters.level">
          <option value="">全部</option>
          <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>缺陷状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ 'row-near': nearMap.get(row.id) }">
          <td>{{ row.code }}</td>
          <td>{{ row.equipment }}</td>
          <td>
            <span class="level-tag" :class="`level-${row.level}`">{{ row.level }}</span>
          </td>
          <td>{{ row.description }}</td>
          <td>{{ row.discoverer }}</td>
          <td>
            {{ row.deadline }}
            <span v-if="nearMap.get(row.id)" class="near-tag">
              {{ deadlineHint(row.deadline) }}
            </span>
          </td>
          <td>{{ row.handler || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情/处理</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无缺陷处置数据，可先登记缺陷记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷处置记录</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 登记缺陷 -->
    <div v-if="creating" class="drawer-mask" @click.self="creating = false">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>登记缺陷记录</h3>
          <button class="link" type="button" @click="creating = false">关闭</button>
        </header>
        <div class="drawer-body">
          <p class="form-tip">处理期限按缺陷等级分档：紧急 1 天、重大 7 天、一般 30 天，自登记之日起算。</p>
          <label class="form-item">
            <span>缺陷设备</span>
            <input v-model="createForm.equipment" placeholder="如：1号主变本体瓦斯继电器" />
          </label>
          <label class="form-item">
            <span>缺陷等级</span>
            <select v-model="createForm.level">
              <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>发现人</span>
            <input v-model="createForm.discoverer" placeholder="发现人姓名" />
          </label>
          <label class="form-item">
            <span>缺陷描述</span>
            <textarea v-model="createForm.description" rows="3" placeholder="缺陷现象、位置等"></textarea>
          </label>
          <p class="form-tip">按「{{ createForm.level }}」分档，处理期限：{{ createDeadline }}</p>
        </div>
        <footer class="drawer-foot">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">登记</button>
        </footer>
      </aside>
    </div>

    <!-- 详情抽屉：等级与列表同源，处理意见直接落底稿 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer drawer-wide">
        <header class="drawer-head">
          <h3>缺陷详情 · {{ detail.code }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <div class="drawer-body">
          <dl class="detail-grid">
            <div><dt>缺陷设备</dt><dd>{{ detail.equipment }}</dd></div>
            <div>
              <dt>缺陷等级</dt>
              <dd><span class="level-tag" :class="`level-${detail.level}`">{{ detail.level }}</span></dd>
            </div>
            <div><dt>当前状态</dt><dd>{{ detail.status }}</dd></div>
            <div>
              <dt>处理期限</dt>
              <dd>
                {{ detail.deadline }}
                <span v-if="isNear(detail)" class="near-tag">{{ deadlineHint(detail.deadline) }}</span>
              </dd>
            </div>
            <div><dt>发现人</dt><dd>{{ detail.discoverer }}</dd></div>
            <div><dt>处理人</dt><dd>{{ detail.handler || '—' }}</dd></div>
            <div class="detail-span"><dt>缺陷描述</dt><dd>{{ detail.description }}</dd></div>
            <div v-if="detail.conclusion" class="detail-span">
              <dt>处理结论（{{ detail.conclusionAt }}）</dt>
              <dd>{{ detail.conclusion }}</dd>
            </div>
          </dl>

          <section class="detail-block">
            <h4>上报记录</h4>
            <ul class="timeline">
              <li v-for="(report, idx) in detail.reports" :key="idx">
                <strong>{{ report.reportedAt }}</strong>
                <span class="level-tag" :class="`level-${report.level}`">{{ report.level }}</span>
                <span>{{ report.source }}{{ report.patrolId ? ` · 巡视#${report.patrolId}` : '' }} · {{ report.reporter }}</span>
              </li>
            </ul>
            <p class="form-tip">缺陷等级沿用既有口径（紧急/重大/一般），多次上报冲突时以最近一次上报为准。</p>
            <details class="rereport">
              <summary>重新上报（更新等级与期限）</summary>
              <div class="rereport-form">
                <label class="form-item">
                  <span>最新等级</span>
                  <select v-model="rereportForm.level">
                    <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
                  </select>
                </label>
                <label class="form-item">
                  <span>补充描述</span>
                  <textarea v-model="rereportForm.description" rows="2"></textarea>
                </label>
                <button class="btn" type="button" @click="submitRereport">提交上报</button>
              </div>
            </details>
          </section>

          <section class="detail-block">
            <h4>处理意见</h4>
            <ul v-if="detail.handling.length" class="timeline">
              <li v-for="(item, idx) in detail.handling" :key="idx">
                <strong>{{ item.handledAt }}</strong>
                <span class="handle-tag">{{ item.action }}</span>
                <span>{{ item.handler }}：{{ item.opinion }}</span>
              </li>
            </ul>
            <p v-else class="form-tip">暂无处理记录。</p>

            <form v-if="detail.status !== '已消除' && detail.status !== '已升级'" class="handle-form" @submit.prevent="submitHandle">
              <label class="form-item">
                <span>处理人</span>
                <input v-model="handleForm.handler" placeholder="处理人姓名" />
              </label>
              <label class="form-item">
                <span>处理意见</span>
                <textarea v-model="handleForm.opinion" rows="2" placeholder="现场核查与处置意见"></textarea>
              </label>
              <div class="handle-actions">
                <button class="btn primary" type="submit">提交处理</button>
                <button class="btn" type="button" @click="submitResolve">确认消除并回写巡视待整改</button>
                <button class="btn ghost" type="button" @click="submitEscalate">上报升级</button>
              </div>
            </form>
          </section>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  DEFECT_LEVELS,
  DEFECT_STATUSES,
  daysUntil,
  deadlineFor,
  isNearDeadline,
  todayString,
  type DefectLevel,
  type DefectRecord,
} from '@/data/defect-model'
import {
  defectStats,
  escalateDefect,
  exportDefectsCsv,
  getDefect,
  listDefects,
  reportDefect,
  reReport,
  resolveDefect,
  submitHandling,
} from '@/data/defect-store'

const columns = ['缺陷编号', '缺陷设备', '缺陷等级', '缺陷描述', '发现人', '处理期限', '处理人', '缺陷状态']
const levels = DEFECT_LEVELS
const statuses = DEFECT_STATUSES

const rows = ref<DefectRecord[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(true)
const filters = reactive({ keyword: '', level: '', status: '' })

const stats = ref(defectStats())

const nearMap = computed(() => {
  const map = new Map<number, boolean>()
  for (const row of rows.value) {
    map.set(row.id, isNearDeadline(row))
  }
  return map
})
const nearCount = computed(() => rows.value.filter((row) => isNearDeadline(row)).length)
const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => row.status === status).length })),
)

// 抽屉里始终持有最新底稿数据；刷新页面后能按 id 重新取到同一份。
const detail = ref<DefectRecord | null>(null)
const detailId = ref<number | null>(null)

const creating = ref(false)
const createForm = reactive({ equipment: '', level: '一般' as DefectLevel, discoverer: '', description: '' })
const createDeadline = computed(() => deadlineFor(createForm.level, todayString()))

const handleForm = reactive({ handler: '', opinion: '' })
const rereportForm = reactive({ level: '一般' as DefectLevel, description: '' })

function flash(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function deadlineHint(deadline: string): string {
  const days = daysUntil(deadline)
  if (days < 0) {
    return `已超期${-days}天`
  }
  if (days === 0) {
    return '今日到期'
  }
  return `临期剩${days}天`
}

function isNear(row: DefectRecord): boolean {
  return isNearDeadline(row)
}

function resetFilters() {
  filters.keyword = ''
  filters.level = ''
  filters.status = ''
  reload()
}

function exportRows() {
  const { filename, content } = exportDefectsCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openCreate() {
  createForm.equipment = ''
  createForm.level = '一般'
  createForm.discoverer = ''
  createForm.description = ''
  creating.value = true
}

function submitCreate() {
  if (!createForm.equipment.trim() || !createForm.discoverer.trim()) {
    flash('请填写缺陷设备与发现人', false)
    return
  }
  const result = reportDefect({ ...createForm })
  flash(result.message, result.ok)
  if (result.ok) {
    creating.value = false
    reload()
  }
}

function refreshDetail() {
  if (detailId.value === null) {
    return
  }
  detail.value = getDefect(detailId.value) ?? null
}

function openDetail(row: DefectRecord) {
  detailId.value = row.id
  detail.value = getDefect(row.id) ?? null
  handleForm.handler = detail.value?.handler ?? ''
  handleForm.opinion = ''
  rereportForm.level = detail.value?.level ?? '一般'
  rereportForm.description = ''
}

function closeDetail() {
  detail.value = null
  detailId.value = null
}

function submitHandle() {
  if (!detail.value) {
    return
  }
  const result = submitHandling(detail.value.id, { ...handleForm })
  flash(result.message, result.ok)
  if (result.ok) {
    handleForm.opinion = ''
    refreshDetail()
    reload()
  }
}

function submitResolve() {
  if (!detail.value) {
    return
  }
  if (!handleForm.handler.trim()) {
    flash('请先填写处理人再确认消除', false)
    return
  }
  // 未提交过处理意见时先落一条处理记录，保证处理人不丢；已提交过则不重复记录。
  if (!detail.value.handling.some((item) => item.action === '提交处理')) {
    const first = submitHandling(detail.value.id, {
      handler: handleForm.handler,
      opinion: handleForm.opinion.trim() || '现场处理完成',
    })
    if (!first.ok) {
      flash(first.message, false)
      return
    }
  }
  const conclusion = handleForm.opinion.trim() || '现场处理完成，试运正常'
  const result = resolveDefect(detail.value.id, conclusion)
  flash(result.message, result.ok)
  if (result.ok) {
    refreshDetail()
    reload()
  }
}

function submitEscalate() {
  if (!detail.value) {
    return
  }
  const result = escalateDefect(detail.value.id, handleForm.opinion)
  flash(result.message, result.ok)
  if (result.ok) {
    refreshDetail()
    reload()
  }
}

function submitRereport() {
  if (!detail.value) {
    return
  }
  const result = reReport(detail.value.id, { level: rereportForm.level, description: rereportForm.description })
  flash(result.message, result.ok)
  if (result.ok) {
    refreshDetail()
    reload()
  }
}

function reload() {
  message.value = ''
  rows.value = listDefects(filters)
  total.value = rows.value.length
  stats.value = defectStats()
  refreshDetail()
}

onMounted(reload)
</script>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}
.drawer {
  width: 420px;
  max-width: 92vw;
  background: #fff;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.15);
}
.drawer-wide { width: 560px; }
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.drawer-head h3 { margin: 0; font-size: 15px; }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}
.form-item { display: block; margin-bottom: 12px; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.form-item input, .form-item textarea, .form-item select {
  width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit;
}
.form-tip { font-size: 12px; color: var(--muted); margin: 4px 0 10px; }
.detail-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 0 0 12px;
}
.detail-grid dt { font-size: 12px; color: var(--muted); }
.detail-grid dd { margin: 2px 0 0; font-size: 13px; }
.detail-span { grid-column: 1 / -1; }
.detail-block { border-top: 1px dashed var(--border); padding-top: 10px; margin-top: 10px; }
.detail-block h4 { margin: 0 0 8px; font-size: 13px; }
.timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.timeline li { display: flex; gap: 8px; align-items: center; font-size: 13px; flex-wrap: wrap; }
.timeline strong { font-weight: 600; color: #334155; min-width: 86px; }
.handle-tag, .level-tag {
  display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px;
  background: #eef2f7; color: #475569;
}
.level-紧急 { background: #fee4e2; color: #b42318; }
.level-重大 { background: #ffedd5; color: #c2410c; }
.level-一般 { background: #e0f2fe; color: #0369a1; }
.near-tag { border-radius: 999px; padding: 1px 8px; font-size: 12px; background: #fef3c7; color: #b45309; }
.row-near { background: #fffbeb; }
.legend-warn { background: #fef3c7; color: #b45309; }
.stat-warn { color: #b42318; }
.ok-text { color: #067647; }
.rereport { margin: 8px 0; font-size: 13px; }
.rereport-form { margin-top: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.handle-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.filter-item select { border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; }
</style>
