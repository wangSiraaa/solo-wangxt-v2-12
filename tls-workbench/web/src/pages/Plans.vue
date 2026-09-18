<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, fmtDate } from '../api';

interface Plan {
  id: string; name: string; state: string; certName: string | null;
  isRollback: boolean; canaryCount: number; createdAt: string;
}
interface Cert { id: string; name: string; expired: boolean; domains: string[] }
interface Node { id: string; name: string; role: string }

const router = useRouter();
const plans = ref<Plan[]>([]);
const certs = ref<Cert[]>([]);
const nodes = ref<Node[]>([]);
const name = ref('');
const certId = ref('');
const canaryCount = ref(1);
const selected = ref<Set<string>>(new Set());
const error = ref('');

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
const badge = (s: string) => stateText[s] ?? [s, 'muted'];

async function load() {
  const [p, c, n] = await Promise.all([
    api.get<Plan[]>('/plans'),
    api.get<Cert[]>('/certificates'),
    api.get<Node[]>('/nodes'),
  ]);
  plans.value = p.data;
  certs.value = c.data;
  nodes.value = n.data;
  if (!selected.value.size) {
    selected.value = new Set(n.data.map((x) => x.id));
  }
}
onMounted(load);

const deployableCerts = computed(() => certs.value.filter((c) => !c.expired));

async function create() {
  error.value = '';
  try {
    const res = await api.post<Plan>('/plans', {
      name: name.value,
      certId: certId.value,
      canaryCount: canaryCount.value,
      nodeIds: [...selected.value],
    });
    name.value = '';
    await load();
    router.push(`/plans/${res.data.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function toggle(id: string) {
  selected.value.has(id) ? selected.value.delete(id) : selected.value.add(id);
  selected.value = new Set(selected.value);
}
</script>

<template>
  <h1>发布计划</h1>

  <div class="panel">
    <h2 style="margin-top:0">新建轮换计划</h2>
    <div class="row">
      <div>
        <label>计划名</label>
        <input v-model="name" placeholder="rotate-api-2026-09" />
      </div>
      <div>
        <label>目标证书（仅可部署有效证书）</label>
        <select v-model="certId">
          <option value="" disabled>选择证书</option>
          <option v-for="c in deployableCerts" :key="c.id" :value="c.id">
            {{ c.name }}（{{ c.domains.join(', ') }}）
          </option>
        </select>
      </div>
      <div>
        <label>测试节点（灰度批）数量</label>
        <input type="number" min="1" v-model.number="canaryCount" />
      </div>
    </div>
    <label>目标节点（按角色排序，前 {{ canaryCount }} 个作为灰度批）</label>
    <div class="row" style="flex-wrap:wrap">
      <label
        v-for="n in nodes" :key="n.id"
        style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 0 0;color:var(--text)"
      >
        <input
          type="checkbox" style="width:auto"
          :checked="selected.has(n.id)" @change="toggle(n.id)"
        />
        {{ n.name }} <span class="badge" :class="n.role === 'canary' ? 'info' : 'muted'">{{ n.role }}</span>
      </label>
    </div>
    <div class="actions">
      <button @click="create" :disabled="!name || !certId || !selected.size">创建计划</button>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
  </div>

  <div class="panel">
    <table>
      <thead>
        <tr><th>计划</th><th>证书</th><th>状态</th><th>类型</th><th>创建时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in plans" :key="p.id" style="cursor:pointer" @click="router.push(`/plans/${p.id}`)">
          <td>{{ p.name }}</td>
          <td>{{ p.certName ?? '—' }}</td>
          <td><span class="badge" :class="badge(p.state)[1]">{{ badge(p.state)[0] }}</span></td>
          <td>{{ p.isRollback ? '回滚' : '轮换' }}</td>
          <td>{{ fmtDate(p.createdAt) }}</td>
        </tr>
        <tr v-if="!plans.length"><td colspan="5">暂无计划</td></tr>
      </tbody>
    </table>
  </div>
</template>
