<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, fpShort } from '../api';
import { useToastStore } from '../stores/toast';

interface Candidate {
  certId: string;
  label: string;
  fingerprint: string;
  notAfter: string;
  isActive: boolean;
}
interface Row {
  nodeId: string;
  nodeName: string;
  env: string;
  domain: string;
  currentCertId: string | null;
  candidates: Candidate[];
}
interface RollbackResult {
  ok: boolean;
  moved: boolean;
  results: { nodeId: string; nodeName: string; ok: boolean; skipped?: boolean; reason?: string; fingerprint?: string }[];
  blockers: string[];
}

const props = defineProps<{ deploymentId: string }>();
const emit = defineEmits<{ (e: 'done'): void }>();
const toast = useToastStore();

const rows = ref<Row[]>([]);
const targets = ref<Record<string, string>>({});
const selected = ref<Record<string, boolean>>({});
const lastResult = ref<RollbackResult | null>(null);
const busy = ref(false);

onMounted(async () => {
  rows.value = await api.get<Row[]>(`/deployments/${props.deploymentId}/rollback-candidates`);
  for (const r of rows.value) {
    // default: every node, first valid matching candidate (usually the previous cert)
    selected.value[r.nodeId] = true;
    targets.value[r.nodeId] = r.candidates[0]?.certId ?? '';
  }
});

async function submit() {
  const nodeIds = Object.entries(selected.value)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (nodeIds.length === 0) {
    toast.fail('请至少选择一个节点');
    return;
  }
  // rollback only supports one shared target per call; ensure consistency
  const targetIds = new Set(nodeIds.map((id) => targets.value[id]).filter(Boolean));
  if (targetIds.size > 1) {
    toast.fail('一次回滚只能选择同一张目标证书；请按目标证书分批回滚');
    return;
  }
  busy.value = true;
  try {
    lastResult.value = await api.post<RollbackResult>(
      `/deployments/${props.deploymentId}/rollback`,
      { certId: [...targetIds][0] || undefined, nodeIds },
    );
    if (lastResult.value.moved) toast.ok('回滚完成，未选择/失败的节点保留其实际版本');
    if (lastResult.value.blockers.length) toast.fail('部分节点被阻止', lastResult.value.blockers);
    emit('done');
  } catch (e) {
    toast.fromError(e, '回滚失败');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="panel" style="background:var(--panel-2);border-color:var(--err);margin-top:12px">
    <h3 class="err-text">回滚 —— 仅允许回到「仍在有效期内且覆盖该节点域名」的证书</h3>
    <p class="muted" style="margin-top:0">
      每个节点独立校验目标证书；某节点回滚失败不会改动其他节点。当前正使用的证书标记为「当前」。
    </p>
    <table>
      <thead>
        <tr><th style="width:36px"></th><th>节点</th><th>域名</th><th>回滚目标</th><th>候选有效期</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.nodeId">
          <td><input type="checkbox" v-model="selected[r.nodeId]" /></td>
          <td>{{ r.nodeName }} <span class="badge" :class="r.env">{{ r.env }}</span></td>
          <td class="mono">{{ r.domain }}</td>
          <td>
            <select v-if="r.candidates.length" v-model="targets[r.nodeId]">
              <option v-for="c in r.candidates" :key="c.certId" :value="c.certId">
                {{ c.label }} {{ c.isActive ? '（当前）' : '' }}
              </option>
            </select>
            <span v-else class="err-text">无有效且匹配的候选</span>
          </td>
          <td class="mono muted">
            <template v-for="c in r.candidates" :key="c.certId">
              <div v-if="c.certId === targets[r.nodeId]">
                {{ fpShort(c.fingerprint, 8) }} → {{ new Date(c.notAfter).toLocaleDateString('zh-CN') }}
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:10px">
      <button class="danger" :disabled="busy" @click="submit">
        <span v-if="busy" class="spinner"></span>执行回滚
      </button>
    </div>
    <details v-if="lastResult" open>
      <summary>回滚结果</summary>
      <table style="margin-top:6px">
        <tbody>
          <tr v-for="x in lastResult.results" :key="x.nodeId">
            <td>{{ x.nodeName }}</td>
            <td :class="x.ok ? 'ok-text' : 'err-text'">
              {{ x.ok ? (x.skipped ? '已在目标版本，跳过' : '回滚成功') : '未变更：' + x.reason }}
            </td>
            <td class="fp">{{ x.fingerprint ? fpShort(x.fingerprint, 14) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>
