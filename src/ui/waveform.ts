import type { ViewMode } from '@/core/store';

/**
 * Whether the waveform is folded away, remembered per view.
 *
 * The waveform earns its space in Beatmap, where you are aiming at a vocal you
 * can see coming. In Learning it competes with the thing you came for: on a
 * short window it takes the height that would otherwise show the next two
 * lines, and reading along does not need it. So this is a preference rather
 * than a layout — and per view, because the honest answer differs between
 * them and nobody wants to set it twice on every song.
 *
 * The parts of the song stay visible either way. Folding the waveform is about
 * removing a picture you are not using, not about giving up the ability to
 * jump to the chorus.
 */

const KEY = 'beyond.waveform-hidden';
const MODES: readonly ViewMode[] = ['setup', 'beatmap', 'learning', 'practice'];

export function loadHiddenWaveforms(): ViewMode[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    // Filtered against the real modes rather than trusted: a stored value from
    // an older version can name a view that no longer exists.
    return raw.split(',').filter((entry): entry is ViewMode => MODES.includes(entry as ViewMode));
  } catch {
    return [];
  }
}

export function saveHiddenWaveforms(modes: readonly ViewMode[]): void {
  try {
    localStorage.setItem(KEY, modes.join(','));
  } catch {
    // Losing the preference is a small thing; failing to fold it is not.
  }
}

/** The set with one view flipped, which is all the toggle ever needs. */
export function toggleWaveform(modes: readonly ViewMode[], mode: ViewMode): ViewMode[] {
  return modes.includes(mode) ? modes.filter((entry) => entry !== mode) : [...modes, mode];
}
