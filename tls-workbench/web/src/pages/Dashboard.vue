<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, fmtDate, shortFp } from '../api';

interface Cert {
  id: string; name: string; fingerprint: string;
  notAfter: string; daysLeft: number; expired: boolean; domains: string[];
}
interface Node {
  id: string; name: string; role: string;
  currentFingerprint: string | null; currentCertId: string | null;
}

const certs = ref<Cert[]>([]);
const nodes = ref<Node[]>([]);
const certName = ref(new Map<string, string>());

onMounted(async () => {
  const [c, n] = await Promise.all([
    api.get<Cert[]>('/certificates'),
    api.get<Node[]>('/nodes'),
  ]);
  certs.value = c.data;
  nodes.value = n.data;
  certName.value = new Map(c.data.map((x) => [x.id, x.name]));
});

function expiryBadge(c: Cert) {
  if (c.expired) return { cls: 'bad', text: `已过期 ${-c.daysLeft} 天` };
  if (c.daysLeft <= 30) return { cls: 'warn', text: `${c.daysLeft} 天后到期` };
  return { cls: 'ok', text: `${c.daysLeft} 天` };
}
</script>

<template>
  <h1>总览</h1>

  <h2>到期清单</h2>
  <div class="panel">
    <table>
      <thead>
        <tr><th>证书</th><th>域名</th><th>指纹</th><th>到期时间</th><th>剩余</th></tr>
      </thead>
      <tbody>
        <tr v-for="c in certs" :key="c.id">
          <td>{{ c.name }}</td>
          <td>{{ c.domains.join(', ') }}</td>
          <td class="mono">{{ shortFp(c.fingerprint) }}</td>
          <td>{{ fmtDate(c.notAfter) }}</td>
          <td><span class="badge" :class="expiryBadge(c).cls">{{ expiryBadge(c).text }}</span></td>
        </tr>
        <tr v-if="!certs.length"><td colspan="5">暂无证书，请先在「证书」页上传。</td></tr>
      </tbody>
    </table>
  </div>

  <h2>节点矩阵</h2>
  <div class="panel">
    <table>
      <thead>
        <tr><th>节点</th><th>角色</th><th>当前证书</th><th>当前指纹</th></tr>
      </thead>
      <tbody>
        <tr v-for="n in nodes" :key="n.id">
          <td>{{ n.name }}</td>
          <td><span class="badge" :class="n.role === 'canary' ? 'info' : 'muted'">{{ n.role }}</span></td>
          <td>{{ n.currentCertId ? certName.get(n.currentCertId) ?? n.currentCertId : '—' }}</td>
          <td class="mono">{{ shortFp(n.currentFingerprint) }}</td>
        </tr>
        <tr v-if="!nodes.length"><td colspan="4">暂无节点。启动模拟器或到「节点」页添加。</td></tr>
      </tbody>
    </table>
  </div>
</template>
