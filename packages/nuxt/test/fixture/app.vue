<script setup lang="ts">
const { user, loading, error, signOut } = useEAuth();
</script>

<template>
  <header>
    <span id="who">{{ loading ? "loading" : user ? user.email : "nobody" }}</span>
    <span id="error">{{ error ? error.code : "" }}</span>
    <button v-if="user" id="sign-out" type="button" @click="signOut()">Sign out</button>
  </header>
  <NuxtPage />
</template>
