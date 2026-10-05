import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {loadOpusPlcArtifact} from './party-opus-plc-artifact.mjs'
import {createLibOpusDecoder} from './party-opus-plc-decoder.mjs'

const {module,marker}=await loadOpusPlcArtifact(process.env.KTV_OPUS_PLC_BUILD)
const exec=promisify(execFile)
const chunk=(data,timestamp)=>({timestamp,byteLength:data.length,copyTo:target=>target.set(data)})
let packets
test.before(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ktv-opus-codec-'))
  try{
    const pcm=new Float32Array(48000*2)
    for(let i=0;i<48000;i++){
      pcm[i*2]=.2*Math.sin(i*2*Math.PI*440/48000)
      pcm[i*2+1]=.15*Math.sin(i*2*Math.PI*660/48000)
    }
    const input=path.join(root,'input.f32'),output=path.join(root,'fixture.ogg')
    await fs.writeFile(input,new Uint8Array(pcm.buffer),{mode:0o600})
    await exec('ffmpeg',['-v','error','-f','f32le','-ar','48000','-ac','2','-i',input,
      '-c:a','libopus','-b:a','64000','-frame_duration','20','-application','audio',output])
    const ogg=await fs.readFile(output),parts=[];packets=[]
    assert.ok(ogg.length<65536)
    let position=0
    while(position<ogg.length){
      assert.equal(ogg.toString('ascii',position,position+4),'OggS')
      const segments=ogg[position+26],begin=position+27
      let offset=begin+segments
      for(let i=0;i<segments;i++){
        const length=ogg[begin+i];parts.push(ogg.subarray(offset,offset+length));offset+=length
        if(length<255){const packet=Buffer.concat(parts);parts.length=0
          if(!['OpusHead','OpusTags'].includes(packet.toString('ascii',0,8)))packets.push(packet)
        }
      }
      position=offset
    }
    assert.equal(parts.length,0);assert.ok(packets.length>=50)
  }finally{await fs.rm(root,{recursive:true,force:true})}
})

function receiver(callback=()=>{}){
  const frames=[],errors=[]
  const decoder=createLibOpusDecoder(module,{output(frame){
    const planes=[new Float32Array(frame.numberOfFrames),new Float32Array(frame.numberOfFrames)]
    planes.forEach((plane,planeIndex)=>frame.copyTo(plane,{planeIndex,format:'f32-planar'}))
    frames.push({timestamp:frame.timestamp,frames:frame.numberOfFrames,planes});callback(frame)
  },error:value=>errors.push(value.message)})
  decoder.configure({codec:'opus',sampleRate:48000,numberOfChannels:2})
  return {decoder,frames,errors}
}
const rms=plane=>Math.sqrt(plane.reduce((sum,value)=>sum+value*value,0)/plane.length)

test('actual libopus decodes nominal stereo and confines each borrowed output and fixed codec memory',()=>{
  let borrowed
  const f=receiver(frame=>{borrowed=frame})
  packets.slice(0,30).forEach((packet,index)=>f.decoder.decode(chunk(packet,index*20000)))
  assert.equal(f.errors.length,0);assert.equal(f.frames.length,30)
  assert.ok(f.frames.every(frame=>frame.frames===960&&frame.planes.every(plane=>plane.every(Number.isFinite))))
  assert.ok(rms(f.frames[20].planes[0])>.1);assert.ok(rms(f.frames[20].planes[1])>.08)
  assert.notDeepEqual(f.frames[20].planes[0],f.frames[20].planes[1])
  assert.throws(()=>borrowed.copyTo(new Float32Array(960),{planeIndex:0,format:'f32-planar'}),/OPUS_WASM_COPY/)
  assert.equal(f.decoder.snapshot().codecBytes,524288);assert.equal(marker.codecBytes,524288)
  f.decoder.close();assert.equal(f.decoder.snapshot().codecBytes,0)
  assert.throws(()=>f.decoder.decode(chunk(packets[30],600000)),/OPUS_WASM_STATE/)
})
test('actual codec concealment fills a lost packet with finite stereo audio and continues decoding the next original',()=>{
  const f=receiver()
  for(let i=0;i<20;i++)f.decoder.decode(chunk(packets[i],i*20000))
  f.decoder.decodeLoss(400000,960)
  const concealed=f.frames.at(-1)
  assert.equal(concealed.timestamp,400000);assert.equal(concealed.frames,960)
  assert.ok(concealed.planes.every(plane=>plane.every(Number.isFinite)))
  assert.ok(rms(concealed.planes[0])>.02);assert.ok(rms(concealed.planes[1])>.02)
  assert.notDeepEqual(concealed.planes[0],f.frames.at(-2).planes[0])
  f.decoder.decode(chunk(packets[21],420000))
  assert.equal(f.errors.length,0);assert.equal(f.decoder.snapshot().concealedSamples,960)
  assert.equal(f.decoder.snapshot().concealedPackets,1);assert.equal(f.decoder.snapshot().decodedPackets,21)
  assert.ok(rms(f.frames.at(-1).planes[0])>.08);f.decoder.close()
})
test('real codec loss durations stay bounded and long concealment does not allocate growing memory',()=>{
  const f=receiver();for(let i=0;i<20;i++)f.decoder.decode(chunk(packets[i],i*20000))
  for(let i=0;i<100;i++)f.decoder.decodeLoss(400000+i*120000,5760)
  assert.equal(f.errors.length,0);assert.equal(f.decoder.snapshot().maximumFrames,5760)
  assert.equal(f.decoder.snapshot().concealedSamples,576000);assert.equal(f.decoder.snapshot().codecBytes,524288)
  f.decoder.close()
})
test('malformed input, invalid loss size and concealment without history terminate the real decoder',()=>{
  const empty=receiver();empty.decoder.decode(chunk(new Uint8Array(),0))
  assert.equal(empty.decoder.state,'closed');assert.equal(empty.errors.length,1);assert.equal(empty.frames.length,0)
  for(const frames of [0,121,5761]){
    const f=receiver();f.decoder.decode(chunk(packets[0],0));f.decoder.decodeLoss(20000,frames)
    assert.equal(f.decoder.state,'closed');assert.equal(f.errors.length,1);assert.equal(f.frames.length,1)
  }
  const initial=receiver();initial.decoder.decodeLoss(0,960)
  assert.equal(initial.decoder.state,'closed');assert.equal(initial.frames.length,0)
})
test('a stopped borrowed-output callback cannot retain usable codec memory or revive output',()=>{
  let decoder,borrowed
  decoder=createLibOpusDecoder(module,{output(frame){borrowed=frame;decoder.close()},error:()=>assert.fail('Unexpected codec failure')})
  decoder.configure({codec:'opus',sampleRate:48000,numberOfChannels:2});decoder.decode(chunk(packets[0],0))
  assert.equal(decoder.state,'closed');assert.equal(decoder.snapshot().codecBytes,0)
  assert.throws(()=>borrowed.copyTo(new Float32Array(960),{planeIndex:0,format:'f32-planar'}),/OPUS_WASM_COPY/)
  assert.throws(()=>decoder.decodeLoss(20000,960),/OPUS_WASM_STATE/)
})
