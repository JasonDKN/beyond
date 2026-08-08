/**
 * Lining a take up with the song underneath it.
 *
 * Small enough to state precisely, and worth stating precisely because the
 * sign is easy to get backwards and the symptom — "my voice sounds late" —
 * looks identical whichever way you err.
 *
 * While recording, at the moment the song is at position `E`, that audio has
 * already taken `L` seconds to leave the headphones, be sung, and get back in
 * through the microphone. So the voice aimed at song position `E` is captured
 * at take-local time:
 *
 *     τ = (E − S) + L          where S is the song position recording began at
 *
 * Playing back, we want the reverse: at song position `P`, play the take from
 * whichever τ was aimed there.
 *
 *     τ = (P − S) + L
 *
 * So the take is *advanced* — the first `L` seconds of it are skipped, because
 * that stretch was recorded before the singer had heard anything to respond
 * to. Erring the other way delays an already-delayed recording, which is
 * exactly the complaint this maths exists to prevent.
 */
export function takeStartOffset(options: {
  /** Where the song actually is, right now. */
  readonly trackPositionSec: number;
  /** Where the song was when recording began. */
  readonly recordedAtSec: number;
  /** Round-trip audio latency, as measured by the scorer. Positive. */
  readonly latencySec: number;
  /** Manual trim, in seconds. Positive pushes the voice later. */
  readonly trimSec?: number;
  /** Length of the take, so the offset cannot run past the end. */
  readonly takeDurationSec: number;
}): number {
  const { trackPositionSec, recordedAtSec, latencySec, takeDurationSec } = options;
  const trim = options.trimSec ?? 0;

  // A positive trim should make the voice arrive *later*, which means starting
  // from *earlier* in the take — hence the subtraction.
  const raw = trackPositionSec - recordedAtSec + latencySec - trim;

  // Never past the end, and never negative: a negative offset would mean the
  // take should start before the song reaches this point, which playback
  // cannot express by seeking.
  return Math.max(0, Math.min(raw, Math.max(0, takeDurationSec - 0.01)));
}
