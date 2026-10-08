import { SignalResponse } from '@livekit/protocol'

// LiveKit v1.13.7 advertises integrated TURN TLS at 443 regardless of tls_port.
// Rewrite only the operator's exact integrated TURN URL, preserving dynamic
// credentials. This adapter never touches SDP, candidates or client requests.
export function createKtvIceRewrite(options) {
  if (options === undefined) return data => data
  const { domain, port } = options || {}
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain || '') ||
    !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid KTV TURN advertisement')
  const original = `turns:${domain}:443?transport=tcp`, replacement = `turns:${domain}:${port}?transport=tcp`
  function update(servers) {
    let changed = false
    for (const server of servers || []) {
      if (!Array.isArray(server.urls)) continue
      server.urls = server.urls.map(url => { if (url !== original) return url; changed = true; return replacement })
    }
    return changed
  }
  return (data, binary) => {
    if (binary) {
      const response = SignalResponse.fromBinary(data)
      const payload = ['join', 'reconnect'].includes(response.message.case) ? response.message.value : null
      return payload && update(payload.iceServers) ? Buffer.from(response.toBinary()) : data
    }
    const response = JSON.parse(data.toString())
    const payload = response.join || response.reconnect
    // JSON keeps all unknown fields. Protobuf binary retains unknown fields by
    // default; unchanged frames are forwarded byte-for-byte.
    return payload && update(payload.iceServers) ? Buffer.from(JSON.stringify(response)) : data
  }
}
