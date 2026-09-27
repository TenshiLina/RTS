// Sound settings shared by every game session, applied as bus volumes on the platform's audio
// output: the chosen music track (or none), and a master mute.
import type { AudioOutput } from '../platform/platform';
import { TRACK_NAMES } from '../audio/music';

export const MUSIC_VOLUME = 0.55;
export const audioPrefs = {
  /** index into TRACK_NAMES, or -1 for no music */
  track: 0,
  muted: false,
};

export function applyAudioPrefs(audio: AudioOutput) {
  audio.setBusVolume('sfx', audioPrefs.muted ? 0 : 1);
  audio.setBusVolume('music', audioPrefs.muted || audioPrefs.track < 0 ? 0 : MUSIC_VOLUME);
}
/** N / the ♪ button: next track, then music off, then the first track again */
export function nextTrack(audio: AudioOutput): string {
  audioPrefs.track = audioPrefs.track + 1 >= TRACK_NAMES.length ? -1 : audioPrefs.track + 1;
  audioPrefs.muted = false;
  applyAudioPrefs(audio);
  return audioPrefs.track < 0 ? 'Music off (N for music)' : `♪ ${TRACK_NAMES[audioPrefs.track]}  (${audioPrefs.track + 1}/${TRACK_NAMES.length} · N for the next)`;
}
/** M: all sound off / on */
export function toggleMute(audio: AudioOutput): string {
  audioPrefs.muted = !audioPrefs.muted;
  applyAudioPrefs(audio);
  return audioPrefs.muted ? 'All sound off (M)' : 'Sound on (M)';
}
export const musicLabel = () => (audioPrefs.muted ? 'Sound off' : audioPrefs.track < 0 ? 'Music off' : TRACK_NAMES[audioPrefs.track]);
