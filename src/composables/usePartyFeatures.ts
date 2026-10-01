import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { partyApi } from '@/services/partyApi'
import { partyErrorMessage } from '@/services/partyErrorMessage'

// Check availability before this page submits room actions. The app's shared
// identity bootstrap remains independent of KTV availability.
export function usePartyFeatures() {
  const { t } = useI18n()
  const roomsAvailable = ref(false), featureError = ref('')
  async function loadFeatures() {
    try {
      const features = await partyApi.features()
      roomsAvailable.value = features.rooms
      featureError.value = features.rooms ? '' : t('party.errorDisabled')
    } catch (error) {
      roomsAvailable.value = false
      featureError.value = partyErrorMessage(error, t)
    }
    return roomsAvailable.value
  }
  return { roomsAvailable, featureError, loadFeatures }
}
