<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, fmtDate, shortFp } from '../api';

interface Cert {
  id: string; name: string; domains: string[]; sanDomains: string[];
  fingerprint: string; issuer: string; notBefore: string; notAfter: string;
  daysLeft: number; expired: boolean;
}
interface Validation {
  ok: boolean; errors: string[]; warnings: string[];
  leaf: { sanDomains: string[]; notAfter: string; fingerprint: string } | null;
  chain: { subject: string; selfSigned: boolean }[];
  missingDomains: string[];
}

const certs = ref<Cert[]>([]);
const name = ref('');
const domainsInput = ref('api.example.com, www.example.com');
const pem = ref('');
const validation = ref<Validation | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);

async function load() {
  certs.value = (await api.get<Cert[]>('/certificates')).data;
}
onMounted(load);

const parsedDomains = () =>
  domainsInput.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

async function validate() {
  error.value = ''; validation.value = null;
  try {
    validation.value = (
      await api.post<Validation>('/certificates/validate', {
        pem: pem.value,
        domains: parsedDomains(),
      })
    ).data;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function upload() {
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    const res = await api.post('/certificates', {
      name: name.value,
      pem: pem.value,
      domains: parsedDomains(),
    });
    notice.value = `已上传「${res.data.certificate.name}」` +
      (res.data.warnings?.length ? `（警告：${res.data.warnings.join('；')}）` : '');
    name.value = ''; pem.value = ''; validation.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) pem.value = await file.text();
}
</script>

<template>
  <h1>证书</h1>

  <div class="panel">
    <h2 style="margin-top:0">上传新证书（仅证书链，私钥不进入本系统）</h2>
    <div class="row">
      <div>
        <label>名称</label>
        <input v-model="name" placeholder="例如 valid-2026-09" />
      </div>
      <div>
        <label>需覆盖域名（逗号分隔）</label>
        <input v-model="domainsInput" />
      </div>
      <div>
        <label>从文件读取 PEM</label>
        <input type="file" accept=".pem,.crt,.cer" @change="onFile" />
      </div>
    </div>
    <label>PEM 证书链（叶子证书在前，依次到根）</label>
    <textarea v-model="pem" rows="8" placeholder="-----BEGIN CERTIFICATE----- ..."></textarea>
    <div class="actions">
      <button class="ghost" @click="validate" :disabled="!pem">校验</button>
      <button @click="upload" :disabled="busy || !name || !pem">上传</button>
    </div>

    <div v-if="validation" class="panel" style="background:var(--bg)">
      <div>
        <span class="badge" :class="validation.ok ? 'ok' : 'bad'">
          {{ validation.ok ? '校验通过' : '校验失败' }}
        </span>
      </div>
      <div v-if="validation.errors.length" class="error-box">{{ validation.errors.join('\n') }}</div>
      <div v-if="validation.warnings.length" class="warn-box">{{ validation.warnings.join('\n') }}</div>
      <template v-if="validation.leaf">
        <p>SAN：{{ validation.leaf.sanDomains.join(', ') }}</p>
        <p>链长度：{{ validation.chain.length }}（{{ validation.chain.map(c => c.subject.split('CN=')[1] ?? c.subject).join(' → ') }}）</p>
        <p class="mono">指纹：{{ validation.leaf.fingerprint }}</p>
      </template>
    </div>
    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-if="notice" class="warn-box" style="border-color:var(--ok);background:rgba(52,201,142,.1)">{{ notice }}</div>
  </div>

  <div class="panel">
    <table>
      <thead>
        <tr><th>名称</th><th>声明域名</th><th>SAN</th><th>指纹</th><th>有效期至</th><th>状态</th></tr>
      </thead>
      <tbody>
        <tr v-for="c in certs" :key="c.id">
          <td>{{ c.name }}</td>
          <td>{{ c.domains.join(', ') }}</td>
          <td>{{ c.sanDomains.join(', ') }}</td>
          <td class="mono">{{ shortFp(c.fingerprint) }}</td>
          <td>{{ fmtDate(c.notAfter) }}</td>
          <td>
            <span class="badge" :class="c.expired ? 'bad' : c.daysLeft <= 30 ? 'warn' : 'ok'">
              {{ c.expired ? '已过期' : c.daysLeft <= 30 ? `${c.daysLeft} 天后到期` : '有效' }}
            </span>
          </td>
        </tr>
        <tr v-if="!certs.length"><td colspan="6">暂无证书</td></tr>
      </tbody>
    </table>
  </div>
</template>
