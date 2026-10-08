import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {opusSourceHash,opusCompilerImage,opusCodecBytes} from './party-opus-plc-build.mjs'

export async function loadOpusPlcArtifact(root){
  if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('OPUS_ARTIFACT_DIRECTORY')
  const marker=JSON.parse(await fs.readFile(path.join(root,'build.json'),'utf8'))
  const wasm=await fs.readFile(path.join(root,'party-opus-plc.wasm'))
  const wrapper=await fs.readFile(new URL('party-opus-plc.c',import.meta.url))
  const hash=value=>createHash('sha256').update(value).digest('hex')
  if(marker.version!==1||marker.privateOpusDecoder!==true||marker.opusVersion!=='1.6.1'||
    marker.sourceHash!==opusSourceHash||marker.compilerImage!==opusCompilerImage||marker.codecBytes!==opusCodecBytes||
    marker.deepPlc!==false||marker.dred!==false||marker.osce!==false||marker.wasmBytes!==wasm.length||
    wasm.length>2*1024*1024||marker.wasmHash!==hash(wasm)||marker.wrapperHash!==hash(wrapper))throw new Error('OPUS_ARTIFACT_HASH')
  const module=await WebAssembly.compile(wasm)
  return {module,marker,wasm}
}
