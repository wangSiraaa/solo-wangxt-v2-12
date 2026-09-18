<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../api';
import { useToastStore } from '../stores/toast';
import CreateDeployment from './CreateDeployment.vue';

interface DeploymentRow {
  id: string;
  certId: string;
  certLabel: string;
  certFingerprint: string;
  status: string;
  batchIndex: number;
  currentEnv: string;
  note: string | null;
  createdAt: string;
  batches: { env: string; total: number; succeeded: number; failed: number; pending: number }[];
}

const props = defineProps<{ tick: number }>();
const emit = defineEmits<{
  (e: 'open', id: string): void;
  (e: 'go-certs'): void;
}>();
const toast = useToastStore();
const rows = ref<DeploymentRow[]>([]);
const showCreate = ref(false);
const createCertId = ref<string | null>(null);

async function load() {
  try {
    rows.value = await api.get<DeploymentRow[]>('/deployments');
  } catch (e) {
    toast.fromError(e, '加载发布列表失败');
  }
}

function statusLabel(s: string) {
  return (
    {
      paused: '灰度门暂停',
      running: '执行中',
      completed: '已完成',
      failed: '批次失败',
      rolled_back: '已回滚',
      draft: '草稿',
    } as Record<string, string>
  )[s] ?? s;
}

onMounted(load);
watch(() => props.tick, () => {
  // background refresh is only noisy while something is active
  if (rows.value.some((r) => r.status === 'running')) load();
});
</script>

<template>
  <section class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>发布计划（test → canary → prod 分批灰度）</h2>
      <button class="sm primary" @click="showCreate = true">＋ 新建发布</button>
    </div>

    <CreateDeployment
      v-if="showCreate"
      :cert-id="createCertId"
      @close="showCreate = false"
      @created="(id) => { showCreate = false; emit('open', id); }"
    />

    <table style="margin-top:10px">
      <thead>
        <tr>
          <th>状态</th><th>证书</th><th>批次进度</th><th>当前环境</th><th>备注</th><th>创建时间</th><th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in rows" :key="d.id">
          <td><span class="badge" :class="d.status">{{ statusLabel(d.status) }}</span></td>
          <td>
            <div>{{ d.certLabel }}</div>
          </td>
          <td>
            <span v-for="b in d.batches" :key="b.env" style="margin-right:10px">
              <span class="badge" :class="b.env">{{ b.env }}</span>
              <span class="mono">
                <span class="ok-text">{{ b.succeeded }}</span>/
                <span :class="b.failed ? 'err-text' : ''">{{ b.failed ? b.failed + '败/' : '' }}</span>
                {{ b.total }}
              </span>
            </span>
          </td>
          <td><span class="badge" :class="d.currentEnv">{{ d.currentEnv }}</span></td>
          <td class="muted" style="max-width:280px">{{ d.note ?? '—' }}</td>
          <td class="muted mono">{{ new Date(d.createdAt).toLocaleString('zh-CN') }}</td>
          <td><button class="sm" @click="emit('open', d.id)">查看/操作</button></td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="7" class="muted" style="text-align:center;padding:20px">
            还没有发布计划，<a href="#" @click.prevent="emit('go-certs')">先去上传/选择证书</a>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
