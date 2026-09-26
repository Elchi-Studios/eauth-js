<script setup lang="ts">
const { user, loading, signIn } = useEAuth();
</script>

<template>
  <p id="state">{{ loading ? "loading" : user ? user.email : "nobody" }}</p>
  <NuxtLink id="to-private" to="/private">Private</NuxtLink>
  <button id="sign-in" type="button" @click="signIn()">Sign in</button>
</template>
