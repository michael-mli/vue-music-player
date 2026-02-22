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
          <option value="galaxy" class="bg-gray-800 text-white">{{ $t('visualizer.galaxy') }}</option>
          <option value="fountain" class="bg-gray-800 text-white">{{ $t('visualizer.fountain') }}</option>
          <option value="terrain" class="bg-gray-800 text-white">{{ $t('visualizer.terrain') }}</option>
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
const visualizerType = ref<'bars' | 'circle' | 'wave' | 'galaxy' | 'fountain' | 'terrain'>('bars')
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

// Returns base hue range and saturation for the current color scheme
function getSchemeHue(position: number, intensity: number): { h: number; s: number; l: number } {
  switch (colorScheme.value) {
    case 'spotify':
      return { h: 145 + position * 20, s: 70, l: 45 + intensity * 20 }
    case 'rainbow':
      return { h: position * 360, s: 70, l: 55 + intensity * 15 }
    case 'blue':
      return { h: 210 + position * 30, s: 75, l: 50 + intensity * 20 }
    case 'fire':
      return { h: position * 40, s: 90, l: 45 + intensity * 25 }
    default:
      return { h: 145, s: 70, l: 50 + intensity * 15 }
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

// --- Galaxy / Nebula ---
interface GalaxyParticle {
  angle: number
  radius: number
  baseRadius: number
  speed: number
  size: number
  position: number // 0–1 for color mapping
  brightness: number
  trail: { x: number; y: number }[]
}
let galaxyParticles: GalaxyParticle[] = []
let galaxyInitialized = false
let galaxyRotation = 0

function initGalaxy() {
  const scale = Math.min(canvasWidth.value, canvasHeight.value)
  galaxyParticles = Array.from({ length: 300 }, () => {
    const baseRadius = Math.random() * scale * 0.4 + 20
    return {
      angle: Math.random() * Math.PI * 2,
      radius: baseRadius,
      baseRadius,
      speed: (0.001 + Math.random() * 0.003) * (Math.random() > 0.5 ? 1 : -1),
      size: Math.random() * 2.5 + 0.5,
      position: Math.random(),
      brightness: 0.4 + Math.random() * 0.6,
      trail: []
    }
  })
  galaxyInitialized = true
}

function drawGalaxy(ctx: CanvasRenderingContext2D, dataArray: Uint8Array) {
  if (!galaxyInitialized) initGalaxy()

  const cx = canvasWidth.value / 2
  const cy = canvasHeight.value / 2
  const sizeScale = barHeight.value

  const len = dataArray.length
  let bass = 0, treble = 0
  for (let i = 0; i < len / 4; i++) bass += dataArray[i]
  for (let i = Math.floor(len * 0.75); i < len; i++) treble += dataArray[i]
  bass = bass / (len / 4) / 255
  treble = treble / (len / 4) / 255

  galaxyRotation += 0.002 + bass * 0.008

  // Core glow using color scheme
  const coreColor = getSchemeHue(0.5, bass)
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, (60 + bass * 40) * sizeScale)
  coreGrad.addColorStop(0, `hsla(${coreColor.h}, ${coreColor.s}%, ${coreColor.l}%, ${0.3 + bass * 0.4})`)
  coreGrad.addColorStop(1, 'transparent')
  ctx.fillStyle = coreGrad
  ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)

  for (const p of galaxyParticles) {
    p.angle += p.speed * (1 + bass * 3)
    const expand = 1 + bass * 0.4 * sizeScale
    p.radius = p.baseRadius * expand

    const x = cx + Math.cos(p.angle + galaxyRotation) * p.radius
    const y = cy + Math.sin(p.angle + galaxyRotation) * p.radius * 0.6

    p.trail.push({ x, y })
    if (p.trail.length > 8) p.trail.shift()

    const c = getSchemeHue(p.position, treble)

    // Draw trail with fading alpha
    for (let t = 0; t < p.trail.length - 1; t++) {
      const alpha = ((t + 1) / p.trail.length) * 0.4 * p.brightness
      ctx.strokeStyle = `hsla(${c.h}, ${c.s}%, ${c.l}%, ${alpha})`
      ctx.lineWidth = p.size * 0.5 * sizeScale
      ctx.beginPath()
      ctx.moveTo(p.trail[t].x, p.trail[t].y)
      ctx.lineTo(p.trail[t + 1].x, p.trail[t + 1].y)
      ctx.stroke()
    }

    // Draw particle
    const sparkle = treble > 0.4 ? 1 + (treble - 0.4) * 4 : 1
    const sz = p.size * sparkle * sizeScale
    ctx.beginPath()
    ctx.arc(x, y, sz, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${c.h}, ${c.s + 10}%, ${c.l + treble * 15}%, ${p.brightness})`
    ctx.fill()
  }
}

// --- Particle Fountain / Explosion ---
interface FountainParticle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number; position: number
  trail: { x: number; y: number }[]
}
let fountainParticles: FountainParticle[] = []
let lastBeatLevel = 0

function drawFountain(ctx: CanvasRenderingContext2D, dataArray: Uint8Array) {
  const w = canvasWidth.value
  const h = canvasHeight.value
  const sizeScale = barHeight.value

  const len = dataArray.length
  let bass = 0, mid = 0, overall = 0
  for (let i = 0; i < len / 4; i++) bass += dataArray[i]
  for (let i = Math.floor(len / 4); i < Math.floor(len * 0.75); i++) mid += dataArray[i]
  for (let i = 0; i < len; i++) overall += dataArray[i]
  bass = bass / (len / 4) / 255
  mid = mid / (len / 2) / 255
  overall = overall / len / 255

  const beatThresh = 0.15
  const isBeat = bass - lastBeatLevel > beatThresh && bass > 0.4
  lastBeatLevel = bass * 0.7 + lastBeatLevel * 0.3

  // Spawn particles
  const spawnCount = isBeat ? 30 : Math.floor(3 + overall * 8)
  for (let i = 0; i < spawnCount; i++) {
    const spread = (isBeat ? 8 : 3) * sizeScale
    const upForce = (isBeat ? -(8 + Math.random() * 8) : -(3 + Math.random() * 5 + bass * 4)) * sizeScale
    fountainParticles.push({
      x: w / 2 + (Math.random() - 0.5) * 40,
      y: h * 0.85,
      vx: (Math.random() - 0.5) * spread,
      vy: upForce,
      life: 1,
      maxLife: 60 + Math.random() * 60,
      size: (1.5 + Math.random() * 2.5 + bass * 2) * sizeScale,
      position: isBeat ? 0.8 + Math.random() * 0.2 : Math.random() * 0.6,
      trail: []
    })
  }

  // Update and draw particles
  const gravity = 0.06
  const surviving: FountainParticle[] = []
  for (const p of fountainParticles) {
    p.vy += gravity
    p.x += p.vx
    p.y += p.vy
    p.life -= 1 / p.maxLife

    if (p.life > 0 && p.y < h + 20 && p.x > -20 && p.x < w + 20) {
      surviving.push(p)

      p.trail.push({ x: p.x, y: p.y })
      if (p.trail.length > 6) p.trail.shift()

      const c = getSchemeHue(p.position, p.life)
      const alpha = p.life * 0.8

      // Draw trail
      for (let t = 0; t < p.trail.length - 1; t++) {
        const ta = ((t + 1) / p.trail.length) * alpha * 0.4
        ctx.strokeStyle = `hsla(${c.h}, ${c.s}%, ${c.l}%, ${ta})`
        ctx.lineWidth = p.size * p.life * 0.5
        ctx.beginPath()
        ctx.moveTo(p.trail[t].x, p.trail[t].y)
        ctx.lineTo(p.trail[t + 1].x, p.trail[t + 1].y)
        ctx.stroke()
      }

      // Glow
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
      grd.addColorStop(0, `hsla(${c.h}, ${c.s}%, ${c.l}%, ${alpha * 0.3})`)
      grd.addColorStop(1, 'transparent')
      ctx.fillStyle = grd
      ctx.fillRect(p.x - p.size * 3, p.y - p.size * 3, p.size * 6, p.size * 6)

      // Core dot
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${c.h}, ${c.s + 5}%, ${c.l + 10}%, ${alpha})`
      ctx.fill()
    }
  }
  fountainParticles = surviving

  // Ground glow
  const gc = getSchemeHue(0.5, bass)
  const groundGrad = ctx.createRadialGradient(w / 2, h * 0.85, 10, w / 2, h * 0.85, (120 + bass * 80) * sizeScale)
  groundGrad.addColorStop(0, `hsla(${gc.h}, ${gc.s}%, ${gc.l}%, ${0.15 + bass * 0.2})`)
  groundGrad.addColorStop(1, 'transparent')
  ctx.fillStyle = groundGrad
  ctx.fillRect(0, 0, w, h)
}

// --- Terrain / Mountain Range ---
let terrainOffset = 0

function drawTerrain(ctx: CanvasRenderingContext2D, dataArray: Uint8Array) {
  const w = canvasWidth.value
  const h = canvasHeight.value
  const len = dataArray.length

  terrainOffset += 0.5

  const bands = [
    { start: 0, end: Math.floor(len * 0.25) },
    { start: Math.floor(len * 0.25), end: Math.floor(len * 0.5) },
    { start: Math.floor(len * 0.5), end: Math.floor(len * 0.75) },
    { start: Math.floor(len * 0.75), end: len }
  ]

  const layerCount = 4
  for (let layer = layerCount - 1; layer >= 0; layer--) {
    const band = bands[layer]
    const bandLen = band.end - band.start
    const depth = layer / layerCount
    const baseY = h * (0.4 + depth * 0.15)
    const heightScale = (0.25 + (1 - depth) * 0.2) * barHeight.value
    const scrollSpeed = (1 - depth * 0.6)
    const offset = terrainOffset * scrollSpeed

    let avg = 0
    for (let i = band.start; i < band.end; i++) avg += dataArray[i]
    avg = avg / bandLen / 255

    // Use color scheme for layer hue
    const layerPos = (layer / layerCount)
    const c = getSchemeHue(layerPos, avg)
    const alpha = 0.6 + (1 - depth) * 0.4

    ctx.beginPath()
    ctx.moveTo(0, h)

    const segWidth = w / bandLen
    for (let i = 0; i <= bandLen; i++) {
      const dataIdx = band.start + (i % bandLen)
      const val = dataArray[dataIdx] / 255
      const xPos = i * segWidth
      const noiseOffset = Math.sin((xPos + offset) * 0.01) * 20
      const terrainY = baseY - val * h * heightScale + noiseOffset

      if (i === 0) {
        ctx.moveTo(0, h)
        ctx.lineTo(xPos, terrainY)
      } else {
        const prevDataIdx = band.start + ((i - 1) % bandLen)
        const prevVal = dataArray[prevDataIdx] / 255
        const prevX = (i - 1) * segWidth
        const prevNoiseOffset = Math.sin((prevX + offset) * 0.01) * 20
        const prevY = baseY - prevVal * h * heightScale + prevNoiseOffset
        const cpX = (prevX + xPos) / 2
        ctx.quadraticCurveTo(cpX, prevY, xPos, terrainY)
      }
    }

    ctx.lineTo(w, h)
    ctx.closePath()

    // Gradient fill using color scheme
    const grad = ctx.createLinearGradient(0, baseY - h * heightScale, 0, h)
    grad.addColorStop(0, `hsla(${c.h + avg * 30}, ${c.s}%, ${c.l + avg * 15}%, ${alpha})`)
    grad.addColorStop(0.5, `hsla(${c.h}, ${c.s - 10}%, ${c.l - 10}%, ${alpha})`)
    grad.addColorStop(1, `hsla(${c.h - 10}, ${c.s - 20}%, ${c.l - 20}%, ${alpha * 0.8})`)
    ctx.fillStyle = grad
    ctx.fill()

    // Subtle top edge glow
    ctx.strokeStyle = `hsla(${c.h + 20}, ${c.s + 10}%, ${c.l + avg * 20}%, ${0.2 + avg * 0.3})`
    ctx.lineWidth = 1.5 - depth
    ctx.beginPath()
    for (let i = 0; i <= bandLen; i++) {
      const dataIdx = band.start + (i % bandLen)
      const val = dataArray[dataIdx] / 255
      const xPos = i * segWidth
      const noiseOffset = Math.sin((xPos + offset) * 0.01) * 20
      const terrainY = baseY - val * h * heightScale + noiseOffset
      if (i === 0) ctx.moveTo(xPos, terrainY)
      else ctx.lineTo(xPos, terrainY)
    }
    ctx.stroke()
  }
}

// Main animation loop
function animate() {
  if (!canvas.value || !analyser || !dataArray) return
  
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return
  
  // Clear canvas — all effects render on transparent background
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
    case 'galaxy':
      drawGalaxy(ctx, dataArray)
      break
    case 'fountain':
      drawFountain(ctx, dataArray)
      break
    case 'terrain':
      drawTerrain(ctx, dataArray)
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

// Reset effect state when switching type
watch(visualizerType, () => {
  galaxyInitialized = false
  galaxyParticles = []
  galaxyRotation = 0
  fountainParticles = []
  lastBeatLevel = 0
  terrainOffset = 0
  if (canvas.value) {
    const ctx = canvas.value.getContext('2d')
    ctx?.clearRect(0, 0, canvasWidth.value, canvasHeight.value)
  }
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