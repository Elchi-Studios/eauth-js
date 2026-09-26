<script setup lang="ts">
defineProps<{ error: { statusCode: number; message: string } }>();
</script>

<template>
  <p id="failure">{{ error.statusCode }} {{ error.message }}</p>
</template>
