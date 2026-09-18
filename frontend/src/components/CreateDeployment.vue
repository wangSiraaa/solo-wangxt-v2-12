<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useToastStore } from '../stores/toast';

interface CertRow {
  id: string;
  label: string;
  status: string;
  daysToExpiry: number;
  sanDomains: string[];
  activeNodeCount: number;
}

const props = defineProps<{ certId: string | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created', id: string): void;
}>();
const toast = useToastStore();

const certs = ref<CertRow[]>([]);
const selected = ref<string>('');
const note = ref('');
const submitting = ref(false);

onMounted(async () => {
  certs.value = await api.get<CertRow[]>('/certificates');
  const preselect =
    props.certId ?? certs.value.find((c) => c.status === 'valid' && c.activeNodeCount === 0)?.id;
  if (preselect) selected.value = preselect;
});

async function submit() {
  if (!selected.value) {
    toast.fail('请选择证书');
    return;
  }
  submitting.value = true;
  try {
    const dep = await api.post<{ id: string }>('/deployments', {
      certId: selected.value,
      note: note.value || undefined,
    });
    toast.ok('发布计划已创建：test 批次就绪，点击「开始 test」先让测试节点验证');
    emit('created', dep.id);
  } catch (e) {
    toast.fromError(e, '创建发布失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="panel" style="background:var(--panel-2);margin-top:12px">
    <h3>新建灰度发布</h3>
    <div class="panel-row">
      <label class="muted">证书：
        <select v-model="selected" style="min-width:340px">
          <option v-for="c in certs" :key="c.id" :value="c.id" :disabled="c.status === 'expired'">
            {{ c.label }}（SAN: {{ c.sanDomains.join(', ') }}，{{ c.status }}{{ c.status !== 'expired' ? `/${c.daysToExpiry}d` : '' }}）
          </option>
        </select>
      </label>
      <input v-model="note" type="text" placeholder="备注（可选）" style="width:260px" />
    </div>
    <p class="muted">
      仅纳入 SAN 覆盖其域名的节点；计划按 test → canary → prod 三批排序，每批全部成功并人工确认后才能推进。
    </p>
    <button class="primary" :disabled="submitting" @click="submit">
      <span v-if="submitting" class="spinner"></span>创建计划
    </button>
    <button @click="emit('close')">取消</button>
  </div>
</template>
