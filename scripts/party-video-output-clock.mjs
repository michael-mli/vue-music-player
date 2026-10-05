// Private generator timestamp comparison. Sample the existing guarded context;
// do not advance, rebase or replace a stopped/reversed native render clock.
export function contextVideoOutputTimestamp(context,previous){
  const fail=reason=>{const error=new Error('PLAYOUT_VIDEO_OUTPUT_CLOCK');error.reason=reason;throw error}
  const time=context?.currentTime
  if(context?.state!=='running')fail('CONTEXT_NOT_RUNNING')
  if(!Number.isFinite(time)||time<0||
    previous!==-Infinity&&(!Number.isSafeInteger(previous)||previous<0))fail('INVALID_CLOCK')
  const timestamp=Math.round(time*1000000)
  if(!Number.isSafeInteger(timestamp)||timestamp<0)fail('INVALID_CLOCK')
  if(timestamp===previous)fail('UNCHANGED_CLOCK')
  if(timestamp<previous)fail('REVERSED_CLOCK')
  return timestamp
}
