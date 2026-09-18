<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, fmtDate, shortFp } from '../api';

interface Node {
  id: string; name: string; role: string;
  currentFingerprint: string | null; currentCertId: string | null;
}
interface SwitchRecord {
  id: string; fromFingerprint: string | null; toFingerprint: string;
  result: string; error: string | null; createdAt: string;
}

const nodes = ref<Node[]>([]);
const newName = ref('');
const newRole = ref('canary');
const error = ref('');
const historyFor = ref<string | null>(null);
const history = ref<SwitchRecord[]>([]);

async function load() {
  nodes.value = (await api.get<Node[]>('/nodes')).data;
}
onMounted(load);

async function add() {
  error.value = '';
  try {
    await api.post('/nodes', { name: newName.value, role: newRole.value });
    newName.value = '';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function showHistory(n: Node) {
  historyFor.value = n.name;
  history.value = (await api.get<SwitchRecord[]>(`/nodes/${n.id}/history`)).data;
}
</script>

<template>
  <h1>节点</h1>

  <div class="panel">
    <div class="row">
      <div>
        <label>节点名</label>
        <input v-model="newName" placeholder="prod-5" />
      </div>
      <div>
        <label>角色</label>
        <select v-model="newRole">
          <option value="canary">canary（测试节点）</option>
          <option value="prod">prod</option>
        </select>
      </div>
      <div style="flex:0;align-self:end">
        <button @click="add" :disabled="!newName">添加节点</button>
      </div>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
  </div>

  <div class="panel">
    <table>
      <thead>
        <tr><th>节点</th><th>角色</th><th>当前指纹</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="n in nodes" :key="n.id">
          <td>{{ n.name }}</td>
          <td><span class="badge" :class="n.role === 'canary' ? 'info' : 'muted'">{{ n.role }}</span></td>
          <td class="mono">{{ shortFp(n.currentFingerprint) }}</td>
          <td><button class="ghost" @click="showHistory(n)">切换记录</button></td>
        </tr>
        <tr v-if="!nodes.length"><td colspan="4">暂无节点</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="historyFor" class="panel">
    <h2 style="margin-top:0">{{ historyFor }} 的切换记录</h2>
    <table>
      <thead>
        <tr><th>时间</th><th>从指纹</th><th>到指纹</th><th>结果</th><th>错误</th></tr>
      </thead>
      <tbody>
        <tr v-for="h in history" :key="h.id">
          <td>{{ fmtDate(h.createdAt) }}</td>
          <td class="mono">{{ shortFp(h.fromFingerprint) }}</td>
          <td class="mono">{{ shortFp(h.toFingerprint) }}</td>
          <td><span class="badge" :class="h.result === 'applied' ? 'ok' : 'bad'">{{ h.result }}</span></td>
          <td>{{ h.error ?? '—' }}</td>
        </tr>
        <tr v-if="!history.length"><td colspan="5">暂无记录</td></tr>
      </tbody>
    </table>
  </div>
</template>
