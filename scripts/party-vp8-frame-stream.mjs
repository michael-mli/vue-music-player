// Private continuous decoder. The caller owns delivered VideoFrames; neither
// decoding nor capture-clock metadata grants permission to present them.
export function createVp8FrameStream(deliver,report=()=>{},{reorderMs=80,gapAware=false,codec='vp8',dependencyAware=false,markerProbe=null}={}) {
  if(!Number.isInteger(reorderMs)||reorderMs<0||reorderMs>700||typeof gapAware!=='boolean')throw new Error('VIDEO_REORDER_CONFIG')
  if(!['vp8','vp9'].includes(codec))throw new Error('VIDEO_CODEC_CONFIG')
  if(typeof dependencyAware!=='boolean'||dependencyAware&&(!gapAware||codec!=='vp9'))throw new Error('VIDEO_REORDER_CONFIG')
  if(markerProbe!==null&&typeof markerProbe!=='function')throw new Error('VIDEO_MARKER_CONFIG')
  const decoderCodec=codec==='vp9'?'vp09.00.31.08':'vp8'
  const heldLimit=reorderMs>240?20:8
  const expected=new Map(),pending=[]
  const held=new Map(),seen=new Set()
  const references=new Set()
  let referenceKey=null,dependencyPackets=0,referenceMisses=0,keyframeDrains=0,referenceRepairDrains=0
  const dependencies=metadata=>Number.isSafeInteger(metadata?.frameId)&&metadata.frameId>=0&&
    Array.isArray(metadata.dependencies)&&metadata.dependencies.length<=8&&
    metadata.dependencies.every(id=>Number.isSafeInteger(id)&&id>=0)
  let reorderTimer,flushing=false,maximumHeld=0,duplicates=0,lateFrames=0,reordered=0,pressureDrains=0,highestRtp=null
  let decoder,configured=false,closed=false,sequence=0,encodedBytes=0
  let pumping=false,maximumReady=0,committedGaps=0,contiguousDrains=0,transferWaits=0
  let outputDiagnostic=null,normalizedOutputs=0,maximumCopyBytes=0
  let markerReads=0,markerInvalid=0,markerTransitions=0,markerRegressions=0,lastMarker=null
  let lastRtp=null,lastTimestamp=0,captureAnchor=null,decoded=0,decodedKeyFrames=0,discarded=0,maximumBytes=0,maximumPending=0,maximumResidualMs=0
  const delta=(value,anchor)=>((value-anchor+0x80000000)>>>0)-0x80000000
  function missingReferenceWaitMs(){
    if(!dependencyAware||closed||!held.size||[...held.values()].some(packet=>packet.type==='key'))return 0
    const packet=[...held.values()].sort((a,b)=>delta(a.rtp,b.rtp))[0]
    if(packet.dependencies.every(id=>references.has(id)))return 0
    return Math.max(0,Math.floor(performance.now()-Math.min(...[...held.values()].map(item=>item.arrivedAt))))
  }
  function snapshot(){return {closed,configured,decoded,decodedKeyFrames,discarded,encodedBytes,pending:expected.size,
    maximumBytes,maximumPending,maximumReady,maximumResidualMs,heldPackets:held.size,maximumHeld,heldLimit,duplicates,lateFrames,reordered,pressureDrains,reorderMs,
    codec,gapAware,dependencyAware,dependencyPackets,referenceMisses,keyframeDrains,referenceRepairDrains,missingReferenceWaitMs:missingReferenceWaitMs(),committedGaps,contiguousDrains,transferWaits,outputDiagnostic,normalizedOutputs,maximumCopyBytes,
    ...(markerProbe?{markerProbe:{reads:markerReads,invalid:markerInvalid,transitions:markerTransitions,regressions:markerRegressions}}:{})}}
  function close(reason=null){
    if(closed)return
    closed=true;clearTimeout(reorderTimer);held.clear();seen.clear();references.clear();pending.length=0
    for(const packet of expected.values()){
      packet.frame?.close();packet.copyFrame?.close();packet.copyFrame=null
    }
    expected.clear();encodedBytes=0
    try{if(decoder?.state!=='closed')decoder?.close()}catch{}
    report({reason,...snapshot()})
  }
  function pump(){
    if(closed||pumping)return
    pumping=true
    try{
      while(!closed&&expected.size){
        const packet=expected.values().next().value,frame=packet.frame
        if(!frame)break
        const offset=captureAnchor?delta(packet.rtp,captureAnchor.rtp)/90:null
        let result=false
        if(captureAnchor&&performance.now()-captureAnchor.observedAt<=5000&&Math.abs(offset)<=5000){
          result=deliver(frame,{id:++sequence,bytes:packet.frameBytes,rtpTimestamp:packet.rtp,
            captureUnixMs:performance.timeOrigin+captureAnchor.capture+offset})
        }
        if(closed)return
        if(result==='wait'){transferWaits++;break}
        if(result===true&&markerProbe){
          markerReads++
          if(!packet.marker.valid)markerInvalid++
          else {
            if(lastMarker!==null&&packet.marker.id!==lastMarker)markerTransitions++
            if(lastMarker!==null&&packet.marker.id<lastMarker)markerRegressions++
            lastMarker=packet.marker.id
          }
        }
        expected.delete(packet.timestamp);packet.frame=null
        if(result!==true){discarded++;frame.close()}
      }
    }finally{pumping=false}
  }
  async function output(frame){
    let owned=false,packet
    try{
      if(closed)return
      packet=expected.get(frame.timestamp)
      if(!outputDiagnostic){
        outputDiagnostic={associated:!!packet}
        for(const key of ['codedWidth','codedHeight','displayWidth','displayHeight'])
          if(Number.isSafeInteger(frame[key])&&frame[key]>=0&&frame[key]<=8192)outputDiagnostic[key]=frame[key]
        if(['I420','I420A','I422','I444','I420P10','I422P10','I444P10','NV12','RGBA','RGBX','BGRA','BGRX'].includes(frame.format))
          outputDiagnostic.format=frame.format
        const allocation=frame.allocationSize()
        if(Number.isSafeInteger(allocation)&&allocation>=0&&allocation<=16*1024*1024)outputDiagnostic.bytes=allocation
      }
      if(!packet||packet.outputStarted||frame.displayWidth!==1280||frame.displayHeight!==720)throw new Error('VIDEO_OUTPUT')
      packet.outputStarted=true
      const bytes=frame.allocationSize()
      if(!['I420','NV12'].includes(frame.format)||!Number.isSafeInteger(bytes)||bytes<1||bytes>1280*720*3/2)throw new Error('VIDEO_OUTPUT')
      if(frame.codedWidth!==1280||frame.codedHeight!==720){
        const rect=frame.visibleRect
        if(typeof VideoFrame!=='function'||typeof frame.copyTo!=='function'||
          !Number.isSafeInteger(frame.codedWidth)||frame.codedWidth<1280||frame.codedWidth>1344||
          !Number.isSafeInteger(frame.codedHeight)||frame.codedHeight<720||frame.codedHeight>784||
          !rect||rect.width!==1280||rect.height!==720||!Number.isSafeInteger(rect.x)||!Number.isSafeInteger(rect.y)||
          rect.x<0||rect.y<0||rect.x+1280>frame.codedWidth||rect.y+720>frame.codedHeight)throw new Error('VIDEO_OUTPUT')
        // The full-RGBA slot covers padded YUV plus this exact visible copy.
        // Close the original before constructing its replacement so each
        // pending slot retains at most one decoded frame throughout the copy.
        const input=frame,format=frame.format,timestamp=frame.timestamp,colorSpace=frame.colorSpace
        const data=new ArrayBuffer(bytes);maximumCopyBytes=Math.max(maximumCopyBytes,bytes)
        packet.copyFrame=input;owned=true
        const layout=await input.copyTo(data,{rect:{x:rect.x,y:rect.y,width:1280,height:720}})
        if(closed)return
        input.close();packet.copyFrame=null;frame=null;owned=false
        frame=new VideoFrame(data,{format,codedWidth:1280,codedHeight:720,displayWidth:1280,displayHeight:720,timestamp,layout,colorSpace})
        if(frame.codedWidth!==1280||frame.codedHeight!==720||frame.displayWidth!==1280||frame.displayHeight!==720||
          frame.format!==format||frame.allocationSize()!==bytes)throw new Error('VIDEO_OUTPUT')
        normalizedOutputs++
      }
      if(markerProbe){
        // The small YUV region fits in the same full-RGBA pending reservation.
        // Keep the borrowed frame reachable by terminal cleanup while reading.
        packet.copyFrame=frame;owned=true
        packet.marker=await markerProbe(frame)
        if(closed)return
        if(typeof packet.marker?.valid!=='boolean'||packet.marker.valid&&
          (!Number.isInteger(packet.marker.id)||packet.marker.id<0||packet.marker.id>255))throw new Error('VIDEO_OUTPUT')
        packet.copyFrame=null;owned=false
      }
      decoded++
      if(packet.type==='key')decodedKeyFrames++
      encodedBytes-=packet.bytes;packet.bytes=0;packet.frame=frame;packet.frameBytes=bytes;owned=true
      maximumReady=Math.max(maximumReady,[...expected.values()].filter(item=>item.frame).length)
      pump()
    }catch{close('VIDEO_OUTPUT')}
    finally{if(!owned)frame?.close();if(!closed)flush()}
  }
  function decode(packet){
    const chunk=new EncodedVideoChunk({type:packet.type,timestamp:packet.timestamp,data:packet.data})
    // Once WebCodecs owns the chunk copy, expected output needs metadata only.
    packet.data=null
    decoder.decode(chunk)
  }
  function accept(packet){
    const step=lastRtp===null?0:delta(packet.rtp,lastRtp)
    if(gapAware&&lastRtp!==null&&step>54*90)committedGaps++
    if(Number.isFinite(packet.capture)){
      const residual=captureAnchor?packet.capture-(captureAnchor.capture+delta(packet.rtp,captureAnchor.rtp)/90):0
      maximumResidualMs=Math.max(maximumResidualMs,Math.abs(residual))
      if(Math.abs(residual)>80)throw new Error('VIDEO_CLOCK')
      captureAnchor={rtp:packet.rtp,capture:packet.capture,observedAt:packet.arrivedAt}
    }
    packet.timestamp=lastTimestamp+Math.round(step/90*1000)
    if(!Number.isSafeInteger(packet.timestamp))throw new Error('VIDEO_CLOCK')
    lastRtp=packet.rtp;lastTimestamp=packet.timestamp
    if(dependencyAware&&packet.dependencies&&packet.type!=='key'&&packet.dependencies.some(id=>!references.has(id))){
      referenceMisses++;discarded++;encodedBytes-=packet.bytes;packet.data=null;return
    }
    if(packet.frameId!==undefined){
      if(packet.type==='key'){references.clear();referenceKey=packet.frameId}
      references.add(packet.frameId)
      while(references.size>257){const oldest=[...references].find(id=>id!==referenceKey);references.delete(oldest)}
    }
    expected.set(packet.timestamp,packet)
    maximumPending=Math.max(maximumPending,expected.size)
    if(configured)decode(packet);else pending.push(packet)
  }
  function failure(error){close(['VIDEO_PACKET','VIDEO_CLOCK','VIDEO_BOUND','VIDEO_REFERENCE'].includes(error.message)?error.message:'VIDEO_DECODE')}
  function flush(forceOne=false){
    if(closed||flushing)return
    flushing=true;clearTimeout(reorderTimer);reorderTimer=null
    try{
      while(!closed&&held.size&&expected.size<4){
        const packet=[...held.values()].sort((a,b)=>delta(a.rtp,b.rtp))[0]
        const firstArrival=Math.min(...[...held.values()].map(item=>item.arrivedAt))
        const remaining=reorderMs-(performance.now()-firstArrival)
        const contiguous=dependencyAware&&packet.dependencies?
          packet.type==='key'||packet.dependencies.every(id=>references.has(id)):
          gapAware&&lastRtp!==null&&delta(packet.rtp,lastRtp)<=54*90
        // An independently decodable keyframe ends the older repair wait.
        // Still visit every older packet in RTP order: safe inputs decode;
        // missing-reference inputs release their payload without decoding.
        // A full native-output reservation continues to park the queue.
        const recovered=dependencyAware&&!contiguous&&[...held.values()].some(item=>
          item.type==='key'&&delta(item.rtp,packet.rtp)>0)
        if(remaining>0&&!forceOne&&!contiguous&&!recovered){reorderTimer=setTimeout(flush,Math.max(1,remaining));break}
        if(remaining>0&&!contiguous){if(recovered)keyframeDrains++;else pressureDrains++}
        if(contiguous&&held.size>1)contiguousDrains++
        forceOne=false
        held.delete(packet.rtp);accept(packet)
      }
    }catch(error){failure(error)}
    finally{flushing=false}
  }
  if(typeof VideoDecoder!=='function'||typeof EncodedVideoChunk!=='function')close('VIDEO_API')
  else void VideoDecoder.isConfigSupported({codec:decoderCodec,codedWidth:1280,codedHeight:720,optimizeForLatency:true}).then(result=>{
    if(closed)return
    if(!result.supported){close('VIDEO_CONFIG');return}
    decoder=new VideoDecoder({output,error:()=>close('VIDEO_DECODE')});decoder.configure(result.config);configured=true
    while(!closed&&pending.length)decode(pending.shift())
  }).catch(()=>close('VIDEO_CONFIG'))
  return {snapshot,close,resume(){if(closed)return;try{pump();flush()}catch{close('VIDEO_OUTPUT')}},observe(frame,metadata){
    if(closed)return
    if(lastRtp===null&&frame.type!=='key')return
    try{
      const rtp=frame.timestamp
      if(!Number.isInteger(rtp)||rtp<0||rtp>0xffffffff||!['key','delta'].includes(frame.type)||
        self.__encodedTimingCodecs?.find(item=>item.payloadType===metadata?.payloadType)?.mimeType!==`video/${codec}`)throw new Error('VIDEO_PACKET')
      const step=lastRtp===null?0:delta(rtp,lastRtp)
      if(seen.has(rtp)){discarded++;duplicates++;return}
      seen.add(rtp);if(seen.size>64)seen.delete(seen.values().next().value)
      if(lastRtp!==null&&step<=0){discarded++;lateFrames++;return}
      if(step>450000)throw new Error('VIDEO_CLOCK')
      const data=frame.data
      if(!(data instanceof ArrayBuffer)||data.byteLength<1||data.byteLength>256*1024)throw new Error('VIDEO_PACKET')
      if(dependencyAware&&(!dependencies(metadata)||frame.type!=='key'&&metadata.dependencies.length===0))throw new Error('VIDEO_REFERENCE')
      const oldest=dependencyAware&&held.size>=heldLimit?
        [...held.values()].sort((a,b)=>delta(a.rtp,b.rtp))[0]:null
      // Admit an actual missing parent before a pressure drain advances past
      // it. This uses an existing native output slot, never a 21st held entry.
      // It must precede every held RTP input and repair the oldest dependency
      // using references already owned by this decoder, before the fixed wait.
      const repair=oldest&&frame.type==='delta'&&expected.size<4&&delta(rtp,oldest.rtp)<0&&
        oldest.dependencies.includes(metadata.frameId)&&metadata.dependencies.every(id=>references.has(id))&&
        performance.now()-Math.min(...[...held.values()].map(item=>item.arrivedAt))<reorderMs
      // A network burst can fill the time-based queue before its deadline.
      // Decode the oldest retained packet before exceeding the encoded count.
      // A stalled decoder still fails closed at the same queue/input bounds.
      if(held.size>=heldLimit&&!repair)flush(true)
      if(closed)return
      if(lastRtp!==null&&delta(rtp,lastRtp)<=0){discarded++;lateFrames++;return}
      if(held.size>=heldLimit&&!repair||encodedBytes+data.byteLength>512*1024||reorderMs===0&&expected.size>=4)throw new Error('VIDEO_BOUND')
      const packet={rtp,type:frame.type,bytes:data.byteLength,data:data.slice(0),capture:metadata?.captureTime,arrivedAt:performance.now()}
      if(dependencyAware&&dependencies(metadata)&&(frame.type==='key'||metadata.dependencies.length>0)){
        packet.frameId=metadata.frameId;packet.dependencies=metadata.dependencies.slice();dependencyPackets++
      }
      if(highestRtp!==null&&delta(rtp,highestRtp)<0)reordered++
      else highestRtp=rtp
      encodedBytes+=packet.bytes;maximumBytes=Math.max(maximumBytes,encodedBytes)
      if(lastRtp===null||repair){accept(packet);if(repair){referenceRepairDrains++;flush()}}
      else{held.set(rtp,packet);maximumHeld=Math.max(maximumHeld,held.size);flush()}
    }catch(error){failure(error)}
  }}
}
