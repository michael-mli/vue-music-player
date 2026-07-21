<template>
  <TransitionRoot appear :show="show" as="template">
    <Dialog as="div" class="relative z-[100]" @close="requestClose">
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto p-4">
        <div class="flex min-h-full items-center justify-center">
          <TransitionChild
            as="template"
            enter="duration-200 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-150 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel class="w-full max-w-md rounded-2xl border border-light-border dark:border-white/10 bg-light-surface dark:bg-spotify-dark p-6 shadow-2xl">
              <div class="flex items-start gap-4">
                <div class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                  <TrashIcon class="w-5 h-5" />
                </div>
                <div class="min-w-0">
                  <DialogTitle class="text-lg font-semibold text-light-text-primary dark:text-white">
                    {{ $t('playlist.deleteTitle') }}
                  </DialogTitle>
                  <p class="mt-2 text-sm leading-6 text-light-text-secondary dark:text-gray-400">
                    {{ $t('playlist.deleteDescription', { name: playlistName }) }}
                  </p>
                  <p v-if="error" class="mt-2 text-sm text-red-500">
                    {{ $t('playlist.syncError') }}
                  </p>
                </div>
              </div>
              <div class="mt-6 flex justify-end gap-3">
                <button
                  class="px-4 py-2 rounded-full text-sm font-medium text-light-text-secondary dark:text-gray-300 hover:bg-light-border dark:hover:bg-white/10"
                  :disabled="deleting"
                  @click="requestClose"
                >
                  {{ $t('common.cancel') }}
                </button>
                <button
                  class="px-4 py-2 rounded-full bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50"
                  :disabled="deleting"
                  @click="$emit('confirm')"
                >
                  {{ deleting ? $t('playlist.deleting') : $t('playlist.deletePlaylist') }}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from '@headlessui/vue'
import { TrashIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{
  show: boolean
  playlistName: string
  deleting: boolean
  error: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

function requestClose() {
  if (!props.deleting) emit('close')
}
</script>
