<template>
  <header class="topnav">
    <span class="brand">TLS 证书轮换工作台</span>
    <nav>
      <RouterLink to="/">总览</RouterLink>
      <RouterLink to="/certificates">证书</RouterLink>
      <RouterLink to="/nodes">节点</RouterLink>
      <RouterLink to="/plans">发布计划</RouterLink>
    </nav>
  </header>
  <main>
    <RouterView />
  </main>
</template>
