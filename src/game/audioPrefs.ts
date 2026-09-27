// Sound settings shared by every game session: 0 = music and effects, 1 = effects only,
// 2 = muted. Applied as bus volumes on the platform's audio output.
import type { AudioOutput } from '../platform/platform';

export const MUSIC_VOLUME = 0.55;
export const audioPrefs = { mode: 0 as 0 | 1 | 2 };

export function applyAudioPrefs(audio: AudioOutput) {
  audio.setBusVolume('sfx', audioPrefs.mode === 2 ? 0 : 1);
  audio.setBusVolume('music', audioPrefs.mode === 0 ? MUSIC_VOLUME : 0);
}
export function setAudioMode(audio: AudioOutput, mode: 0 | 1 | 2): string {
  audioPrefs.mode = mode;
  applyAudioPrefs(audio);
  return mode === 0 ? 'Music and sound on' : mode === 1 ? 'Music off (N) · sound on' : 'All sound off (M)';
}
export const audioLabel = () => (audioPrefs.mode === 0 ? '♪' : audioPrefs.mode === 1 ? '♪ off' : 'Muted');
