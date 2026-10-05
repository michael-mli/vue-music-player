// Private generator timestamp comparison. Sample the existing guarded context;
// do not advance, rebase or replace a stopped/reversed native render clock.
export function contextVideoOutputTimestamp(context,previous){
  const time=context?.currentTime
  if(context?.state!=='running'||!Number.isFinite(time)||time<0||
    previous!==-Infinity&&(!Number.isSafeInteger(previous)||previous<0))throw new Error('PLAYOUT_VIDEO_OUTPUT_CLOCK')
  const timestamp=Math.round(time*1000000)
  if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp<=previous)throw new Error('PLAYOUT_VIDEO_OUTPUT_CLOCK')
  return timestamp
}
