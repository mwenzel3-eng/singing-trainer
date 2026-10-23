# SingLab v1

A shared React + TypeScript pitch-training prototype for mobile and desktop browsers.

## Run locally

Install Node.js 20+ and then:

```bash
npm install
npm run dev
```

Open the URL printed by Vite (normally http://localhost:5173). Click **Start singing** and allow microphone access.

## Build

```bash
npm run build
```

Deploy the generated `dist/` folder to an HTTPS host such as Netlify or Vercel for testing on an iPhone. Microphone access requires a secure origin (HTTPS or localhost).

## Planned iPhone packaging

Add Capacitor when ready: `npm install @capacitor/core @capacitor/ios && npm install -D @capacitor/cli`, then initialize it with `npx cap init` (web directory `dist`), run `npm run build`, `npx cap add ios`, `npx cap sync ios`, and open the native iOS project in Xcode on a Mac. Test microphone permissions and audio latency on-device.

## Known v1 limitations

Pitch detection uses normalized autocorrelation and is best for a single clear sung note in a quiet environment. It may produce octave errors or instability on breathy or noisy sounds. The score counts the pitch only at the instant **Next** is pressed; it is not sustained-note scoring. No account or progress persistence is included. Audio stays local in the browser.
