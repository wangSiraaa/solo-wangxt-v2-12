<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, fpShort } from '../api';
import { useToastStore } from '../stores/toast';

interface MatrixNode {
  id: string;
  name: string;
  env: 'test' | 'canary' | 'prod';
  region: string;
  domain: string;
  simMode: string;
  baseDelayMs: number;
  controlPlane: {
    certId: string;
    label: string;
    fingerprint: string;
    notAfter: string;
    valid: boolean;
    since: string | null;
  } | null;
  nodeActual: { certId: string; fingerprint: string } | null;
  convergent: boolean;
  lastSwitch: { action: string; toFingerprint: string; at: string } | null;
}

const toast = useToastStore();
const nodes = ref<MatrixNode[]>([]);
const loading = ref(false);
const SIM_MODES = [
  { v: 'normal', label: '正常' },
  { v: 'fail', label: '永久失败' },
  { v: 'flaky', label: '随机抖动' },
  { v: 'timeout', label: '超时+迟到回执' },
  { v: 'duplicate', label: '重复回执' },
];

async function load() {
  loading.value = true;
  try {
    nodes.value = await api.get<MatrixNode[]>('/nodes/matrix');
  } catch (e) {
    toast.fromError(e, '加载节点失败');
  } finally {
    loading.value = false;
  }
}

async function setMode(n: MatrixNode, mode: string) {
  try {
    await api.patch(`/nodes/${n.id}`, { simMode: mode });
    toast.ok(`${n.name} 模拟模式 → ${SIM_MODES.find((m) => m.v === mode)?.label}`);
    await load();
  } catch (e) {
    toast.fromError(e);
  }
}

async function forceFail(n: MatrixNode) {
  try {
    const r = await api.post<{ message: string }>(`/nodes/${n.id}/force-fail`);
    toast.ok(r.message);
  } catch (e) {
    toast.fromError(e);
  }
}

onMounted(load);
</script>

<template>
  <section class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>节点矩阵 × 模拟器</h2>
      <button class="sm" @click="load">刷新</button>
    </div>
    <p class="muted" style="margin-top:0">
      「控制面记录」是数据库中计划版本；「节点实际」是模拟器节点真正在服务的指纹。超时/失败场景下两者可能短暂不一致。
    </p>
    <table>
      <thead>
        <tr>
          <th>环境</th><th>节点</th><th>区域</th><th>域名</th>
          <th>控制面记录指纹</th><th>节点实际指纹</th><th>一致</th>
          <th>模拟器模式</th><th>注入</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in nodes" :key="n.id">
          <td><span class="badge" :class="n.env">{{ n.env }}</span></td>
          <td><strong>{{ n.name }}</strong></td>
          <td class="muted">{{ n.region }}</td>
          <td class="mono">{{ n.domain }}</td>
          <td class="fp">
            <div>{{ n.controlPlane ? fpShort(n.controlPlane.fingerprint, 12) : '—' }}</div>
            <div class="muted">{{ n.controlPlane?.label }}</div>
          </td>
          <td class="fp">
            <div>{{ n.nodeActual ? fpShort(n.nodeActual.fingerprint, 12) : '—' }}</div>
          </td>
          <td>
            <span :class="n.convergent ? 'ok-text' : 'err-text'">
              {{ n.convergent ? '✓ 收敛' : '✗ 分歧' }}
            </span>
          </td>
          <td>
            <select :value="n.simMode" @change="setMode(n, ($event.target as HTMLSelectElement).value)">
              <option v-for="m in SIM_MODES" :key="m.v" :value="m.v">{{ m.label }}</option>
            </select>
          </td>
          <td>
            <button class="sm warn" @click="forceFail(n)">下次失败</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
