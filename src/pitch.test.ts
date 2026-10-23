import { describe, expect, it } from "vitest";
import { hz, midi, noteName } from "./pitch";

describe("pitch helpers", () => {
  it("converts concert A between MIDI and frequency", () => {
    expect(hz(69)).toBe(440);
    expect(midi(440)).toBe(69);
  });

  it("renders MIDI note names with their octaves", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C♯4");
    expect(noteName(69)).toBe("A4");
  });
});
