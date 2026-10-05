// Private VP8 transport comparison. Preserve the clear codec header and append
// actual sender reference declarations. Receivers must strip the trailer before
// native decoding. This module creates no transport, output or authorization.
export function createVideoReferenceEnvelope(){
  const maximumFrameBytes=256*1024,magic=0x4b545652,version=1
  let closed=false,error=null,wrapped=0,unwrapped=0,maximumBytes=0,maximumTrailerBytes=0,lastWrappedId=-1
  const fail=code=>{closed=true;error=code;throw new Error(code)}
  const validId=id=>Number.isSafeInteger(id)&&id>=0
  function payload(frame){
    if(closed)throw new Error(error||'VIDEO_ENVELOPE_CLOSED')
    let data;try{data=frame?.data}catch{fail('VIDEO_ENVELOPE_INPUT')}
    if(!(data instanceof ArrayBuffer)||data.byteLength<3||data.byteLength>maximumFrameBytes||
      typeof data.transferToFixedLength!=='function'||!['key','delta'].includes(frame.type))fail('VIDEO_ENVELOPE_INPUT')
    return data
  }
  function codec(bytes,type){
    if((bytes[0]&1)!==(type==='key'?0:1))fail('VIDEO_ENVELOPE_CODEC')
    if(type==='key'&&(bytes.length<10||bytes[3]!==0x9d||bytes[4]!==1||bytes[5]!==0x2a||
      bytes[7]&0xc0||bytes[9]&0xc0||
      ((bytes[6]|bytes[7]<<8)&0x3fff)!==1280||((bytes[8]|bytes[9]<<8)&0x3fff)!==720))fail('VIDEO_ENVELOPE_CODEC')
  }
  function checksum(bytes,skipAt){
    let crc=0xffffffff
    for(let i=0;i<bytes.length;i++){
      if(i>=skipAt&&i<skipAt+4)continue
      crc^=bytes[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)
    }
    return (crc^0xffffffff)>>>0
  }
  function references(frameId,dependencies,type){
    return validId(frameId)&&Array.isArray(dependencies)&&dependencies.length<=8&&
      new Set(dependencies).size===dependencies.length&&dependencies.every(id=>validId(id)&&id<frameId)&&
      (type==='key'?dependencies.length===0:dependencies.length>0)
  }
  return {close(){closed=true},snapshot:()=>({closed,error,wrapped,unwrapped,maximumBytes,maximumTrailerBytes,
    maximumFrameBytes,maximumDependencies:8}),
    wrap(frame,metadata){
      const data=payload(frame),bytes=new Uint8Array(data),length=data.byteLength
      codec(bytes,frame.type)
      if(!references(metadata?.frameId,metadata?.dependencies,frame.type)||metadata.frameId<=lastWrappedId)fail('VIDEO_ENVELOPE_REFERENCE')
      const dependencies=metadata.dependencies.slice(),trailerBytes=30+dependencies.length*8,total=length+trailerBytes
      if(total>maximumFrameBytes)fail('VIDEO_ENVELOPE_BOUND')
      const frameId=metadata.frameId
      // The former buffer is detached before its replacement becomes reachable;
      // no second complete payload remains live in this primitive.
      let output;try{output=data.transferToFixedLength(total)}catch{fail('VIDEO_ENVELOPE_TRANSFER')}
      const view=new DataView(output),at=length
      view.setUint32(at,magic);view.setUint8(at+4,version);view.setUint8(at+5,frame.type==='key'?0:1)
      view.setUint8(at+6,dependencies.length);view.setUint8(at+7,0);view.setUint32(at+8,length)
      view.setFloat64(at+12,frameId)
      for(let i=0;i<dependencies.length;i++)view.setFloat64(at+24+i*8,dependencies[i])
      view.setUint32(at+20,checksum(new Uint8Array(output,0,total-6),at+20))
      view.setUint16(total-6,trailerBytes);view.setUint32(total-4,magic)
      try{frame.data=output}catch{fail('VIDEO_ENVELOPE_TRANSFER')}
      lastWrappedId=frameId;wrapped++;maximumBytes=Math.max(maximumBytes,total)
      maximumTrailerBytes=Math.max(maximumTrailerBytes,trailerBytes)
      return {trailerBytes}
    },
    unwrap(frame){
      const data=payload(frame),total=data.byteLength
      if(total<33)fail('VIDEO_ENVELOPE_FORMAT')
      const view=new DataView(data),trailerBytes=view.getUint16(total-6),at=total-trailerBytes
      if(view.getUint32(total-4)!==magic||trailerBytes<30||trailerBytes>94||at<3||
        view.getUint32(at)!==magic||view.getUint8(at+4)!==version||view.getUint8(at+7)!==0||
        view.getUint32(at+8)!==at||view.getUint8(at+5)!==(frame.type==='key'?0:1))fail('VIDEO_ENVELOPE_FORMAT')
      const count=view.getUint8(at+6)
      if(count>8||trailerBytes!==30+count*8)fail('VIDEO_ENVELOPE_FORMAT')
      const frameId=view.getFloat64(at+12),dependencies=Array.from({length:count},(_,i)=>view.getFloat64(at+24+i*8))
      if(!references(frameId,dependencies,frame.type))fail('VIDEO_ENVELOPE_REFERENCE')
      const bytes=new Uint8Array(data,0,at);codec(bytes,frame.type)
      if(checksum(new Uint8Array(data,0,total-6),at+20)!==view.getUint32(at+20))fail('VIDEO_ENVELOPE_INTEGRITY')
      try{frame.data=data.transferToFixedLength(at)}catch{fail('VIDEO_ENVELOPE_TRANSFER')}
      unwrapped++;maximumBytes=Math.max(maximumBytes,total)
      maximumTrailerBytes=Math.max(maximumTrailerBytes,trailerBytes)
      return {frameId,dependencies,sourceReferences:true}
    }}
}
