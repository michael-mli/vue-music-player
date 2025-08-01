<template>
  <div 
    v-if="isVisible"
    class="fixed inset-0 z-40 pointer-events-none"
    :style="{ backgroundColor: `rgba(0, 0, 0, ${backgroundOpacity})` }"
  >
    <!-- Close button -->
    <button 
      @click="$emit('close')"
      class="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/20 hover:bg-black/40 text-white/80 hover:text-white transition-all duration-200 pointer-events-auto"
      :title="$t('common.close')"
    >
      <XMarkIcon class="w-5 h-5" />
    </button>
    
    <!-- Visualizer Canvas -->
    <canvas 
      ref="canvas"
      class="w-full h-full"
      :width="canvasWidth"
      :height="canvasHeight"
    />
    
    <!-- Floating particles effect -->
    <div class="absolute inset-0 overflow-hidden">
      <div 
        v-for="particle in particles"
        :key="particle.id"
        class="absolute rounded-full bg-gradient-to-r from-spotify-green/30 to-blue-500/30 animate-pulse"
        :style="{
          left: particle.x + '%',
          top: particle.y + '%',
          width: particle.size + 'px',
          height: particle.size + 'px',
          animationDuration: particle.duration + 's',
          animationDelay: particle.delay + 's'
        }"
      />
    </div>
    
    <!-- Settings panel -->
    <div 
      v-if="showSettings"
      class="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg p-4 text-white pointer-events-auto"
    >
      <h3 class="text-sm font-medium mb-3">{{ $t('visualizer.settings') }}</h3>
      
      <!-- Visualizer Type -->
      <div class="mb-3">
        <label class="text-xs text-white/80 block mb-1">{{ $t('visualizer.type') }}</label>
        <select 
          v-model="visualizerType"
          class="w-full px-2 py-1 bg-white/10 rounded text-xs border border-white/20 focus:border-spotify-green focus:outline-none text-white"
        >
          <option value="bars" class="bg-gray-800 text-white">{{ $t('visualizer.bars') }}</option>
          <option value="circle" class="bg-gray-800 text-white">{{ $t('visualizer.circle') }}</option>
          <option value="wave" class="bg-gray-800 text-white">{{ $t('visualizer.wave') }}</option>
        </select>
      </div>
      
      <!-- Background Opacity -->
      <div class="mb-3">
        <label class="text-xs text-white/80 block mb-1">{{ $t('visualizer.backgroundOpacity') }}</label>
        <input 
          v-model="backgroundOpacity"
          type="range"
          min="0"
          max="0.8"
          step="0.1"
          class="w-full"
        />
      </div>
      
      <!-- Color Scheme -->
      <div class="mb-3">
        <label class="text-xs text-white/80 block mb-1">{{ $t('visualizer.colorScheme') }}</label>
        <select 
          v-model="colorScheme"
          class="w-full px-2 py-1 bg-white/10 rounded text-xs border border-white/20 focus:border-spotify-green focus:outline-none text-white"
        >
          <option value="spotify" class="bg-gray-800 text-white">Spotify Green</option>
          <option value="rainbow" class="bg-gray-800 text-white">Rainbow</option>
          <option value="blue" class="bg-gray-800 text-white">Blue Waves</option>
          <option value="fire" class="bg-gray-800 text-white">Fire</option>
        </select>
      </div>
      
      <!-- Bar Height -->
      <div class="mb-3">
        <label class="text-xs text-white/80 block mb-1">{{ $t('visualizer.barHeight') }}</label>
        <input 
          v-model="barHeight"
          type="range"
          min="0.2"
          max="1.0"
          step="0.1"
          class="w-full"
        />
        <div class="flex justify-between text-xs text-white/60 mt-1">
          <span>{{ $t('visualizer.low') }}</span>
          <span>{{ $t('visualizer.high') }}</span>
        </div>
      </div>
    </div>
    
    <!-- Settings toggle -->
    <button 
      @click="showSettings = !showSettings"
      class="absolute bottom-4 right-4 p-2 rounded-full bg-black/20 hover:bg-black/40 text-white/80 hover:text-white transition-all duration-200 pointer-events-auto"
      :title="$t('visualizer.settings')"
    >
      <CogIcon class="w-5 h-5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { XMarkIcon, CogIcon } from '@heroicons/vue/24/outline'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player'

const { t } = useI18n()
const playerStore = usePlayerStore()

// Props
interface Props {
  isVisible: boolean
}

const props = defineProps<Props>()

// Emits
defineEmits<{
  close: []
}>()

// Refs
const canvas = ref<HTMLCanvasElement>()
const canvasWidth = ref(window.innerWidth)
const canvasHeight = ref(window.innerHeight)

// Settings
const visualizerType = ref<'bars' | 'circle' | 'wave'>('bars')
const backgroundOpacity = ref(0.0)
const colorScheme = ref<'spotify' | 'rainbow' | 'blue' | 'fire'>('spotify')
const barHeight = ref(0.8)
const showSettings = ref(false)

// Audio context and analyzer
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let dataArray: Uint8Array | null = null
let animationId: number | null = null
let mediaSource: MediaElementAudioSourceNode | null = null

// Particles for ambient effect
const particles = ref<Array<{
  id: number
  x: number
  y: number
  size: number
  duration: number
  delay: number
}>>([])

// Initialize particles
function generateParticles() {
  particles.value = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 4 + 2,
    duration: Math.random() * 3 + 2,
    delay: Math.random() * 2
  }))
}

// Audio setup
async function setupAudio() {
  try {
    const audioElement = playerStore.audioElement
    if (!audioElement) {
      console.warn('No audio element available for visualizer')
      return
    }

    // If we already have a working setup, reuse it
    if (audioContext && analyser && dataArray && mediaSource) {
      console.log('Reusing existing audio visualizer setup')
      return
    }

    // Clean up any existing context
    await cleanupAudio()

    // Create audio context
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    
    // Resume context if suspended (required by some browsers)
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    
    // Create analyzer node
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    
    // Check if audio element already has a source node
    // This prevents the "already connected" error
    try {
      mediaSource = audioContext.createMediaElementSource(audioElement)
      mediaSource.connect(analyser)
      analyser.connect(audioContext.destination)
    } catch (error) {
      // If element is already connected, we might need to use a different approach
      if (error instanceof DOMException && error.name === 'InvalidStateError') {
        console.warn('Audio element already connected, attempting workaround')
        
        // Try to use existing connection or create a gain node as intermediary
        const gainNode = audioContext.createGain()
        gainNode.gain.value = 1.0
        
        // Create analyser without connecting source directly
        gainNode.connect(analyser)
        analyser.connect(audioContext.destination)
        
        // Note: This won't get live audio data, but won't crash
        console.warn('Visualizer running in fallback mode - no live audio data')
      } else {
        throw error
      }
    }
    
    // Setup data array
    const bufferLength = analyser.frequencyBinCount
    dataArray = new Uint8Array(bufferLength)
    
    console.log('Audio visualizer setup complete')
  } catch (error) {
    console.error('Error setting up audio visualizer:', error)
    // Generate fake data for visualization when audio setup fails
    if (analyser) {
      const bufferLength = analyser.frequencyBinCount
      dataArray = new Uint8Array(bufferLength)
      // Fill with some random data for demo purposes
      for (let i = 0; i < bufferLength; i++) {
        dataArray[i] = Math.random() * 100 + 50
      }
    }
  }
}

// Audio cleanup
async function cleanupAudio() {
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
  
  if (mediaSource) {
    try {
      mediaSource.disconnect()
    } catch (e) {
      // Ignore disconnect errors
    }
    mediaSource = null
  }
  
  if (analyser) {
    try {
      analyser.disconnect()
    } catch (e) {
      // Ignore disconnect errors
    }
    analyser = null
  }
  
  if (audioContext && audioContext.state !== 'closed') {
    try {
      await audioContext.close()
    } catch (e) {
      // Ignore close errors
    }
    audioContext = null
  }
  
  dataArray = null
}

// Color schemes
function getColor(index: number, total: number, intensity: number): string {
  const normalizedIndex = index / total
  const alpha = Math.min(intensity / 255 * 0.8 + 0.2, 1)
  
  switch (colorScheme.value) {
    case 'spotify':
      return `rgba(30, 215, 96, ${alpha})`
    case 'rainbow':
      const hue = normalizedIndex * 360
      return `hsla(${hue}, 70%, 60%, ${alpha})`
    case 'blue':
      return `rgba(59, 130, 246, ${alpha})`
    case 'fire':
      const red = 255
      const green = Math.floor(intensity * 0.8)
      const blue = Math.floor(intensity * 0.3)
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`
    default:
      return `rgba(30, 215, 96, ${alpha})`
  }
}

// Visualizer rendering functions
function drawBars(ctx: CanvasRenderingContext2D, dataArray: Uint8Array) {
  const barWidth = canvasWidth.value / dataArray.length * 2.5
  let x = 0
  
  for (let i = 0; i < dataArray.length; i++) {
    const barHeightValue = (dataArray[i] / 255) * canvasHeight.value * barHeight.value
    
    ctx.fillStyle = getColor(i, dataArray.length, dataArray[i])
    ctx.fillRect(x, canvasHeight.value - barHeightValue, barWidth, barHeightValue)
    
    x += barWidth + 1
  }
}

function drawCircle(ctx: CanvasRenderingContext2D, dataArray: Uint8Array) {
  const centerX = canvasWidth.value / 2
  const centerY = canvasHeight.value / 2
  const radius = Math.min(canvasWidth.value, canvasHeight.value) * 0.2
  
  for (let i = 0; i < dataArray.length; i++) {
    const angle = (i / dataArray.length) * Math.PI * 2
    const amplitude = (dataArray[i] / 255) * 100
    
    const x1 = centerX + Math.cos(angle) * radius
    const y1 = centerY + Math.sin(angle) * radius
    const x2 = centerX + Math.cos(angle) * (radius + amplitude)
    const y2 = centerY + Math.sin(angle) * (radius + amplitude)
    
    ctx.strokeStyle = getColor(i, dataArray.length, dataArray[i])
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
}

function drawWave(ctx: CanvasRenderingContext2D, dataArray: Uint8Array) {
  ctx.strokeStyle = getColor(0, 1, 200)
  ctx.lineWidth = 2
  ctx.beginPath()
  
  const sliceWidth = canvasWidth.value / dataArray.length
  let x = 0
  
  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0
    const y = v * canvasHeight.value / 2
    
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
    
    x += sliceWidth
  }
  
  ctx.stroke()
}

// Main animation loop
function animate() {
  if (!canvas.value || !analyser || !dataArray) return
  
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return
  
  // Clear canvas
  ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value)
  
  // Get frequency data
  analyser.getByteFrequencyData(dataArray)
  
  // Draw visualizer
  switch (visualizerType.value) {
    case 'bars':
      drawBars(ctx, dataArray)
      break
    case 'circle':
      drawCircle(ctx, dataArray)
      break
    case 'wave':
      drawWave(ctx, dataArray)
      break
  }
  
  animationId = requestAnimationFrame(animate)
}

// Handle window resize
function handleResize() {
  canvasWidth.value = window.innerWidth
  canvasHeight.value = window.innerHeight
}

// Lifecycle
onMounted(async () => {
  generateParticles()
  window.addEventListener('resize', handleResize)
  
  await nextTick()
  if (props.isVisible) {
    await setupAudio()
    animate()
  }
})

onUnmounted(async () => {
  window.removeEventListener('resize', handleResize)
  await cleanupAudio()
})

// Watch for visibility changes
watch(() => props.isVisible, async (newValue) => {
  if (newValue) {
    await setupAudio()
    animate()
  } else {
    // Only stop animation when hiding, keep audio context for reuse
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
  }
})

// Save settings to localStorage
watch([visualizerType, backgroundOpacity, colorScheme, barHeight], () => {
  localStorage.setItem('music-visualizer-settings', JSON.stringify({
    type: visualizerType.value,
    backgroundOpacity: backgroundOpacity.value,
    colorScheme: colorScheme.value,
    barHeight: barHeight.value
  }))
})

// Load settings from localStorage
onMounted(() => {
  const saved = localStorage.getItem('music-visualizer-settings')
  if (saved) {
    try {
      const settings = JSON.parse(saved)
      visualizerType.value = settings.type || 'bars'
      backgroundOpacity.value = settings.backgroundOpacity ?? 0.0
      colorScheme.value = settings.colorScheme || 'spotify'
      barHeight.value = settings.barHeight ?? 0.8
    } catch (error) {
      console.error('Error loading visualizer settings:', error)
    }
  }
})
</script>