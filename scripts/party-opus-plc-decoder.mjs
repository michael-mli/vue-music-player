// Private libopus adapter. Callbacks borrow one output buffer synchronously;
// they must copy it into their own, independently reserved PCM payloads.
export function createLibOpusDecoder(module,{output,error}) {
  if(!(module instanceof WebAssembly.Module)||typeof output!=='function'||typeof error!=='function')throw new Error('OPUS_WASM_CONFIG')
  const allowed=new Set(['fd_write','fd_close','fd_seek','proc_exit'])
  if(WebAssembly.Module.imports(module).some(item=>item.module!=='wasi_snapshot_preview1'||item.kind!=='function'||!allowed.has(item.name)))throw new Error('OPUS_WASM_IMPORT')
  const initStart=performance.now()
  let instance=new WebAssembly.Instance(module,{wasi_snapshot_preview1:{
    fd_write:()=>52,fd_close:()=>0,fd_seek:()=>29,proc_exit:()=>{throw new Error('OPUS_WASM_TRAP')}}})
  let api=instance.exports,memory=api.memory,inputPointer,outputPointer
  let state='unconfigured',decodedPackets=0,concealedPackets=0,concealedSamples=0,maximumFrames=0,totalDecodeMs=0,maximumDecodeMs=0
  const names=['ktv_opus_version','ktv_opus_input','ktv_opus_output','ktv_opus_open','ktv_opus_decode','ktv_opus_conceal','ktv_opus_close']
  if(!(memory instanceof WebAssembly.Memory)||memory.buffer.byteLength!==524288||names.some(name=>typeof api[name]!=='function')||
    api.ktv_opus_version()!==10601)throw new Error('OPUS_WASM_ABI')
  // Test the actual module's maximum, not a declaration in its build marker.
  let fixed=false
  try{memory.grow(1)}catch(exception){fixed=exception instanceof RangeError}
  if(!fixed)throw new Error('OPUS_WASM_BOUND')
  inputPointer=api.ktv_opus_input();outputPointer=api.ktv_opus_output()
  if(!Number.isSafeInteger(inputPointer)||!Number.isSafeInteger(outputPointer)||inputPointer<0||outputPointer<0||
    outputPointer%4||inputPointer+65536>524288||outputPointer+46080>524288||
    inputPointer<outputPointer+46080&&outputPointer<inputPointer+65536)throw new Error('OPUS_WASM_ABI')
  api._initialize?.()
  const initMs=performance.now()-initStart
  function close(){
    if(state==='closed')return
    state='closed'
    try{api.ktv_opus_close()}finally{api=null;memory=null;instance=null}
  }
  function fail(code){close();error(new Error(code))}
  function emit(frames,timestamp){
    if(!Number.isInteger(frames)||frames<120||frames>5760||frames%120)throw new Error('OPUS_WASM_OUTPUT')
    let samples=new Float32Array(memory.buffer,outputPointer,frames*2)
    if(samples.some(sample=>!Number.isFinite(sample)))throw new Error('OPUS_WASM_OUTPUT')
    maximumFrames=Math.max(maximumFrames,frames)
    const frame={sampleRate:48000,numberOfChannels:2,numberOfFrames:frames,timestamp,duration:frames/48000*1000000,
      copyTo(destination,{planeIndex,format}={}){
        if(!samples||!(destination instanceof Float32Array)||destination.length!==frames||![0,1].includes(planeIndex)||format!=='f32-planar')throw new Error('OPUS_WASM_COPY')
        for(let index=0;index<frames;index++)destination[index]=samples[index*2+planeIndex]
      },close(){samples=null}}
    try{const result=output(frame);if(result?.then)throw new Error('OPUS_WASM_ASYNC_OUTPUT')}
    finally{frame.close()}
  }
  function check(timestamp){
    if(state!=='configured')throw new Error('OPUS_WASM_STATE')
    if(!Number.isSafeInteger(timestamp))throw new Error('OPUS_WASM_CLOCK')
  }
  return {get state(){return state},configure(config){
    if(state!=='unconfigured'||config?.codec!=='opus'||config.sampleRate!==48000||config.numberOfChannels!==2)throw new Error('OPUS_WASM_CONFIG')
    if(api.ktv_opus_open()!==0){fail('OPUS_WASM_OPEN');return}
    state='configured'
  },decode(chunk){
    check(chunk?.timestamp)
    try{
      if(!Number.isInteger(chunk.byteLength)||chunk.byteLength<1||chunk.byteLength>65536||typeof chunk.copyTo!=='function')throw new Error('OPUS_WASM_PACKET')
      chunk.copyTo(new Uint8Array(memory.buffer,inputPointer,chunk.byteLength))
      const start=performance.now(),frames=api.ktv_opus_decode(chunk.byteLength),elapsed=performance.now()-start
      totalDecodeMs+=elapsed;maximumDecodeMs=Math.max(maximumDecodeMs,elapsed)
      if(frames<0)throw new Error('OPUS_WASM_DECODE')
      decodedPackets++;emit(frames,chunk.timestamp)
    }catch{fail('OPUS_WASM_DECODE')}
  },decodeLoss(timestamp,frames){
    check(timestamp)
    try{
      if(!decodedPackets||!Number.isInteger(frames)||frames<120||frames>5760||frames%120)throw new Error('OPUS_WASM_LOSS')
      const start=performance.now(),actual=api.ktv_opus_conceal(frames),elapsed=performance.now()-start
      totalDecodeMs+=elapsed;maximumDecodeMs=Math.max(maximumDecodeMs,elapsed)
      if(actual!==frames)throw new Error('OPUS_WASM_LOSS')
      concealedPackets++;concealedSamples+=frames;emit(actual,timestamp)
    }catch{fail('OPUS_WASM_LOSS')}
  },close,snapshot(){return {state,codec:'opus',sampleRate:48000,channels:2,codecBytes:state==='closed'?0:524288,
    decodedPackets,concealedPackets,concealedSamples,maximumFrames,initMs,totalDecodeMs,maximumDecodeMs}}}
}

// Install a private factory only; native RTC/WebCodecs APIs are untouched.
// Compile synchronously before worker handlers are attached, avoiding lost
// transform/bind messages during asynchronous module initialisation.
export function installOpusPlcDecoder(base64,createDecoder){
  if(typeof base64!=='string'||base64.length>2*1024*1024||typeof createDecoder!=='function')throw new Error('OPUS_WASM_CONFIG')
  const binary=Uint8Array.from(atob(base64),value=>value.charCodeAt(0))
  const module=new WebAssembly.Module(binary)
  self.__ownedOpusDecoder=class {
    static async isConfigSupported(config){return {supported:config?.codec==='opus'&&config.sampleRate===48000&&config.numberOfChannels===2,config}}
    constructor(callbacks){return createDecoder(module,callbacks)}
  }
}
