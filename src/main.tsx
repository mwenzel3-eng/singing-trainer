import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { hz, midi, noteName } from "./pitch";
import "./style.css";
const MODES: { [k: string]: number[] } = {
  "Single note": [0],
  "Major scale": [0, 2, 4, 5, 7, 9, 11, 12],
  "Natural minor": [0, 2, 3, 5, 7, 8, 10, 12],
  "Major arpeggio": [0, 4, 7, 12],
  "Minor arpeggio": [0, 3, 7, 12],
};
function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  let rms = 0;
  for (let i = 0; i < samples.length; i++) rms += samples[i] * samples[i];
  rms = Math.sqrt(rms / samples.length);
  if (rms < 0.015) return null;
  const minLag = Math.floor(sampleRate / 1000),
    maxLag = Math.min(
      Math.floor(sampleRate / 75),
      Math.floor(samples.length / 2),
    );
  let best = 0,
    bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0,
      aa = 0,
      bb = 0;
    for (let i = 0; i < samples.length - lag; i += 2) {
      const a = samples[i],
        b = samples[i + lag];
      sum += a * b;
      aa += a * a;
      bb += b * b;
    }
    const score = sum / Math.sqrt(aa * bb + 1e-10);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (bestScore < 0.7) return null;
  return sampleRate / best;
}
function App() {
  const [mode, setMode] = useState("Major scale"),
    [root, setRoot] = useState(60),
    [step, setStep] = useState(0),
    [freq, setFreq] = useState<number | null>(null),
    [listening, setListening] = useState(false),
    [error, setError] = useState(""),
    [score, setScore] = useState(0),
    [attempts, setAttempts] = useState(0);
  const audio = useRef<AudioContext | null>(null),
    stream = useRef<MediaStream | null>(null),
    frame = useRef<number | null>(null),
    last = useRef(0),
    smooth = useRef<number | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [locked, setLocked] = useState(false);
  const [completed, setCompleted] = useState(false);

  const holdStart = useRef<number | null>(null);
  const advanceTimer = useRef<number | null>(null);

  const HOLD_MS = 500;
  const TOLERANCE_CENTS = 20;
  const sequence = MODES[mode].map((i) => root + i),
    target = sequence[Math.min(step, sequence.length - 1)],
    cents = freq ? Math.round((midi(freq) - target) * 100) : null,
    near = cents !== null && Math.abs(cents) <= 20;
  useEffect(() => {
    if (!listening || completed || locked) {
      holdStart.current = null;
      return;
    }

    if (
      freq === null ||
      Math.abs((midi(freq) - target) * 100) > TOLERANCE_CENTS
    ) {
      holdStart.current = null;
      setHoldProgress(0);
      return;
    }

    const now = performance.now();

    if (holdStart.current === null) {
      holdStart.current = now;
    }

    const elapsed = now - holdStart.current;
    setHoldProgress(Math.min(100, (elapsed / HOLD_MS) * 100));

    if (elapsed >= HOLD_MS) {
      setLocked(true);
      setHoldProgress(100);
      setScore((s) => s + 1);
      setAttempts((a) => a + 1);

      advanceTimer.current = window.setTimeout(() => {
        if (step >= sequence.length - 1) {
          setCompleted(true);
        } else {
          setStep((s) => s + 1);
        }

        holdStart.current = null;
        setHoldProgress(0);
        setLocked(false);
      }, 350);
    }
  }, [freq, target, step, listening, locked, completed, sequence.length]);
  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audio.current?.close();
    audio.current = null;
    setListening(false);
    setFreq(null);
    smooth.current = null;
  };
  useEffect(() => () => stop(), []);
  const start = async () => {
    try {
      setError("");
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error(
          "Microphone requires HTTPS or localhost and a supported browser.",
        );
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const ctx = new AudioContext();
      await ctx.resume();
      stream.current = s;
      audio.current = ctx;
      const source = ctx.createMediaStreamSource(s),
        analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      setListening(true);
      const tick = (t: number) => {
        frame.current = requestAnimationFrame(tick);
        if (t - last.current < 85) return;
        last.current = t;
        analyser.getFloatTimeDomainData(data);
        const f = detectPitch(data, ctx.sampleRate);
        if (f) {
          smooth.current =
            smooth.current === null ? f : smooth.current * 0.5 + f * 0.5;
          setFreq(smooth.current);
        } else {
          smooth.current = null;
          setFreq(null);
        }
      };
      frame.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stop();
    }
  };
  const play = (m = target) => {
    const ctx = audio.current ?? new AudioContext();
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz(m);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.75);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
    if (!audio.current) osc.onended = () => ctx.close();
  };
  const next = () => {
    setAttempts((a) => a + 1);
    if (near) setScore((s) => s + 1);
    setStep((s) => (s + 1) % sequence.length);
  };
  return (
    <main>
      <header>
        <div className="brand">
          ♫ <span>SingLab</span>
        </div>
        <span className="pill">VERSION 1</span>
      </header>
      <section className="intro">
        <div className="eyebrow">YOUR PERSONAL VOCAL STUDIO</div>
        <h1>
          Find your voice.
          <br />
          <em>Master your pitch.</em>
        </h1>
        <p>Practice notes, scales and arpeggios with live pitch feedback.</p>
      </section>
      <section className="panel">
        <div className="settings">
          <label>
            Exercise
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setStep(0);
                setScore(0);
                setAttempts(0);
              }}
            >
              {Object.keys(MODES).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Starting note
            <select
              value={root}
              onChange={(e) => {
                setRoot(+e.target.value);
                setStep(0);
              }}
            >
              {Array.from({ length: 37 }, (_, i) => i + 48).map((n) => (
                <option value={n} key={n}>
                  {noteName(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="progress">
          {sequence.map((n, i) => (
            <button
              className={"note " + (i === step ? "active" : "")}
              key={i}
              onClick={() => setStep(i)}
            >
              {noteName(n)}
            </button>
          ))}
        </div>
        <div className="display">
          <div className="eyebrow">TARGET NOTE</div>
          <div className="big-note">{noteName(target)}</div>
          <div className="sub">{hz(target).toFixed(1)} Hz</div>
          <div className="meter">
            <div className="zone" />
            <div
              className="needle"
              style={{
                left: `${Math.max(0, Math.min(100, 50 + (cents ?? 0) / 2))}%`,
              }}
            />
          </div>
          <div className="axis">
            <span>♭ Flat</span>
            <span>In tune</span>
            <span>Sharp ♯</span>
          </div>
          <div className={"reading " + (near ? "good" : "")}>
            {freq
              ? `${noteName(Math.round(midi(freq)))} · ${freq.toFixed(1)} Hz · ${cents! > 0 ? "+" : ""}${cents} cents`
              : "Sing a note to see your pitch"}
          </div>
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                height: 12,
                background: "#303851",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${holdProgress}%`,
                  background: "#52dcaa",
                  transition: "width 80ms linear",
                }}
              />
            </div>

            <p className={locked ? "reading good" : "hint"}>
              {completed
                ? "Exercise complete!"
                : locked
                  ? "✓ Pitch locked!"
                  : "Hold the correct pitch to advance"}
            </p>
          </div>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => play()}>
            ♫ Play note
          </button>
          <button className="primary" onClick={listening ? stop : start}>
            {listening ? "■ Stop microphone" : "🎙 Start singing"}
          </button>
          <button className="secondary" onClick={next}>
            Next →
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="hint">
          For best results, wear headphones so the microphone hears your voice
          rather than the reference tone.
        </p>
      </section>
      <section className="stats">
        <div>
          <strong>
            {score}/{attempts}
          </strong>
          <span>Steps within ±20 cents</span>
        </div>
        <div>
          <strong>{listening ? "Live" : "Ready"}</strong>
          <span>Microphone status</span>
        </div>
      </section>
      <footer>
        All pitch processing stays on your device. For iPhone Safari, open over
        HTTPS and allow microphone access.
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
