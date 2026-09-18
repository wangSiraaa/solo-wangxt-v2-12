<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, fmtDate, shortFp } from '../api';

const props = defineProps<{ id: string }>();

interface Assignment {
  id: string; nodeName: string; batch: number; state: string;
  targetFingerprint: string; reportedFingerprint: string | null;
  error: string | null; attempts: number; completedAt: string | null;
}
interface Plan {
  id: string; name: string; state: string; domains: string[];
  canaryCount: number; isRollback: boolean; rollbackOfPlanId: string | null;
}
interface Cert { id: string; name: string; fingerprint: string }
interface RollbackTarget {
  id: string; name: string; fingerprint: string; notAfter: string;
  eligible: boolean; expired: boolean; coversDomains: boolean;
}

const plan = ref<Plan | null>(null);
const cert = ref<Cert | null>(null);
const assignments = ref<Assignment[]>([]);
const targets = ref<RollbackTarget[]>([]);
const rollbackTo = ref('');
const error = ref('');
const notice = ref('');

const stateText: Record<string, [string, string]> = {
  DRAFT: ['草稿', 'muted'],
  CANARY: ['灰度中', 'info'],
  AWAITING_APPROVAL: ['待推进', 'warn'],
  ROLLING: ['全量中', 'info'],
  PAUSED: ['已暂停', 'warn'],
  COMPLETED: ['已完成', 'ok'],
  COMPLETED_WITH_FAILURES: ['完成(有失败)', 'bad'],
  ROLLED_BACK: ['已回滚', 'muted'],
};
const badge = computed(() => (plan.value ? stateText[plan.value.state] : ['', 'muted']));

const canaryBatch = computed(() => assignments.value.filter((a) => a.batch === 0));
const restBatch = computed(() => assignments.value.filter((a) => a.batch === 1));

const canAct = computed(() => {
  const s = plan.value?.state;
  return {
    start: s === 'DRAFT',
    approve: s === 'AWAITING_APPROVAL',
    pause: s === 'CANARY' || s === 'AWAITING_APPROVAL' || s === 'ROLLING',
    resume: s === 'PAUSED',
    rollback: ['CANARY', 'AWAITING_APPROVAL', 'ROLLING', 'PAUSED', 'COMPLETED', 'COMPLETED_WITH_FAILURES'].includes(s ?? ''),
  };
});

async function load() {
  const res = await api.get(`/plans/${props.id}`);
  plan.value = res.data.plan;
  cert.value = res.data.cert;
  assignments.value = res.data.assignments;
  if (canAct.value.rollback) {
    targets.value = (await api.get(`/plans/${props.id}/rollback-targets`)).data;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  await load();
  timer = setInterval(load, 2000); // live progress while agents report back
});
onUnmounted(() => clearInterval(timer));

async function act(action: string) {
  error.value = ''; notice.value = '';
  try {
    await api.post(`/plans/${props.id}/${action}`);
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function rollback() {
  error.value = ''; notice.value = '';
  try {
    const res = await api.post(`/plans/${props.id}/rollback`, { targetCertId: rollbackTo.value });
    notice.value = `已创建回滚计划「${res.data.name}」，请在新计划中启动灰度。`;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const assignBadge = (s: string) =>
  ({ SUCCESS: 'ok', FAILED: 'bad', TIMEOUT: 'bad', DELIVERED: 'info', PENDING: 'muted', SKIPPED: 'muted' })[s] ?? 'muted';
</script>

<template>
  <template v-if="plan">
    <h1>
      {{ plan.name }}
      <span class="badge" :class="badge[1]">{{ badge[0] }}</span>
      <span v-if="plan.isRollback" class="badge muted">回滚计划</span>
    </h1>

    <div class="panel">
      <p>
        目标证书：<b>{{ cert?.name }}</b>
        <span class="mono">（{{ shortFp(cert?.fingerprint) }}）</span>
        ｜ 域名：{{ plan.domains.join(', ') }}
        ｜ 灰度批：{{ plan.canaryCount }} 个节点
      </p>
      <div class="actions">
        <button v-if="canAct.start" @click="act('start')">启动（先灰度）</button>
        <button v-if="canAct.approve" @click="act('approve')">灰度通过，推进剩余节点</button>
        <button v-if="canAct.pause" class="ghost" @click="act('pause')">暂停</button>
        <button v-if="canAct.resume" @click="act('resume')">恢复</button>
      </div>

      <template v-if="canAct.rollback">
        <label>回滚到（仅列出仍有效且覆盖域名的证书可选）</label>
        <div class="row">
          <select v-model="rollbackTo">
            <option value="" disabled>选择回滚目标证书</option>
            <option v-for="t in targets" :key="t.id" :value="t.id" :disabled="!t.eligible">
              {{ t.name }} — {{ t.eligible ? '可回滚' : t.expired ? '已过期，不可回滚' : '域名不覆盖，不可回滚' }}
            </option>
          </select>
          <div style="flex:0">
            <button class="danger" @click="rollback" :disabled="!rollbackTo">回滚</button>
          </div>
        </div>
      </template>
      <div v-if="error" class="error-box">{{ error }}</div>
      <div v-if="notice" class="warn-box" style="border-color:var(--ok);background:rgba(52,201,142,.1)">{{ notice }}</div>
    </div>

    <h2>灰度批（测试节点）</h2>
    <div class="panel">
      <table>
        <thead>
          <tr><th>节点</th><th>状态</th><th>目标指纹</th><th>节点上报指纹</th><th>尝试</th><th>错误</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in canaryBatch" :key="a.id">
            <td>{{ a.nodeName }}</td>
            <td><span class="badge" :class="assignBadge(a.state)">{{ a.state }}</span></td>
            <td class="mono">{{ shortFp(a.targetFingerprint) }}</td>
            <td class="mono">{{ shortFp(a.reportedFingerprint) }}</td>
            <td>{{ a.attempts }}</td>
            <td>{{ a.error ?? '—' }}</td>
          </tr>
          <tr v-if="!canaryBatch.length"><td colspan="6">—</td></tr>
        </tbody>
      </table>
    </div>

    <h2>剩余节点</h2>
    <div class="panel">
      <table>
        <thead>
          <tr><th>节点</th><th>状态</th><th>目标指纹</th><th>节点上报指纹</th><th>尝试</th><th>错误</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in restBatch" :key="a.id">
            <td>{{ a.nodeName }}</td>
            <td><span class="badge" :class="assignBadge(a.state)">{{ a.state }}</span></td>
            <td class="mono">{{ shortFp(a.targetFingerprint) }}</td>
            <td class="mono">{{ shortFp(a.reportedFingerprint) }}</td>
            <td>{{ a.attempts }}</td>
            <td>{{ a.error ?? '—' }}</td>
          </tr>
          <tr v-if="!restBatch.length"><td colspan="6">—</td></tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
