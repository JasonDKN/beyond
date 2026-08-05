import type { PhoneticScore } from '@/core/types';

/** Export formats. A transcription nobody can take away with them is half a tool. */
export type ExportFormat = 'txt' | 'srt' | 'vtt' | 'json' | 'csv';

export const EXPORT_LABELS: Readonly<Record<ExportFormat, string>> = {
  txt: 'Interlinear text (.txt)',
  srt: 'Subtitles with IPA (.srt)',
  vtt: 'WebVTT (.vtt)',
  json: 'Full score (.json)',
  csv: 'Word table (.csv)',
};

export function exportScore(score: PhoneticScore, format: ExportFormat): string {
  switch (format) {
    case 'txt':
      return toInterlinear(score);
    case 'srt':
      return toSrt(score);
    case 'vtt':
      return toVtt(score);
    case 'json':
      return JSON.stringify(score, null, 2);
    case 'csv':
      return toCsv(score);
  }
}

export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    case 'vtt':
      return 'text/vtt';
    default:
      return 'text/plain';
  }
}

/** Lyric line above, IPA line beneath — the layout every diction score uses. */
function toInterlinear(score: PhoneticScore): string {
  const header = [
    `${score.title}`,
    `Language: ${score.inputLanguage}   Notation: ${score.notation}`,
    `Transcribed by Beyond — ${score.meta.providerId} / ${score.meta.g2pEngineId}`,
    '',
  ];

  const body = score.lines.flatMap((line) => {
    // Pad each word and its IPA to the same width so the two rows align in a
    // monospaced editor — the whole point of an interlinear.
    const columns = line.words.map((word) => {
      const width = Math.max(word.text.length, word.ipa.length);
      return { top: word.text.padEnd(width), bottom: word.ipa.padEnd(width) };
    });
    const rows = [
      columns.map((column) => column.top).join('  '),
      columns.map((column) => column.bottom).join('  '),
    ];
    if (line.translation) rows.push(`↳ ${line.translation}`);
    rows.push('');
    return rows;
  });

  return [...header, ...body].join('\n');
}

function toSrt(score: PhoneticScore): string {
  return score.lines
    .map((line, index) => {
      const ipa = line.words.map((word) => word.ipa).join(' ');
      const text = line.translation ? `${line.text}\n${ipa}\n${line.translation}` : `${line.text}\n${ipa}`;
      return `${index + 1}\n${srtTime(line.startSec)} --> ${srtTime(line.endSec)}\n${text}\n`;
    })
    .join('\n');
}

function toVtt(score: PhoneticScore): string {
  const cues = score.lines
    .map((line) => {
      const ipa = line.words.map((word) => word.ipa).join(' ');
      return `${vttTime(line.startSec)} --> ${vttTime(line.endSec)}\n${line.text}\n${ipa}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${cues}`;
}

function toCsv(score: PhoneticScore): string {
  const rows = [['line', 'start', 'end', 'word', 'ipa', 'syllables', 'source', 'confidence']];
  score.lines.forEach((line, lineIndex) => {
    for (const word of line.words) {
      rows.push([
        String(lineIndex + 1),
        word.startSec.toFixed(3),
        word.endSec.toFixed(3),
        word.text,
        word.ipa,
        String(word.syllables.length),
        word.source,
        word.confidence.toFixed(2),
      ]);
    }
  });
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function srtTime(seconds: number): string {
  return formatTime(seconds, ',');
}

function vttTime(seconds: number): string {
  return formatTime(seconds, '.');
}

function formatTime(seconds: number, decimalMark: string): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total % 1) * 1000);
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${decimalMark}${pad(millis, 3)}`;
}

export function download(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoke on the next frame — revoking synchronously can race the download in
  // some browsers.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
