<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>设备巡视管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视编号、巡视变电站、巡视路线、巡视人做登记、筛选与状态流转。</p>
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

    <footer class="page-foot">
      <span>共 {{ total }} 条设备巡视记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="sub-panel">
      <header class="sub-panel-head">
        <div>
          <h3>待整改清单</h3>
          <p class="page-desc">清单由缺陷处置底稿直接派生：缺陷在处置页确认消除并填写处理结论后，这里自动回写为已整改，无需另录一份。</p>
        </div>
        <button class="btn" type="button" @click="reloadRectify">刷新整改情况</button>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>缺陷编号</th>
            <th>缺陷设备</th>
            <th>缺陷等级</th>
            <th>整改期限</th>
            <th>处理人</th>
            <th>处理结论</th>
            <th>处理情况</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rectifyRows" :key="item.缺陷编号">
            <td>{{ item.缺陷编号 }}</td>
            <td>{{ item.缺陷设备 }}</td>
            <td><span :class="['level-badge', levelClass(item.缺陷等级)]">{{ item.缺陷等级 }}</span></td>
            <td>{{ item.整改期限 }}</td>
            <td>{{ item.处理人 || '—' }}</td>
            <td>{{ item.处理结论 || '—' }}</td>
            <td>
              <span :class="['tag', rectifyTagClass(item.处理情况)]">{{ item.处理情况 }}</span>
            </td>
          </tr>
          <tr v-if="!rectifyRows.length">
            <td colspan="7" class="empty-state">暂无巡视发现的缺陷整改项</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ rectifyRows.length }} 项 · 待整改 {{ pendingRectifyCount }} 项 · 整改中 {{ doingRectifyCount }} 项 · 已整改 {{ doneRectifyCount }} 项</span>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { patrolRectifyList, type RectifyItem } from '@/data/defect'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视编号", "巡视变电站", "巡视路线", "巡视人", "巡视日期", "发现缺陷数", "处理情况", "巡视状态"]
const actions = ["提交巡视", "确认完成", "上报问题"]
const statuses = ["待巡视", "巡视中", "已完成", "已上报"]
const stats = [{"label": "待巡视站点", "value": 0}, {"label": "已完成巡视", "value": 0}, {"label": "本月发现问题数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 待整改清单与缺陷处置共用同一份底稿，刷新页面、消除缺陷后这里同步。
const rectifyRows = ref<RectifyItem[]>([])
const pendingRectifyCount = computed(
  () => rectifyRows.value.filter((item) => item.处理情况 === '待整改').length,
)
const doingRectifyCount = computed(
  () => rectifyRows.value.filter((item) => item.处理情况 === '整改中').length,
)
const doneRectifyCount = computed(
  () => rectifyRows.value.filter((item) => item.处理情况 === '已整改').length,
)

function levelClass(level: string): string {
  if (level === '危急缺陷') {
    return 'level-critical'
  }
  if (level === '严重缺陷') {
    return 'level-major'
  }
  return 'level-minor'
}

function rectifyTagClass(status: string): string {
  if (status === '已整改') {
    return 'tag-ok'
  }
  if (status === '整改中') {
    return 'tag-warn'
  }
  return 'tag-danger'
}

function reloadRectify() {
  rectifyRows.value = patrolRectifyList()
}

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
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
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
}

onMounted(() => {
  reload()
  reloadRectify()
})
</script>
