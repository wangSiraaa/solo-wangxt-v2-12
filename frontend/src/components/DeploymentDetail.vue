<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, fpShort } from '../api';
import { useToastStore } from '../stores/toast';
import RollbackPanel from './RollbackPanel.vue';

interface Task {
  id: string;
  nodeId: string;
  nodeName: string;
  region: string;
  env: string;
  batchIndex: number;
  domain: string;
  status: string;
  attemptCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  nodeActualFingerprint: string | null;
}
interface Receipt {
  id: string;
  nodeId: string;
  nodeName: string;
  result: string;
  requestId: string;
  reportedFingerprint: string;
  detail: string;
  receivedAt: string;
}
interface Detail {
  id: string;
  status: string;
  batchIndex: number;
  currentEnv: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  totalBatches: number;
  cert: { id: string; label: string; fingerprint: string; notAfter: string; sanDomains: string[] };
  tasks: Task[];
  receipts: Receipt[];
}

const props = defineProps<{ id: string; tick: number }>();
const emit = defineEmits<{ (e: 'back'): void }>();
const toast = useToastStore();

const detail = ref<Detail | null>(null);
const loading = ref(false);
const busy = ref(false);
const showReceipts = ref(false);
const showRollback = ref(false);
const flashEnv = ref('');

async function load(flash = false) {
  loading.value = true;
  try {
    detail.value = await api.get<Detail>(`/deployments/${props.id}`);
    if (flash) {
      flashEnv.value = detail.value.currentEnv;
      setTimeout(() => (flashEnv.value = ''), 1000);
    }
  } catch (e) {
    toast.fromError(e, '加载部署详情失败');
  } finally {
    loading.value = false;
  }
}

async function act(path: string, okMsg: string) {
  busy.value = true;
  try {
    await api.post(path);
    toast.ok(okMsg);
    await load(true);
  } catch (e) {
    toast.fromError(e);
  } finally {
    busy.value = false;
  }
}

const batches = computed(() => {
  if (!detail.value) return [];
  return Array.from({ length: detail.value.totalBatches }, (_, i) => {
    const list = detail.value!.tasks.filter((t) => t.batchIndex === i);
    return {
      index: i,
      env: list[0]?.env ?? `batch-${i}`,
      tasks: list,
      allOk: list.length > 0 && list.every((t) => t.status === 'succeeded'),
      hasFailure: list.some((t) => t.status === 'failed' || t.status === 'timeout'),
      isCurrent: i === detail.value!.batchIndex,
    };
  });
});

const canStart = computed(() => {
  if (!detail.value) return false;
  // fresh plan: nothing in the current batch has run yet
  const current = batches.value[detail.value.batchIndex];
  const untouched = current?.tasks.every((t) => t.status === 'pending');
  return (
    ['paused', 'failed'].includes(detail.value.status) &&
    (untouched || detail.value.status === 'failed')
  );
});
const canPromote = computed(
  () =>
    detail.value?.status === 'paused' &&
    batches.value[detail.value.batchIndex]?.allOk &&
    detail.value.batchIndex < detail.value.totalBatches - 1,
);
const canRetry = computed(
  () =>
    detail.value?.status === 'failed' ||
    (detail.value?.status === 'paused' && batches.value[detail.value.batchIndex]?.hasFailure),
);
const canPause = computed(() => detail.value?.status === 'running');

function statusLabel(s: string) {
  return (
    {
      paused: '灰度门暂停',
      running: '执行中',
      completed: '已完成',
      failed: '批次失败',
      rolled_back: '已回滚',
      in_flight: '下发中',
      succeeded: '成功',
      timeout: '超时',
      pending: '待执行',
    } as Record<string, string>
  )[s] ?? s;
}

onMounted(() => load());
watch(() => props.id, () => load());
watch(() => props.tick, () => {
  if (detail.value?.status === 'running') load();
});
</script>

<template>
  <section class="panel" v-if="detail">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin-bottom:4px">
          <span class="badge" :class="detail.status">{{ statusLabel(detail.status) }}</span>
          发布 {{ detail.cert.label }}
        </h2>
        <div class="muted">
          目标指纹 <span class="fp">{{ fpShort(detail.cert.fingerprint, 14) }}…</span>
          · 覆盖 {{ detail.cert.sanDomains.join(', ') }}
          · 到期 {{ new Date(detail.cert.notAfter).toLocaleDateString('zh-CN') }}
        </div>
        <div class="muted" style="margin-top:4px">{{ detail.note ?? '' }}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="sm" @click="emit('back')">← 返回列表</button>
        <button class="sm" @click="load()">刷新</button>
        <button class="sm primary" v-if="canStart && detail.batchIndex === 0 && !batches[0]?.tasks.some(t=>t.status==='succeeded')"
          :disabled="busy" @click="act(`/deployments/${detail.id}/start`, 'test 批次已开始，等待节点回执')">
          ▶ 开始 test
        </button>
        <button class="sm" v-else-if="canStart" :disabled="busy"
          @click="act(`/deployments/${detail.id}/start`, '批次已重新开始')">
          ▶ 开始当前批次
        </button>
        <button class="sm warn" :disabled="busy || !canPause"
          @click="act(`/deployments/${detail.id}/pause`, '已请求暂停：当前批次结束后停在灰度门')">⏸ 暂停</button>
        <button class="sm" :disabled="busy || !canRetry"
          @click="act(`/deployments/${detail.id}/retry`, '已重试当前批次失败节点')">↻ 重试失败节点</button>
        <button class="sm primary" :disabled="busy || !canPromote"
          @click="act(`/deployments/${detail.id}/promote`, `已推进至 ${batches[detail.batchIndex + 1]?.env} 批次` )">
          ⏭ 推进 {{ batches[detail.batchIndex + 1]?.env ?? '' }}
        </button>
        <button class="sm danger" :disabled="busy"
          @click="showRollback = !showRollback">↩ 回滚</button>
      </div>
    </div>

    <div v-for="b in batches" :key="b.index" class="panel"
      :style="{ background: 'var(--panel-2)', opacity: b.index > detail.batchIndex && detail.status !== 'completed' && detail.status !== 'rolled_back' ? 0.6 : 1 }"
      :class="{ flash: flashEnv === b.env }">
      <h3>
        批次 {{ b.index }} ·
        <span class="badge" :class="b.env">{{ b.env }}</span>
        <span v-if="b.isCurrent" class="muted" style="text-transform:none;margin-left:8px">← 当前</span>
        <span v-if="b.allOk" class="ok-text" style="margin-left:8px">全部成功</span>
        <span v-else-if="b.hasFailure" class="err-text" style="margin-left:8px">存在失败，其他节点保留各自实际版本</span>
      </h3>
      <table>
        <thead>
          <tr><th>节点</th><th>区域</th><th>域名</th><th>结果</th><th>尝试</th><th>错误</th><th>节点最终实际指纹</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in b.tasks" :key="t.id">
            <td>{{ t.nodeName }}</td>
            <td class="muted">{{ t.region }}</td>
            <td class="mono">{{ t.domain }}</td>
            <td><span class="badge" :class="t.status">{{ statusLabel(t.status) }}</span></td>
            <td class="mono">{{ t.attemptCount }}</td>
            <td class="err-text" style="max-width:320px;font-size:12px">{{ t.error ?? '' }}</td>
            <td class="fp">{{ t.nodeActualFingerprint ? fpShort(t.nodeActualFingerprint, 14) + '…' : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <RollbackPanel v-if="showRollback" :deployment-id="detail.id" @done="load(true)" />

    <div style="margin-top:8px">
      <button class="sm" @click="showReceipts = !showReceipts">
        {{ showReceipts ? '隐藏' : '查看' }} 节点回执（{{ detail.receipts.length }}）
      </button>
      <table v-if="showReceipts" style="margin-top:8px">
        <thead>
          <tr><th>时间</th><th>节点</th><th>结果</th><th>上报指纹</th><th>request_id</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in detail.receipts" :key="r.id">
            <td class="mono muted">{{ new Date(r.receivedAt).toLocaleTimeString('zh-CN') }}</td>
            <td>{{ r.nodeName }}</td>
            <td><span class="badge" :class="r.result">{{ r.result }}</span></td>
            <td class="fp">{{ fpShort(r.reportedFingerprint, 10) }}</td>
            <td class="mono muted" style="font-size:11px">{{ r.requestId.slice(0, 8) }}</td>
            <td class="muted" style="font-size:12px">{{ r.detail }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
