<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="$emit('close')">
    <div class="bg-spotify-dark rounded-lg p-6 w-96 max-w-full mx-4">
      <h2 class="text-xl font-bold text-white mb-1">{{ $t('share.title') }}</h2>
      <p class="text-sm text-gray-400 mb-4 truncate">{{ song.title }}</p>

      <form @submit.prevent="share">
        <div class="mb-1">
          <label class="block text-sm font-medium text-gray-300 mb-2">
            {{ $t('share.noteLabel') }}
          </label>
          <textarea
            ref="noteInput"
            v-model="note"
            rows="3"
            maxlength="200"
            class="w-full px-3 py-2 bg-spotify-light text-white rounded border border-gray-600 focus:border-spotify-green focus:outline-none resize-none text-sm"
            :placeholder="$t('share.notePlaceholder')"
          ></textarea>
        </div>
        <p class="text-xs text-gray-500 text-right mb-4">{{ note.length }}/200</p>

        <p v-if="copied" class="text-sm text-spotify-green mb-3">✓ {{ $t('share.copied') }}</p>

        <div class="flex justify-end items-center space-x-3">
          <button
            type="button"
            @click="$emit('close')"
            class="px-4 py-2 text-gray-400 hover:text-white transition-colors duration-200"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            v-if="!canNativeShare"
            type="button"
            @click="copyLink"
            class="btn-primary"
          >
            {{ $t('share.copyBtn') }}
          </button>
          <button
            v-else
            type="submit"
            class="btn-primary"
          >
            {{ $t('share.shareBtn') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Song } from '@/types'

const props = defineProps<{ song: Song }>()
const emit = defineEmits<{ close: [] }>()

const note = ref('')
const copied = ref(false)
const noteInput = ref<HTMLTextAreaElement>()

const canNativeShare = computed(() => typeof navigator !== 'undefined' && !!navigator.share)

const shareUrl = computed(() => {
  const trimmed = note.value.trim().slice(0, 200)
  return `${window.location.origin}/music/?song=${props.song.id}`
    + (trimmed ? `&note=${encodeURIComponent(trimmed)}` : '')
})

onMounted(() => noteInput.value?.focus())

// Runs directly in the button's click gesture, so the native share sheet is allowed
// (a window.prompt beforehand used to consume the activation and force the clipboard path).
async function share() {
  try {
    await navigator.share({
      title: props.song.title,
      text: note.value.trim() || `Check out this song: ${props.song.title}`,
      url: shareUrl.value,
    })
    emit('close')
  } catch (error) {
    if ((error as Error).name === 'AbortError') return // user dismissed the OS sheet — keep the modal
    await copyLink()
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
  } catch {
    // Older browsers: hidden-textarea fallback
    const textArea = document.createElement('textarea')
    textArea.value = shareUrl.value
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    try { document.execCommand('copy') } catch { /* noop */ }
    document.body.removeChild(textArea)
  }
  copied.value = true
  window.setTimeout(() => emit('close'), 1200)
}
</script>
