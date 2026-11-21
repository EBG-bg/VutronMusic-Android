<script setup lang="ts">
import { provide } from 'vue'
import { navigationPreviewKey } from '../composables/navigationPreview'

provide(navigationPreviewKey, true)
</script>

<template>
  <div class="swipe-peek" inert aria-hidden="true"><slot /></div>
</template>
