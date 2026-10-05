<script setup>
import { ContentComments0721c } from '0721c/nuxt-content';
import '0721c/style.css';
// App bootstrap installs createContent0721c({ repository: 'OWNER/REPO' }) once.
defineProps({ document: { type: Object, required: true } });
</script>
<template>
  <ContentComments0721c :document="document" />
</template>
