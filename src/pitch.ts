const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

export const noteName = (midiNote: number) =>
  NOTE_NAMES[((midiNote % 12) + 12) % 12] +
  (Math.floor(midiNote / 12) - 1);

export const hz = (midiNote: number) =>
  440 * Math.pow(2, (midiNote - 69) / 12);

export const midi = (frequency: number) =>
  69 + 12 * Math.log2(frequency / 440);
