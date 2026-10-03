<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>设备巡视管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视编号、巡视变电站、巡视路线、巡视人做登记、筛选与状态流转。巡视发现的缺陷与缺陷处理结论统一汇入下方待整改清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备巡视清单</button>
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无设备巡视数据，可先登记巡视记录</td>
        </tr>
      </tbody>
    </table>

    <section class="rect-block">
      <header class="rect-head">
        <h3>待整改清单</h3>
        <span class="form-tip">缺陷处理结论确认消除后自动回写到这里；同一条缺陷只产生一条待整改记录。</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>来源巡视</th>
            <th>缺陷编号</th>
            <th>缺陷设备</th>
            <th>缺陷等级</th>
            <th>整改内容</th>
            <th>来源</th>
            <th>登记日期</th>
            <th>整改状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rectifications" :key="item.id">
            <td>{{ item.patrolCode }}</td>
            <td>{{ item.defectCode }}</td>
            <td>{{ item.equipment }}</td>
            <td><span class="level-tag" :class="`level-${item.level}`">{{ item.level }}</span></td>
            <td>{{ item.content }}</td>
            <td>{{ item.source }}</td>
            <td>{{ item.createdAt }}</td>
            <td>{{ item.status }}</td>
            <td class="row-actions">
              <button v-if="item.status === '待整改'" class="link" type="button" @click="closeRect(item.id)">标记已整改</button>
              <button v-else class="link" type="button" @click="reopenRect(item.id)">重新打开</button>
            </td>
          </tr>
          <tr v-if="!rectifications.length">
            <td colspan="9" class="empty-state">暂无待整改项，巡视上报或缺陷处理结论会写入这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备巡视记录 · {{ pendingRectCount }} 条待整改</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 巡视上报缺陷：等级沿用缺陷处置口径，登记后进缺陷底稿并同步待整改清单 -->
    <div v-if="reporting" class="drawer-mask" @click.self="reporting = false">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>巡视上报缺陷 · {{ reportContext?.patrolCode }}</h3>
          <button class="link" type="button" @click="reporting = false">关闭</button>
        </header>
        <div class="drawer-body">
          <p class="form-tip">处理期限按缺陷等级分档：紧急 1 天、重大 7 天、一般 30 天。</p>
          <label class="form-item">
            <span>缺陷设备</span>
            <input v-model="reportForm.equipment" :placeholder="`默认：${reportContext?.station ?? ''}`" />
          </label>
          <label class="form-item">
            <span>缺陷等级</span>
            <select v-model="reportForm.level">
              <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>发现人</span>
            <input v-model="reportForm.discoverer" :placeholder="reportContext?.patroller" />
          </label>
          <label class="form-item">
            <span>缺陷描述</span>
            <textarea v-model="reportForm.description" rows="3" placeholder="巡视发现的问题现象"></textarea>
          </label>
        </div>
        <footer class="drawer-foot">
          <button class="btn ghost" type="button" @click="reporting = false">取消</button>
          <button class="btn primary" type="button" @click="submitReport">上报缺陷</button>
        </footer>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { DEFECT_LEVELS, type DefectLevel } from '@/data/defect-model'
import {
  listRectifications,
  listDefects,
  reportDefect,
  setRectificationStatus,
} from '@/data/defect-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ['巡视编号', '巡视变电站', '巡视路线', '巡视人', '巡视日期', '发现缺陷数', '处理情况', '巡视状态']
const actions = ['提交巡视', '确认完成', '上报问题']
const statuses = ['待巡视', '巡视中', '已完成', '已上报']
const stats = ref([{ label: '待巡视站点', value: 0 }, { label: '已完成巡视', value: 0 }, { label: '待整改项', value: 0 }])
const levels = DEFECT_LEVELS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const rectifications = ref(listRectifications())
const pendingRectCount = computed(() => rectifications.value.filter((item) => item.status === '待整改').length)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const reporting = ref(false)
const reportContext = ref<{ patrolId: number; patrolCode: string; station: string; patroller: string } | null>(null)
const reportForm = reactive({ equipment: '', level: '一般' as DefectLevel, discoverer: '', description: '' })

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡视记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '上报问题') {
    // 同一条巡视重复上报缺陷只留一条：已经登记过就直接提示，不再开单。
    const already = listDefects().some((defect) =>
      defect.reports.some((report) => report.patrolId === Number(row.id)),
    )
    if (already) {
      errorMessage.value = '该巡视记录已上报过缺陷，待整改清单中只保留一条'
      return
    }
    reportContext.value = {
      patrolId: Number(row.id),
      patrolCode: String(row['巡视编号'] ?? row.id),
      station: String(row['巡视变电站'] ?? ''),
      patroller: String(row['巡视人'] ?? ''),
    }
    reportForm.equipment = String(row['巡视变电站'] ?? '')
    reportForm.level = '一般'
    reportForm.discoverer = String(row['巡视人'] ?? '')
    reportForm.description = ''
    reporting.value = true
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function submitReport() {
  if (!reportContext.value) {
    return
  }
  if (!reportForm.description.trim()) {
    errorMessage.value = '请填写缺陷描述'
    return
  }
  const ctx = reportContext.value
  const result = reportDefect({
    equipment: reportForm.equipment.trim() || ctx.station,
    level: reportForm.level,
    discoverer: reportForm.discoverer.trim() || ctx.patroller,
    description: reportForm.description,
    patrolId: ctx.patrolId,
    patrolCode: ctx.patrolCode,
    station: ctx.station,
  })
  errorMessage.value = result.message
  if (result.ok) {
    reporting.value = false
    // 巡视状态随上报流转，并刷新发现缺陷数与待整改清单。
    applyAction(meta.key, ctx.patrolId, '上报问题')
    reload()
  }
}

function closeRect(id: number) {
  const result = setRectificationStatus(id, '已整改')
  errorMessage.value = result.ok ? '' : result.message
  reloadRectifications()
}

function reopenRect(id: number) {
  setRectificationStatus(id, '待整改')
  reloadRectifications()
}

function reloadRectifications() {
  rectifications.value = listRectifications()
  stats.value = [
    { label: '待巡视站点', value: rows.value.filter((row) => String(row.status) === '待巡视').length },
    { label: '已完成巡视', value: rows.value.filter((row) => String(row.status) === '已完成').length },
    { label: '待整改项', value: pendingRectCount.value },
  ]
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
  reloadRectifications()
}

onMounted(reload)
</script>

<style scoped>
.rect-block { margin-top: 18px; }
.rect-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.rect-head h3 { margin: 0; font-size: 15px; }
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
.form-tip { font-size: 12px; color: var(--muted); margin: 0; }
.level-tag {
  display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px;
  background: #eef2f7; color: #475569;
}
.level-紧急 { background: #fee4e2; color: #b42318; }
.level-重大 { background: #ffedd5; color: #c2410c; }
.level-一般 { background: #e0f2fe; color: #0369a1; }
</style>
