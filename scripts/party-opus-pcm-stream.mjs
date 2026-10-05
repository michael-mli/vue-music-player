// Private streaming decoder. PCM ownership transfers to a bounded renderer;
// this module never connects an output or grants permission to play it.
export function createOpusPcmStream(primaryPayload, packetFrames, deliver, report = () => {}, {reorderMs=80,batchPackets=1}={}) {
  if(!Number.isInteger(reorderMs)||reorderMs<0||reorderMs>80)throw new Error('PCM_REORDER_CONFIG')
  if(![1,2].includes(batchPackets))throw new Error('PCM_BATCH_CONFIG')
  const pending = [], expected = [], credits = new Map()
  const held=new Map()
  let decoder, configured = false, closed = false, sequence = 0
  let encodedBytes = 0, pcmBytes = 0, anchor = null, lastEnd = null
  let decoded = 0, gaps = 0, duplicates = 0, maximumChunks = 0, maximumBytes = 0
  let lastCaptureUnixMs=null,maximumResidualMs=0,captureAnchor=null
  let scheduledCaptureUnixMs=null,captureOffsetMs=0,maximumOffsetMs=0
  let recovered=0,closeReason=null,flushing=false,backpressureEvents=0
  let reorderTimer=null,reordered=0,maximumHeld=0,pressureDrains=0
  const batch=[]
  let batchTimer=null,groupedChunks=0,maximumGroupPackets=0
  const delta = (value, previous) => ((value-previous+0x80000000)>>>0)-0x80000000
  function snapshot() { return { closed, configured, decoded, gaps, duplicates, chunks:credits.size,
    encodedBytes, pcmBytes, maximumChunks, maximumBytes,lastCaptureUnixMs,maximumResidualMs,recovered,
    scheduledCaptureUnixMs,captureOffsetMs,maximumOffsetMs,reordered,heldPackets:held.size,maximumHeld,pressureDrains,reason:closeReason,backpressureEvents,
    batchPackets,groupedChunks,maximumGroupPackets,pendingGroupPackets:batch.length } }
  function close(reason = null) {
    if (closed) return
    closed = true;closeReason=reason;clearTimeout(reorderTimer);clearTimeout(batchTimer);held.clear();batch.length=0
    pending.length = 0; expected.length = 0; credits.clear(); encodedBytes = 0; pcmBytes = 0
    try { if (decoder?.state !== 'closed') decoder?.close() } catch {}
    report({ type:'closed', reason, ...snapshot() })
  }
  function flushBatch(){
    if(closed||!batch.length)return
    clearTimeout(batchTimer);batchTimer=null
    const entries=batch.splice(0),first=entries[0],last=entries.at(-1)
    let planes=first.planes,frames=first.frames,bytes=first.bytes
    if(entries.length>1){
      frames=entries.reduce((sum,item)=>sum+item.frames,0)
      const channels=Math.max(...entries.map(item=>item.planes.length))
      bytes=frames*channels*4
      if(frames>5760||pcmBytes+bytes>1024*1024)throw new Error('PCM_BOUND')
      // Reserve the temporary combined copy before allocation. Release every
      // original plane reference before removing its reservation or transferring.
      pcmBytes+=bytes;maximumBytes=Math.max(maximumBytes,pcmBytes)
      planes=Array.from({length:channels},()=>new Float32Array(frames))
      let offset=0
      for(const item of entries){
        for(let channel=0;channel<channels;channel++)planes[channel].set(item.planes[channel]||item.planes[0],offset)
        offset+=item.frames;item.planes.length=0
        credits.delete(item.id);pcmBytes-=item.bytes
      }
      groupedChunks++
    }
    maximumGroupPackets=Math.max(maximumGroupPackets,entries.length)
    credits.set(last.id,{bytes,delivered:true})
    deliver({id:last.id,rtpTimestamp:first.rtpTimestamp,captureUnixMs:first.captureUnixMs,
      observedCaptureUnixMs:first.observedCaptureUnixMs,frames,planes})
  }
  function queueOutput(packet,planes,bytes){
    const previous=batch.at(-1)
    if(previous&&(delta(packet.rtpTimestamp,(previous.rtpTimestamp+previous.frames)>>>0)!==0||
      batch.reduce((sum,item)=>sum+item.frames,0)+packet.frames>5760))flushBatch()
    if(closed)return
    batch.push({id:packet.id,rtpTimestamp:packet.rtpTimestamp,captureUnixMs:packet.captureUnixMs,
      observedCaptureUnixMs:packet.observedCaptureUnixMs,frames:packet.frames,planes,bytes})
    if(batch.length>=batchPackets)flushBatch()
    else if(batchTimer===null)batchTimer=setTimeout(()=>{
      try{flushBatch()}catch(error){close(error.message==='PCM_BOUND'?'PCM_BOUND':'PCM_OUTPUT')}
    },40)
  }
  function output(frame) {
    try {
      if (closed) return
      const packet = expected.shift()
      if (!packet || frame.sampleRate !== 48000 || !Number.isSafeInteger(frame.timestamp) ||
        !Number.isInteger(frame.numberOfChannels) || frame.numberOfChannels < 1 || frame.numberOfChannels > 2 ||
        frame.numberOfFrames !== packet.frames || !Number.isFinite(frame.duration) ||
        Math.abs(frame.duration-packet.frames/48000*1000000)>1) throw new Error('PCM_OUTPUT')
      encodedBytes -= packet.data.byteLength
      const planes = Array.from({length:frame.numberOfChannels}, (_,planeIndex) => {
        const plane = new Float32Array(packet.frames)
        frame.copyTo(plane,{planeIndex,format:'f32-planar'})
        if (plane.some(value=>!Number.isFinite(value))) throw new Error('PCM_OUTPUT')
        return plane
      })
      const bytes = planes.reduce((sum,plane)=>sum+plane.byteLength,0)
      pcmBytes -= packet.reservedBytes-bytes
      // Held group members cannot be consumed before their combined transfer.
      credits.set(packet.id,{bytes,delivered:false})
      decoded++
      queueOutput(packet,planes,bytes)
    } catch(error) { close(error.message==='PCM_BOUND'?'PCM_BOUND':'PCM_OUTPUT') }
    finally { frame.close() }
  }
  function decode(packet) {
    expected.push(packet)
    decoder.decode(new EncodedAudioChunk({type:'key',timestamp:packet.timestamp,data:packet.data}))
  }
  function accept(data,rtp,capture,isRecovery=false){
    if(closed)return
    const frames=packetFrames(data),reservedBytes=frames*2*4
    if(credits.size>=48||pcmBytes+reservedBytes>1024*1024||encodedBytes+data.byteLength>512*1024)throw new Error('PCM_BOUND')
    anchor??={rtp,capture}
    const captureUnixMs=anchor.capture+delta(rtp,anchor.rtp)/48
    if(lastEnd!==null&&delta(rtp,lastEnd)>240000)throw new Error('PCM_CLOCK')
    if(lastEnd!==null)gaps+=delta(rtp,lastEnd)
    lastEnd=(rtp+frames)>>>0
    const packet={id:++sequence,rtpTimestamp:rtp,frames,reservedBytes,captureUnixMs,observedCaptureUnixMs:capture,
      timestamp:Math.round((capture-performance.timeOrigin)*1000),data:data.slice()}
    credits.set(packet.id,{bytes:reservedBytes,delivered:false});pcmBytes+=reservedBytes;encodedBytes+=packet.data.byteLength
    maximumChunks=Math.max(maximumChunks,credits.size);maximumBytes=Math.max(maximumBytes,pcmBytes)
    if(isRecovery)recovered++
    if(configured)decode(packet);else pending.push(packet)
  }
  function discard(packet){held.delete(packet.rtp);encodedBytes-=packet.bytes}
  function fail(error){close(['PCM_CLOCK','PCM_BOUND','PCM_PACKET'].includes(error.message)?error.message:'PCM_PACKET')}
  function flush(forceOne=false){
    if(closed||flushing)return
    flushing=true
    clearTimeout(reorderTimer);reorderTimer=null
    try{
      while(!closed&&held.size){
        const packet=[...held.values()].sort((a,b)=>delta(a.rtp,b.rtp))[0]
        if(lastEnd!==null&&delta(packet.rtp,lastEnd)<0){discard(packet);duplicates++;continue}
        const firstArrival=Math.min(...[...held.values()].map(item=>item.arrivedAt))
        const aged=performance.now()-firstArrival>=reorderMs,expired=aged||forceOne
        let pressureCommitted=false
        // Repair contiguous history immediately. Wait for an earlier primary
        // before committing an unrecoverable gap, for at most 80 ms.
        if(lastEnd!==null&&delta(packet.rtp,lastEnd)>0){
          for(const block of packet.redundant){
            if(!block.timestampOffset||!block.data.length)continue
            const rtp=(packet.rtp-block.timestampOffset)>>>0
            if(delta(rtp,lastEnd)<0)continue
            if(packetFrames(block.data)>block.timestampOffset)throw new Error('PCM_PACKET')
            if(delta(rtp,lastEnd)>0&&!expired)break
            if(credits.size>=48||pcmBytes+packetFrames(block.data)*8>1024*1024){backpressureEvents++;return}
            if(forceOne&&!aged&&!pressureCommitted&&delta(rtp,lastEnd)>0){pressureDrains++;pressureCommitted=true}
            accept(block.data,rtp,packet.capture-block.timestampOffset/48,true)
            if(closed)return
          }
        }
        if(lastEnd!==null&&delta(packet.rtp,lastEnd)>0&&!expired){
          reorderTimer=setTimeout(flush,Math.max(1,reorderMs-(performance.now()-firstArrival)))
          return
        }
        if(credits.size>=48||pcmBytes+packetFrames(packet.data)*8>1024*1024){backpressureEvents++;return}
        if(forceOne&&!aged&&!pressureCommitted&&lastEnd!==null&&delta(packet.rtp,lastEnd)>0)pressureDrains++
        discard(packet);accept(packet.data,packet.rtp,packet.capture);forceOne=false
      }
    }catch(error){fail(error)}
    finally{flushing=false}
  }
  if (typeof AudioDecoder !== 'function' || typeof EncodedAudioChunk !== 'function') close('PCM_API')
  else void AudioDecoder.isConfigSupported({codec:'opus',sampleRate:48000,numberOfChannels:2}).then(result=>{
    if (closed) return
    if (!result.supported) { close('PCM_CONFIG'); return }
    decoder = new AudioDecoder({output,error:()=>close('PCM_DECODE')})
    decoder.configure(result.config); configured = true
    while (!closed && pending.length) decode(pending.shift())
  }).catch(()=>close('PCM_CONFIG'))
  return {
    observe(frame, metadata) {
      if (closed || !Number.isFinite(metadata?.captureTime)) return
      try {
        const rtp = frame.timestamp, capture = performance.timeOrigin+metadata.captureTime
        if (!Number.isInteger(rtp) || rtp<0 || rtp>0xffffffff || !Number.isFinite(capture)) throw new Error('PCM_CLOCK')
        // Late/duplicate packets cannot move the decoded sample timeline back.
        if (lastEnd !== null && delta(rtp,lastEnd)<0 || held.has(rtp)) { duplicates++; return }
        // Validate advancing capture anchors, as the independent RTP clock does.
        // The render schedule retains its first sample anchor: changing every
        // chunk's schedule to a noisy header would introduce overlaps or gaps.
        const residual=captureAnchor?capture-(captureAnchor.capture+delta(rtp,captureAnchor.rtp)/48):0
        maximumResidualMs=Math.max(maximumResidualMs,Math.abs(residual))
        if(Math.abs(residual)>80)throw new Error('PCM_CLOCK')
        const scheduled=anchor?anchor.capture+delta(rtp,anchor.rtp)/48:capture
        const offset=capture-scheduled
        maximumOffsetMs=Math.max(maximumOffsetMs,Math.abs(offset))
        // Fixed-rate rendering cannot absorb arbitrary accumulated drift. Keep
        // the phase within the smallest supported hold, pending rate control.
        if(Math.abs(offset)>200)throw new Error('PCM_CLOCK')
        if(!captureAnchor||delta(rtp,captureAnchor.rtp)>0){
          if(captureAnchor&&delta(rtp,captureAnchor.rtp)>240000)throw new Error('PCM_CLOCK')
          captureAnchor={rtp,capture};lastCaptureUnixMs=capture
          scheduledCaptureUnixMs=scheduled;captureOffsetMs=offset
        }
        const data = frame.data
        if (!(data instanceof ArrayBuffer) || data.byteLength<1 || data.byteLength>65536) throw new Error('PCM_PACKET')
        const payload = primaryPayload(new Uint8Array(data),metadata.payloadType,self.__encodedTimingCodecs || [])
        const redundant=[...(payload.redundant||[])].sort((a,b)=>b.timestampOffset-a.timestampOffset)
        const bytes=payload.data.byteLength+redundant.reduce((sum,block)=>sum+block.data.byteLength,0)
        if(held.size>=8){
          // A contiguous repair is more useful than prematurely committing the
          // oldest gap. Decode it without retaining a ninth reorder packet.
          if(lastEnd!==null&&delta(rtp,lastEnd)===0){
            accept(payload.data,rtp,capture);flush();return
          }
          // A burst may exhaust packet slots before the 80-ms wait expires.
          // Commit only the oldest gap early, with the existing PCM credits and
          // byte limits. A genuinely stalled decoder/renderer still fails closed.
          flush(true)
          if(closed)return
          if(lastEnd!==null&&delta(rtp,lastEnd)<0){duplicates++;return}
        }
        if(held.size>=8||encodedBytes+bytes>512*1024)throw new Error('PCM_BOUND')
        // Copy only after reserving the same shared encoded-byte budget used by
        // pending decoding. RTC-owned payloads continue downstream unchanged.
        held.set(rtp,{rtp,capture,bytes,arrivedAt:performance.now(),data:payload.data.slice(),
          redundant:redundant.map(block=>({timestampOffset:block.timestampOffset,data:block.data.slice()}))})
        encodedBytes+=bytes;maximumHeld=Math.max(maximumHeld,held.size)
        if(captureAnchor&&delta(rtp,captureAnchor.rtp)<0)reordered++
        flush()
      } catch (error) { fail(error) }
    },
    consumed({id,bytes}) {
      if (closed) return
      const credit = credits.get(id)
      if (!credit?.delivered || !Number.isSafeInteger(bytes) || credit.bytes!==bytes) { close('PCM_CREDIT'); return }
      credits.delete(id); pcmBytes -= bytes
      flush()
    }, close, snapshot
  }
}
