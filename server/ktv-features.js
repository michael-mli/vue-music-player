// Flags are immutable for a backend process. Changing them requires a restart,
// which also starts a new clock epoch and the durable output-silence boundary.
export function ktvFeatures(options = {}) {
  const values = { rooms: true, guide: true, media: false, ...options }
  for (const [name, value] of Object.entries(values)) {
    if (!['rooms', 'guide', 'media'].includes(name) || typeof value !== 'boolean') {
      throw new Error(`Invalid KTV feature flag: ${name}`)
    }
  }
  return Object.freeze({ rooms: values.rooms, guide: values.rooms && values.guide,
    media: values.rooms && values.media })
}

export function ktvFeaturesFromEnv(env) {
  const flags = {}
  for (const [name, key] of [['rooms', 'KTV_ROOMS_ENABLED'], ['guide', 'KTV_GUIDE_ENABLED'], ['media', 'KTV_MEDIA_ENABLED']]) {
    if (env[key] === undefined) continue
    if (!['true', 'false'].includes(env[key])) throw new Error(`Invalid KTV feature flag: ${key}`)
    flags[name] = env[key] === 'true'
  }
  return ktvFeatures(flags)
}

export function ktvGuideAssets(assets, features) {
  return assets && !features.guide ? { ...assets, original: null,
    alignmentVerified: false, durationDifferenceMs: null } : assets
}
