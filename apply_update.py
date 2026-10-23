from pathlib import Path
import shutil
root=Path(__file__).resolve().parent
project=Path.cwd()
main=project/'src'/'main.tsx'
if not main.exists():
    raise SystemExit('Run this script from the singing-trainer repository root (where package.json is).')
s=main.read_text()
if 'PitchJourney' not in s:
    s='import PitchJourney from "./PitchJourney";\n'+s
    s=s.replace('function App() {','function App() {\n  const [page, setPage] = useState<"classic" | "journey">("classic");')
    s=s.replace('  return (\n    <main>', '''  return (\n    <main>\n      <nav className="singlab-nav" style={{display:"flex",gap:12,marginBottom:20}}>\n        <button className={page === "classic" ? "primary" : "secondary"} style={{padding:12,borderRadius:10}} onClick={() => setPage("classic")}>Classic Practice</button>\n        <button className={page === "journey" ? "primary" : "secondary"} style={{padding:12,borderRadius:10}} onClick={() => { if (listening) stop(); setPage("journey"); }}>Pitch Journey</button>\n      </nav>\n      {page === "journey" ? <PitchJourney /> : <>''',1)
    s=s.replace('    </main>\n  );','      </>}\n    </main>\n  );',1)
    main.write_text(s)
    print('Updated navigation in src/main.tsx')
else:print('Navigation already installed; skipping.')
for name in ['PitchJourney.tsx','PitchJourney.css']:
    shutil.copy2(root/'src'/name,project/'src'/name)
    print('Installed src/'+name)
