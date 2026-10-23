import { useEffect, useRef, useState } from 'react';
import { hz, midi, noteName } from './pitch';
import './PitchJourney.css';

type Point = { t: number; pitch: number | null };
type Saved = { id: number; name: string; url: string; blob: Blob; points: Point[]; duration: number };
const patterns: Record<string, number[]> = {
  'Major scale': [0,2,4,5,7,9,11,12], 'Natural minor': [0,2,3,5,7,8,10,12],
  'Major arpeggio': [0,4,7,12,7,4,0], 'Minor arpeggio': [0,3,7,12,7,3,0],
  'Twinkle Twinkle': [0,0,7,7,9,9,7,5,5,4,4,2,2,0],
  'Ode to Joy': [4,4,5,7,7,5,4,2,0,0,2,4,4,2,2],
};
function randomRun(root:number, count:number, maxJump:number) {
  const out=[root];
  for(let i=1;i<count;i++){
    const choices=Array.from({length:2*maxJump+1},(_,j)=>j-maxJump).filter(n=>n!==0);
    const delta=choices[Math.floor(Math.random()*choices.length)];
    out.push(Math.max(48,Math.min(84,out[i-1]+delta)));
  }
  return out;
}
function detectPitch(samples:Float32Array, rate:number):number|null {
  let rms=0; for(const s of samples)rms+=s*s;
  if(Math.sqrt(rms/samples.length)<0.018)return null;
  const min=Math.floor(rate/900),max=Math.min(Math.floor(rate/80),samples.length/2);
  let best=0,scoreBest=0;
  for(let lag=min;lag<=max;lag++){
    let a=0,b=0,c=0;
    for(let i=0;i<samples.length-lag;i+=3){const x=samples[i],y=samples[i+lag];a+=x*y;b+=x*x;c+=y*y;}
    const score=a/Math.sqrt(b*c+1e-9);
    if(score>scoreBest){scoreBest=score;best=lag;}
  }
  return scoreBest>.75?rate/best:null;
}
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export default function PitchJourney(){
  const [exercise,setExercise]=useState('Major scale');
  const [root,setRoot]=useState(60),[tempo,setTempo]=useState(80),[style,setStyle]=useState<'continuous'|'mastery'>('continuous');
  const [tolerance,setTolerance]=useState(25),[holdMs,setHoldMs]=useState(450),[jump,setJump]=useState(7);
  const [sequence,setSequence]=useState<number[]>(patterns['Major scale'].map(n=>60+n));
  const [running,setRunning]=useState(false),[step,setStep]=useState(0),[elapsed,setElapsed]=useState(0);
  const [pitch,setPitch]=useState<number|null>(null),[trace,setTrace]=useState<Point[]>([]),[passed,setPassed]=useState<number[]>([]),[missed,setMissed]=useState<number[]>([]);
  const [error,setError]=useState(''),[recording,setRecording]=useState(false),[sessions,setSessions]=useState<Saved[]>([]),[selected,setSelected]=useState<number|null>(null),[playTime,setPlayTime]=useState(0);
  const stream=useRef<MediaStream|null>(null),ctx=useRef<AudioContext|null>(null),raf=useRef<number>(0),analyser=useRef<AnalyserNode|null>(null);
  const started=useRef(0),lastSample=useRef(0),hold=useRef<number|null>(null),index=useRef(0),seen=useRef(new Set<number>()),prevPitch=useRef<number|null>(null);
  const seq=useRef(sequence),mode=useRef(style),bpm=useRef(tempo),tol=useRef(tolerance),duration=useRef(holdMs),run=useRef(false);
  const recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),recordStart=useRef(0),recordTrace=useRef<Point[]>([]);
  const player=useRef<HTMLAudioElement|null>(null);
  const viewport=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{seq.current=sequence;},[sequence]);
  useEffect(()=>{mode.current=style;bpm.current=tempo;tol.current=tolerance;duration.current=holdMs;},[style,tempo,tolerance,holdMs]);
  const build=(kind=exercise,key=root,interval=jump)=>kind==='Random runs'?randomRun(key,16,interval):(patterns[kind]||patterns['Major scale']).map(n=>key+n);
  const reset=(next:number[])=>{stop();setSequence(next);setStep(0);setElapsed(0);setTrace([]);setPassed([]);setMissed([]);index.current=0;seen.current.clear();hold.current=null;};
  const stop=()=>{run.current=false;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;ctx.current?.close();ctx.current=null;analyser.current=null;setRunning(false);setPitch(null);if(recorder.current?.state==='recording')recorder.current.stop();};
  useEffect(()=>()=>{run.current=false;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());ctx.current?.close();player.current?.pause();},[]);
  const finish=()=>{run.current=false;setRunning(false);cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;ctx.current?.close();ctx.current=null;if(recorder.current?.state==='recording')recorder.current.stop();};
  const start=async()=>{
    if(running)return;
    try{
      setError('');
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone requires HTTPS or localhost.');
      const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      const audio=new AudioContext();await audio.resume();
      const node=audio.createAnalyser();node.fftSize=4096;audio.createMediaStreamSource(s).connect(node);
      stream.current=s;ctx.current=audio;analyser.current=node;
      index.current=0;seen.current.clear();hold.current=null;prevPitch.current=null;
      setStep(0);setElapsed(0);setTrace([]);setPassed([]);setMissed([]);setPitch(null);
      started.current=performance.now();lastSample.current=0;run.current=true;setRunning(true);
      const data=new Float32Array(node.fftSize);
      const tick=(now:number)=>{
        if(!run.current)return;
        raf.current=requestAnimationFrame(tick);
        if(now-lastSample.current<65)return;
        lastSample.current=now;
        const seconds=(now-started.current)/1000;
        node.getFloatTimeDomainData(data);
        const f=detectPitch(data,audio.sampleRate);
        const raw=f?midi(f):null;
        const p=raw===null?null:prevPitch.current===null?raw:prevPitch.current*.3+raw*.7;
        prevPitch.current=p;setPitch(p);
        const noteLength=60/bpm.current;
        let current=index.current;
        if(mode.current==='continuous'){
          const desired=Math.min(seq.current.length,Math.floor(seconds/noteLength));
          while(current<desired){if(!seen.current.has(current))setMissed(v=>[...v,current]);current++;}
          index.current=current;
        }
        if(current>=seq.current.length){setElapsed(seconds);finish();return;}
        if(p!==null&&Math.abs((p-seq.current[current])*100)<=tol.current){
          if(hold.current===null)hold.current=now;
          if(now-hold.current>=duration.current&&!seen.current.has(current)){
            seen.current.add(current);setPassed(v=>[...v,current]);
            if(mode.current==='mastery'){index.current=current+1;hold.current=null;}
          }
        }else hold.current=null;
        setStep(index.current);setElapsed(seconds);
        setTrace(v=>[...v,{t:mode.current==='continuous'?seconds:index.current*noteLength,pitch:p}].slice(-1800));
        if(mode.current==='mastery'&&index.current>=seq.current.length)finish();
      };
      raf.current=requestAnimationFrame(tick);
    }catch(e){setError(e instanceof Error?e.message:String(e));stop();}
  };
  const record=()=>{
    if(recording){recorder.current?.stop();return;}
    if(!stream.current){setError('Start the exercise microphone before recording.');return;}
    if(typeof MediaRecorder==='undefined'){setError('Audio recording is not supported in this browser.');return;}
    try{
      const rec=new MediaRecorder(stream.current);recorder.current=rec;chunks.current=[];recordTrace.current=[];
      recordStart.current=performance.now();setRecording(true);
      rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data);};
      rec.onstop=()=>{
        setRecording(false);
        const blob=new Blob(chunks.current,{type:rec.mimeType||'audio/webm'});
        if(!blob.size)return;
        const session:Saved={id:Date.now(),name:`${exercise} · ${new Date().toLocaleString()}`,blob,url:URL.createObjectURL(blob),points:[...recordTrace.current],duration:(performance.now()-recordStart.current)/1000};
        setSessions(v=>[session,...v]);setSelected(session.id);
      };
      rec.start(250);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  useEffect(()=>{if(recording)recordTrace.current.push({t:(performance.now()-recordStart.current)/1000,pitch});},[pitch,recording]);
  const chosen=sessions.find(s=>s.id===selected);
  const graphPoints=chosen&&player.current&&!running?chosen.points:trace;
  const noteWidth=76,graphWidth=Math.max(900,sequence.length*noteWidth+100),height=320;
  const minNote=Math.min(...sequence)-3,maxNote=Math.max(...sequence)+3;
  const y=(n:number)=>height-35-(n-minNote)/(maxNote-minNote)*(height-65);
  const timePerNote=60/tempo;
  const cursorX=running?(style==='continuous'?elapsed/timePerNote*noteWidth:step*noteWidth):chosen?playTime/timePerNote*noteWidth:step*noteWidth;
  useEffect(()=>{if(viewport.current && running) viewport.current.scrollLeft=Math.max(0,30+cursorX-viewport.current.clientWidth*.35);},[cursorX,running]);
  const tracePath=graphPoints.filter(p=>p.pitch!==null).map((p,i)=>`${i?'L':'M'} ${30+p.t/timePerNote*noteWidth} ${y(p.pitch!)}`).join(' ');
  const playNote=()=>{const a=new AudioContext();const osc=a.createOscillator(),g=a.createGain();osc.frequency.value=hz(sequence[Math.min(step,sequence.length-1)]);g.gain.setValueAtTime(.13,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.55);osc.connect(g).connect(a.destination);osc.start();osc.stop(a.currentTime+.56);osc.onended=()=>a.close();};
  return <section className="journey">
    <div className="journey-heading"><div><div className="eyebrow">NEW PRACTICE STUDIO</div><h1>Pitch Journey</h1><p>Follow the notes, see your voice, and lock each pitch in tune.</p></div><span className="pill">BETA</span></div>
    <div className="journey-controls">
      <label>Exercise<select value={exercise} disabled={running} onChange={e=>{setExercise(e.target.value);reset(build(e.target.value));}}>{[...Object.keys(patterns),'Random runs'].map(k=><option key={k}>{k}</option>)}</select></label>
      <label>Starting note<select value={root} disabled={running} onChange={e=>{const v=+e.target.value;setRoot(v);reset(build(exercise,v));}}>{Array.from({length:37},(_,i)=>48+i).map(n=><option key={n} value={n}>{noteName(n)}</option>)}</select></label>
      <label>Progression<select value={style} disabled={running} onChange={e=>setStyle(e.target.value as 'continuous'|'mastery')}><option value="continuous">Continuous</option><option value="mastery">Mastery — wait for pitch</option></select></label>
      <label>Tempo · {tempo} BPM<input type="range" min="40" max="180" value={tempo} disabled={running} onChange={e=>setTempo(+e.target.value)}/></label>
      <label>Tolerance · ±{tolerance} cents<input type="range" min="10" max="50" step="5" value={tolerance} onChange={e=>setTolerance(+e.target.value)}/></label>
      <label>Hold · {holdMs} ms<input type="range" min="200" max="1000" step="50" value={holdMs} onChange={e=>setHoldMs(+e.target.value)}/></label>
      {exercise==='Random runs'&&<label>Max jump · {jump} semitones<input type="range" min="2" max="12" value={jump} disabled={running} onChange={e=>{const v=+e.target.value;setJump(v);reset(build(exercise,root,v));}}/></label>}
    </div>
    <div className="journey-stats"><span>Target: <strong>{step<sequence.length?noteName(sequence[step]):'Finished'}</strong></span><span>Voice: <strong>{pitch===null?'—':noteName(Math.round(pitch))}</strong></span><span>Locked: <strong>{passed.length}/{sequence.length}</strong></span><span>Missed: <strong>{missed.length}</strong></span></div>
    <div className="journey-viewport" ref={viewport}><svg viewBox={`0 0 ${graphWidth} ${height}`} width={graphWidth} height={height} role="img" aria-label="Target notes and live vocal pitch graph">
      {Array.from({length:maxNote-minNote+1},(_,i)=>minNote+i).map(n=><g key={n}><line x1="0" x2={graphWidth} y1={y(n)} y2={y(n)} stroke="#29374d" strokeDasharray="3 6"/><text x="4" y={y(n)-5} fill="#9cacc8" fontSize="11">{noteName(n)}</text></g>)}
      {sequence.map((n,i)=><g key={i}><line x1={30+i*noteWidth} x2={30+(i+1)*noteWidth-3} y1={y(n)} y2={y(n)} strokeWidth="9" strokeLinecap="round" stroke={passed.includes(i)?'#42dba0':missed.includes(i)?'#e97780':i===step?'#f3c86e':'#7793c4'}/><text x={30+i*noteWidth} y={y(n)-14} fontSize="12" fill="#e2e9f8">{noteName(n)}</text></g>)}
      <path d={tracePath} fill="none" stroke="#5ed5ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1={30+cursorX} x2={30+cursorX} y1="0" y2={height} stroke="#f3c86e" strokeDasharray="5 5" strokeWidth="2"/>
    </svg></div>
    <p className="journey-legend">🟦 Target notes · 🟩 Pitch locked · 🟥 Missed · Cyan line: your voice · Gold line: current position</p>
    <div className="journey-actions"><button className="primary" onClick={running?stop:start}>{running?'■ Stop exercise':'🎙 Start exercise'}</button><button className="secondary" onClick={playNote}>♫ Hear target</button><button className="secondary" disabled={!running&&!recording} onClick={record}>{recording?'■ Stop recording':'● Record voice'}</button><button className="secondary" onClick={()=>reset(build())}>↻ Reset</button></div>
    {error&&<p className="error">{error}</p>}
    <div className="journey-recordings"><h2>Recordings</h2><p>Record while practicing, then listen or export your take. Recordings are held in this tab until you leave or refresh; download anything you want to keep.</p>
      {sessions.length===0?<p>No recordings yet.</p>:sessions.map(s=><div className="journey-session" key={s.id}><button className="secondary" onClick={()=>{setSelected(s.id);setPlayTime(0);}}>View graph</button><span>{s.name}</span><audio controls src={s.url} onPlay={e=>{player.current=e.currentTarget;setSelected(s.id);}} onTimeUpdate={e=>{if(selected===s.id)setPlayTime(e.currentTarget.currentTime);}}/><a href={s.url} download={`singlab-${s.id}.${s.blob.type.includes('mp4')?'mp4':'webm'}`}>Download</a></div>)}
      {chosen&&<p className="hint">Selected recording: {chosen.name}. Its pitch trace appears above during playback when the exercise is stopped. Audio and pitch capture may differ slightly in timing.</p>}
    </div>
    <p className="hint">Use headphones to prevent the reference tone from entering your microphone. Continuous mode keeps moving; Mastery waits for each pitch. Songs are melody exercises, not backing tracks.</p>
  </section>;
}
