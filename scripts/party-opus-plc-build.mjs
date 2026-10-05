// Reproducible private codec build. Artifacts remain outside the app's dist.
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec=promisify(execFile)
export const opusSourceHash='6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1'
export const opusCompilerImage='emscripten/emsdk:4.0.23@sha256:86537645c51e44899812d29820ee3b64b96c321ebb2aba4416a04ceeb1bcde62'
export const opusCodecBytes=524288
const hash=value=>createHash('sha256').update(value).digest('hex')

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const root=path.resolve(process.argv[2]||'')
  if(!process.argv[2])throw new Error('OPUS_BUILD_DIRECTORY')
  await fs.mkdir(root,{recursive:false,mode:0o700})
  const source=path.join(root,'opus.tar.gz')
  const response=await fetch('https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz')
  if(!response.ok)throw new Error('OPUS_SOURCE_DOWNLOAD')
  const archive=Buffer.from(await response.arrayBuffer())
  if(archive.length>16*1024*1024||hash(archive)!==opusSourceHash)throw new Error('OPUS_SOURCE_HASH')
  await fs.writeFile(source,archive,{flag:'wx',mode:0o600})
  await exec('tar',['--extract','--gzip','--file',source,'--directory',root,'--no-same-owner'])
  const wrapper=await fs.readFile(new URL('party-opus-plc.c',import.meta.url))
  await fs.writeFile(path.join(root,'party-opus-plc.c'),wrapper,{flag:'wx',mode:0o600})
  // No untrusted text is interpolated in the shell program. Docker owns the
  // directory argument; build commands and compiler options are fixed.
  const program=`set -eu
cp -R /emsdk/upstream/emscripten/cache /build/compiler-cache
cd /build/opus-1.6.1
emconfigure ./configure --host=wasm32-unknown-emscripten --disable-shared --enable-static --disable-asm --disable-rtcd --disable-intrinsics --disable-extra-programs --disable-deep-plc --disable-dred --disable-osce CFLAGS='-O3 -DNDEBUG'
emmake make -j2
emcc -O3 -DNDEBUG -Iinclude /build/party-opus-plc.c .libs/libopus.a --no-entry -s STANDALONE_WASM=1 -s INITIAL_MEMORY=524288 -s STACK_SIZE=131072 -s ALLOW_MEMORY_GROWTH=0 -s EXPORTED_FUNCTIONS='["_ktv_opus_version","_ktv_opus_input","_ktv_opus_output","_ktv_opus_open","_ktv_opus_decode","_ktv_opus_conceal","_ktv_opus_close"]' -o /build/party-opus-plc.wasm
`
  await exec('docker',['run','--rm','--user',`${process.getuid()}:${process.getgid()}`,'--env','EM_CACHE=/build/compiler-cache','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges',
    '--mount',`type=bind,src=${root},dst=/build`,'--workdir','/build',opusCompilerImage,'bash','-c',program],{maxBuffer:4*1024*1024})
  const wasm=await fs.readFile(path.join(root,'party-opus-plc.wasm'))
  const module=await WebAssembly.compile(wasm)
  const marker={version:1,privateOpusDecoder:true,opusVersion:'1.6.1',sourceHash:opusSourceHash,
    compilerImage:opusCompilerImage,wrapperHash:hash(wrapper),wasmHash:hash(wasm),wasmBytes:wasm.length,
    codecBytes:opusCodecBytes,deepPlc:false,dred:false,osce:false,imports:WebAssembly.Module.imports(module)}
  await fs.copyFile(path.join(root,'opus-1.6.1','COPYING'),path.join(root,'COPYING.opus'))
  await fs.writeFile(path.join(root,'build.json'),JSON.stringify(marker,null,2)+'\n',{flag:'wx',mode:0o600})
  console.log(JSON.stringify(marker))
}
