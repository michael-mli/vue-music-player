// Envelope bytes at the encoded transform, excluding RTP headers, retransmits,
// encryption and SFU allocation. Use actual counter publication times, because
// cached state can be several seconds older than an A/V measurement sample.
export function analyseVideoReferenceOverhead(samples,phase){
  const errors=[],result={phase,measurement:'encoded-envelope',errors,paths:[]}
  if(!Array.isArray(samples)||samples.length>10000){errors.push('invalid-samples');return result}
  const rows=samples.filter(row=>row.phase===phase)
  if(rows.length<2){errors.push('insufficient-samples');return result}
  for(const [side,direction,count] of [['source','send','wrapped'],['receiver','receive','unwrapped']]){
    const selected=rows.map(row=>(row[side]?.videoReferenceEnvelopes||[]).filter(item=>item.direction===direction&&!item.closed))
    if(selected.some(items=>items.length!==1)){errors.push(side+'-ambiguous-path');continue}
    const states=selected.map(items=>items[0]),first=states[0],last=states.at(-1)
    if(states.some((state,i)=>state.worker!==first.worker||state.version!==1||state.error!==null||
      !Number.isFinite(state.observedAtUnixMs)||
      ['payloadBytes','wireBytes','overheadBytes',count].some(key=>!Number.isSafeInteger(state[key])||state[key]<0||i&&state[key]<states[i-1][key])||
      state.wireBytes!==state.payloadBytes+state.overheadBytes||i&&state.observedAtUnixMs<states[i-1].observedAtUnixMs)){
      errors.push(side+'-invalid-counters');continue
    }
    const durationMs=last.observedAtUnixMs-first.observedAtUnixMs,frames=last[count]-first[count]
    if(durationMs<5000||frames<=0){errors.push(side+'-insufficient-duration');continue}
    const payloadBytes=last.payloadBytes-first.payloadBytes,overheadBytes=last.overheadBytes-first.overheadBytes,
      wireBytes=last.wireBytes-first.wireBytes
    if(overheadBytes<frames*30||overheadBytes>frames*94){errors.push(side+'-invalid-overhead');continue}
    result.paths.push({direction,durationMs,frames,payloadBytes,overheadBytes,wireBytes,
      payloadBps:payloadBytes*8000/durationMs,metadataBps:overheadBytes*8000/durationMs,
      envelopeBps:wireBytes*8000/durationMs,metadataBytesPerFrame:overheadBytes/frames})
  }
  return result
}
