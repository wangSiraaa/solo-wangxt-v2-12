<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import CertsView from './components/CertsView.vue';
import NodesView from './components/NodesView.vue';
import DeploymentsView from './components/DeploymentsView.vue';
import DeploymentDetail from './components/DeploymentDetail.vue';
import SwitchLogView from './components/SwitchLogView.vue';
import { useToastStore } from './stores/toast';

const toast = useToastStore();
const tab = ref<'certs' | 'nodes' | 'deployments' | 'log'>('certs');
const selectedDeployment = ref<string | null>(null);
const refreshTick = ref(0);

function openDeployment(id: string) {
  selectedDeployment.value = id;
  tab.value = 'deployments';
}

function backToList() {
  selectedDeployment.value = null;
}

// light global polling while a deployment detail is open
let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => {
    refreshTick.value++;
  }, 2500);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <header style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px">
    <h1>🔐 TLS 证书轮换工作台</h1>
    <span class="muted">私钥不进入本系统 · 仅管理证书链 / 节点 / 部署回执</span>
  </header>

  <nav class="tabs">
    <button :class="{ active: tab === 'certs' }" @click="tab = 'certs'">证书与到期</button>
    <button :class="{ active: tab === 'nodes' }" @click="tab = 'nodes'">节点矩阵 / 模拟器</button>
    <button :class="{ active: tab === 'deployments' }" @click="backToList(); tab = 'deployments'">
      灰度发布{{ selectedDeployment ? '（详情）' : '' }}
    </button>
    <button :class="{ active: tab === 'log' }" @click="tab = 'log'">切换记录</button>
  </nav>

  <CertsView v-if="tab === 'certs'" @go-deploy="openDeployment" />
  <NodesView v-else-if="tab === 'nodes'" />
  <template v-else-if="tab === 'deployments'">
    <DeploymentDetail
      v-if="selectedDeployment"
      :id="selectedDeployment"
      :tick="refreshTick"
      @back="backToList"
    />
    <DeploymentsView v-else :tick="refreshTick" @open="openDeployment" @go-certs="tab = 'certs'" />
  </template>
  <SwitchLogView v-else-if="tab === 'log'" :tick="refreshTick" />

  <div class="toast">
    <div v-for="t in toast.toasts" :key="t.id" class="item" :class="t.kind" @click="toast.dismiss(t.id)">
      <div>{{ t.kind === 'ok' ? '✅' : '⚠️' }} {{ t.message }}</div>
      <ul v-if="t.details?.length">
        <li v-for="(d, i) in t.details" :key="i">{{ d }}</li>
      </ul>
    </div>
  </div>
</template>
