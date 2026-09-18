<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, fpShort } from '../api';
import { useToastStore } from '../stores/toast';

interface SwitchRow {
  id: string;
  switchedAt: string;
  nodeId: string;
  nodeName: string;
  action: 'deploy' | 'rollback';
  fromLabel: string | null;
  toLabel: string | null;
  toFingerprint: string | null;
  detail: string | null;
}

const props = defineProps<{ tick: number }>();
const toast = useToastStore();
const rows = ref<SwitchRow[]>([]);

async function load() {
  try {
    rows.value = await api.get<SwitchRow[]>('/nodes/switch-log');
  } catch (e) {
    toast.fromError(e, '加载切换记录失败');
  }
}

onMounted(load);
watch(() => props.tick, load);
</script>

<template>
  <section class="panel">
    <h2>节点切换记录（append-only，含最终指纹）</h2>
    <table>
      <thead>
        <tr><th>时间</th><th>节点</th><th>动作</th><th>从</th><th>到</th><th>最终指纹</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td class="mono muted">{{ new Date(r.switchedAt).toLocaleString('zh-CN') }}</td>
          <td>{{ r.nodeName }}</td>
          <td>
            <span class="badge" :class="r.action === 'rollback' ? 'rolled_back' : 'running'">
              {{ r.action === 'rollback' ? '回滚' : '部署' }}
            </span>
          </td>
          <td class="muted">{{ r.fromLabel ?? '（无）' }}</td>
          <td>{{ r.toLabel ?? '（无）' }}</td>
          <td class="fp">{{ r.toFingerprint ? fpShort(r.toFingerprint, 14) + '…' : '—' }}</td>
          <td class="muted" style="font-size:12px">{{ r.detail ?? '' }}</td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="7" class="muted" style="text-align:center;padding:20px">暂无切换</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
