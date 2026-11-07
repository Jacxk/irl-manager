/** Deletion applies to existing stopped channels; ending must finish first. */
export function canDeleteChannel(channel: { desired: string; state: string }) {
  return channel.desired !== 'running' && channel.state !== 'ending';
}
