import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from './pages/Dashboard.vue';
import Certificates from './pages/Certificates.vue';
import Nodes from './pages/Nodes.vue';
import Plans from './pages/Plans.vue';
import PlanDetail from './pages/PlanDetail.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/certificates', component: Certificates },
    { path: '/nodes', component: Nodes },
    { path: '/plans', component: Plans },
    { path: '/plans/:id', component: PlanDetail, props: true },
  ],
});
