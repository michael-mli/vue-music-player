// Native capability instrumentation only: the copied PCM is always behind a
// zero gain. The application's existing guarded audible path is untouched.
export async function probeReceivedPcm(Queue,worklet) {
  const track=document.querySelector('[data-party-media-screen] video')?.srcObject?.getAudioTracks()[0]
  const worker=window.__encodedTimingProbe?.receiverWorker(track)
  if(!track||!worker)throw new Error('PCM_PROBE_RECEIVER')
  const context=new AudioContext({sampleRate:48000})
  let source,analyser,mute,url,closed=false
  function close(){if(closed)return;closed=true;source?.port.postMessage({type:'stop'});source?.disconnect();
    analyser?.disconnect();mute?.disconnect();URL.revokeObjectURL(url);void context.close()}
  try{
    await context.resume()
    url=URL.createObjectURL(new Blob([`(${worklet.toString()})(${Queue.toString()});`],{type:'text/javascript'}))
    await context.audioWorklet.addModule(url)
    source=new AudioWorkletNode(context,'party-owned-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]})
    analyser=context.createAnalyser();analyser.fftSize=8192;analyser.smoothingTimeConstant=0
    mute=context.createGain();mute.gain.value=0
    source.connect(analyser);analyser.connect(mute);mute.connect(context.destination)
    const channel=new MessageChannel()
    source.port.postMessage({type:'bind',port:channel.port1},[channel.port1])
    worker.postMessage({type:'pcm-bind',configuration:{port:channel.port2,renderFrame:Math.round(context.currentTime*48000),
      wallUnixMs:Date.now(),delayMs:200,expiryUnixMs:Date.now()+9000}},[channel.port2])
    window.__receivedPcmProbe={close,spectrum(){
      const values=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(values)
      return [440,880,1729].map(frequency=>{const center=Math.round(frequency*analyser.fftSize/context.sampleRate);
        const value=Math.max(...values.slice(center-2,center+3));return Number.isFinite(value)?value:-120})
    }}
    return {sampleRate:context.sampleRate,muted:mute.gain.value===0}
  }catch(error){close();throw error}
}
