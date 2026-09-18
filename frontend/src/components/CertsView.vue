<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, fpShort } from '../api';
import { useToastStore } from '../stores/toast';

interface CertRow {
  id: string;
  label: string;
  subjectCn: string;
  issuerCn: string;
  fingerprintSha256: string;
  notBefore: string;
  notAfter: string;
  sanDomains: string[];
  chainLength: number;
  status: 'valid' | 'expiring' | 'expired';
  daysToExpiry: number;
  coveredDomains: string[];
  activeNodeCount: number;
  activeNodeNames: string[];
  uploadedAt: string;
}

const emit = defineEmits<{ (e: 'go-deploy', id: string): void }>();
const toast = useToastStore();

const certs = ref<CertRow[]>([]);
const loading = ref(false);
const label = ref('');
const pemText = ref('');
const fileName = ref('');
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const showUpload = ref(false);

async function load() {
  loading.value = true;
  try {
    certs.value = await api.get<CertRow[]>('/certificates');
  } catch (e) {
    toast.fromError(e, '加载证书失败');
  } finally {
    loading.value = false;
  }
}

function onFile() {
  const f = fileInput.value?.files?.[0];
  if (!f) return;
  fileName.value = f.name;
  const reader = new FileReader();
  reader.onload = () => {
    pemText.value = String(reader.result ?? '');
  };
  reader.readAsText(f);
}

async function upload() {
  if (!pemText.value.trim()) {
    toast.fail('请先选择链文件或粘贴 PEM');
    return;
  }
  uploading.value = true;
  try {
    const fd = new FormData();
    fd.set('label', label.value);
    if (fileInput.value?.files?.[0]) {
      fd.set('chain', fileInput.value.files[0]);
    } else {
      fd.set('pem', pemText.value);
    }
    const r = await api.upload<{
      certificate: CertRow;
      warnings: string[];
      coveredDomains: string[];
    }>('/certificates/upload', fd);
    toast.ok(
      `已入库：${r.certificate.label}，覆盖 ${r.coveredDomains.join(', ')}` +
        (r.warnings.length ? `（${r.warnings.length} 条警告）` : ''),
      r.warnings,
    );
    label.value = '';
    pemText.value = '';
    fileName.value = '';
    if (fileInput.value) fileInput.value.value = '';
    showUpload.value = false;
    await load();
  } catch (e) {
    toast.fromError(e, '上传被拒绝');
  } finally {
    uploading.value = false;
  }
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('zh-CN');
}

onMounted(load);
defineExpose({ reload: load });
</script>

<template>
  <section class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>到期清单（按上传时间倒序）</h2>
      <div>
        <button class="sm" @click="load">刷新</button>
        <button class="sm primary" @click="showUpload = !showUpload">＋ 上传新证书链</button>
      </div>
    </div>

    <div v-if="showUpload" class="panel" style="background:var(--panel-2);margin-top:12px">
      <h3>上传证书（只允许证书链，私钥会被直接拒绝）</h3>
      <div class="panel-row">
        <input v-model="label" type="text" placeholder="标签，如 new-cert-2027" style="width:260px" />
        <input ref="fileInput" type="file" accept=".pem,.crt,.cer,.chain" @change="onFile" />
        <span class="muted">或直接粘贴 PEM 到下方文本框</span>
      </div>
      <textarea v-model="pemText" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" style="margin-top:10px"></textarea>
      <p class="muted" style="margin:8px 0">
        服务端将依次核对：① 无私钥内容 ② 有效期（notBefore/notAfter）③ 证书链签名与 CA 约束 ④ SAN 是否覆盖受管域名 ⑤ 指纹去重。
      </p>
      <div>
        <button class="primary" :disabled="uploading" @click="upload">
          <span v-if="uploading" class="spinner"></span>提交校验并入库
        </button>
        <button @click="showUpload = false">取消</button>
      </div>
    </div>

    <table style="margin-top:12px">
      <thead>
        <tr>
          <th>状态</th><th>标签 / CN</th><th>SAN 覆盖</th><th>有效期</th>
          <th>指纹 SHA-256</th><th>链</th><th>在用节点</th><th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in certs" :key="c.id">
          <td>
            <span class="badge" :class="c.status">
              {{ c.status === 'valid' ? '有效' : c.status === 'expiring' ? `临期 ${c.daysToExpiry}d` : '已过期' }}
            </span>
          </td>
          <td>
            <div>{{ c.label }}</div>
            <div class="muted">{{ c.subjectCn }} · {{ c.issuerCn }}</div>
          </td>
          <td>
            <div v-for="d in c.sanDomains" :key="d" class="mono">{{ d }}</div>
          </td>
          <td class="mono">{{ fmt(c.notBefore) }} → <strong>{{ fmt(c.notAfter) }}</strong></td>
          <td class="fp">{{ fpShort(c.fingerprintSha256, 10) }}…</td>
          <td class="muted">{{ c.chainLength }} 张</td>
          <td>
            <span v-if="c.activeNodeCount">{{ c.activeNodeCount }} 台</span>
            <span v-else class="muted">无</span>
          </td>
          <td>
            <button class="sm" :disabled="c.status === 'expired'" @click="emit('go-deploy', c.id)">
              创建发布
            </button>
          </td>
        </tr>
        <tr v-if="!loading && certs.length === 0">
          <td colspan="8" class="muted" style="text-align:center;padding:20px">暂无证书</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
