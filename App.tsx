
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { ActionType, ACLSEvent, ArrestState } from './types';
import Metronome from './components/Metronome';
import { analyzeArrest } from './services/geminiService';

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [arrest, setArrest] = useState<ArrestState>({
    isActive: false,
    startTime: null,
    events: []
  });

  const [elapsedTime, setElapsedTime] = useState(0);
  const [cycleTime, setCycleTime] = useState(0);
  const [cycleStartTime, setCycleStartTime] = useState<number>(0);
  const [lastEpiTime, setLastEpiTime] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [etco2Input, setEtco2Input] = useState('');
  const [showRhythmPopover, setShowRhythmPopover] = useState(false);
  const [showAmioPopover, setShowAmioPopover] = useState(false);
  const [showDrugPopover, setShowDrugPopover] = useState(false);
  const [isWaitingForRhythm, setIsWaitingForRhythm] = useState(false);
  const [roscFlashing, setRoscFlashing] = useState(false);
  const [isShockAdvised, setIsShockAdvised] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showRoscSummary, setShowRoscSummary] = useState(false);
  
  const popoverRef = useRef<HTMLDivElement>(null);
  const amioPopoverRef = useRef<HTMLDivElement>(null);
  const drugPopoverRef = useRef<HTMLDivElement>(null);

  // Check if ROSC has been achieved in the current session
  const hasRosc = useMemo(() => arrest.events.some(e => e.type === ActionType.ROSC), [arrest.events]);

  useEffect(() => {
    let interval: number;
    if (arrest.isActive && arrest.startTime) {
      interval = window.setInterval(() => {
        const now = Date.now();
        const currentTotalElapsed = now - (arrest.startTime || now);
        setElapsedTime(currentTotalElapsed);
        
        // Only progress cycle time if not in ROSC
        if (!hasRosc) {
          const currentCycleElapsed = currentTotalElapsed - cycleStartTime;
          setCycleTime(currentCycleElapsed);

          if (currentCycleElapsed >= 120000) {
            setShowRhythmPopover(true);
            setShowAmioPopover(false); 
            setShowDrugPopover(false);
            setIsWaitingForRhythm(true); // Mute metronome at end of cycle
            setCycleStartTime(prev => prev + 120000);
            if (window.navigator.vibrate) window.navigator.vibrate([200, 100, 200]);
          }
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [arrest.isActive, arrest.startTime, cycleStartTime, hasRosc]);

  const logEvent = useCallback((type: ActionType | string, details?: string) => {
    const now = Date.now();
    const timestamp = arrest.startTime ? now - arrest.startTime : 0;
    const wallTime = new Date(now).toLocaleTimeString([], { hour12: false });
    const newEvent: ACLSEvent = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp,
      wallTime,
      type,
      details
    };
    setArrest(prev => ({ ...prev, events: [newEvent, ...prev.events] }));
    
    if (type === ActionType.EPINEPHRINE) setLastEpiTime(timestamp);
    
    if (type === ActionType.RHYTHM_CHECK) {
      setCycleStartTime(timestamp);
      
      const shockable = details === 'VF' || details === 'pVT';
      if (shockable) {
        setIsShockAdvised(true);
      } else {
        setIsShockAdvised(false);
        setIsWaitingForRhythm(false);
      }
    }
    
    if (type === ActionType.SHOCK) {
      setIsShockAdvised(false);
      setIsWaitingForRhythm(false);
    }

    if (window.navigator.vibrate) window.navigator.vibrate(50);
  }, [arrest.startTime]);

  const deleteEvent = useCallback((id: string) => {
    setArrest(prev => {
      const updatedEvents = prev.events.filter(e => e.id !== id);
      // Recalculate last epinephrine time if the deleted event was epinephrine
      const epiEvents = updatedEvents.filter(e => e.type === ActionType.EPINEPHRINE);
      const newLastEpi = epiEvents.length > 0 ? epiEvents[0].timestamp : null;
      setLastEpiTime(newLastEpi);
      
      return { ...prev, events: updatedEvents };
    });
    if (window.navigator.vibrate) window.navigator.vibrate(20);
  }, []);

  const handleROSC = () => {
    if (!arrest.isActive || hasRosc) return;
    setRoscFlashing(true);
    logEvent(ActionType.ROSC);
    setShowRoscSummary(true);
    setTimeout(() => setRoscFlashing(false), 300);
  };

  const startArrest = () => {
    const startTime = Date.now();
    setArrest({
      isActive: true,
      startTime,
      events: [{
        id: 'start',
        timestamp: 0,
        wallTime: new Date(startTime).toLocaleTimeString([], { hour12: false }),
        type: 'Arrest Initiation'
      }]
    });
    setElapsedTime(0);
    setCycleTime(0);
    setCycleStartTime(0);
    setLastEpiTime(null);
    setIsWaitingForRhythm(false);
    setIsShockAdvised(false);
    setShowRoscSummary(false);
  };

  const endCase = () => {
    setArrest(p => ({...p, isActive: false}));
    setShowRhythmPopover(false);
    setShowAmioPopover(false);
    setShowDrugPopover(false);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const epiDue = lastEpiTime !== null && (elapsedTime - lastEpiTime) >= 180000;
  const cycleDue = !hasRosc && cycleTime >= 110000;

  const roscStats = useMemo(() => {
    const events = arrest.events;
    return {
      cycles: events.filter(e => e.type === ActionType.RHYTHM_CHECK).length,
      shocks: events.filter(e => e.type === ActionType.SHOCK).length,
      drugs: {
        epi: events.filter(e => e.type === ActionType.EPINEPHRINE).length,
        amio: events.filter(e => e.type === ActionType.AMIODARONE_300 || e.type === ActionType.AMIODARONE_150).length,
        lido: events.filter(e => e.type === ActionType.LIDOCAINE).length,
        nahco3: events.filter(e => e.type === ActionType.NAHCO3).length,
        calcium: events.filter(e => e.type === ActionType.CALCIUM).length,
        ri: events.filter(e => e.type === ActionType.RI_GLUCOSE).length,
      }
    };
  }, [arrest.events]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto shadow-none sm:shadow-2xl border-x border-slate-200">
      {/* Title Bar */}
      <div className="bg-slate-900 text-white px-4 py-1.5 shadow-md no-print border-b border-slate-700">
        <p className="text-[11px] font-black uppercase tracking-widest text-center opacity-80">
          ER • ศูนย์การแพทย์กาญจนาภิเษก
        </p>
      </div>

      <header className="px-4 py-3 bg-white border-b-2 border-slate-900 sticky top-0 z-50 shadow-sm no-print">
        <div className="flex justify-between items-center mb-3">
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-1.5 leading-none">
              <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[8px]">ACLS</span>
              SCRIBE
            </h1>
            {arrest.isActive ? (
              <span className="text-3xl font-mono font-black text-red-600 leading-none mt-1.5 tracking-tighter">
                {formatTime(elapsedTime)}
              </span>
            ) : (
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Standby</span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {!arrest.isActive ? (
              <button onClick={startArrest} className="bg-red-600 text-white px-6 py-4 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all">
                Start Code
              </button>
            ) : (
              <>
                <button 
                  onClick={() => setIsMuted(!isMuted)} 
                  className={`p-3 rounded-xl border transition-all ${isMuted ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                >
                  <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'} text-sm`}></i>
                </button>
                <button onClick={endCase} className="bg-slate-100 text-red-600 px-4 py-3 rounded-xl font-black uppercase text-[10px] active:scale-95 border border-slate-200">
                  End Case
                </button>
              </>
            )}
          </div>
        </div>

        {arrest.isActive && (
          <div className="grid grid-cols-3 gap-2 items-stretch">
            <div className={`flex flex-col justify-center p-2 rounded-lg border-2 transition-all ${cycleDue ? 'bg-amber-50 border-amber-500' : 'bg-slate-50 border-slate-100'}`}>
              <p className="text-[9px] font-black text-slate-400 uppercase text-center leading-none mb-1">Cycle</p>
              <p className={`text-sm font-mono font-bold text-center leading-none ${cycleDue ? 'text-amber-600 animate-pulse' : 'text-slate-900'}`}>{formatTime(cycleTime)}</p>
            </div>
            <div className={`flex flex-col justify-center p-2 rounded-lg border-2 transition-all ${epiDue ? 'bg-green-50 border-green-500' : 'bg-slate-50 border-slate-100'}`}>
              <p className="text-[9px] font-black text-slate-400 uppercase text-center leading-none mb-1">Epi Due</p>
              <p className={`text-sm font-mono font-bold text-center leading-none ${epiDue ? 'text-green-600 animate-pulse' : 'text-slate-900'}`}>
                {lastEpiTime !== null ? formatTime(Math.max(0, 180000 - (elapsedTime - lastEpiTime))) : '--:--'}
              </p>
            </div>
            <div className="h-full">
              <Metronome 
                isActive={arrest.isActive && !hasRosc} 
                isWarning={!hasRosc && cycleTime >= 110000} 
                forceMute={isWaitingForRhythm} 
                isMuted={isMuted}
                onToggleMute={() => setIsMuted(!isMuted)}
              />
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 p-4 pb-24 overflow-y-auto space-y-4 custom-scrollbar">
        <div className="grid grid-cols-2 gap-3">
          <div className="relative" ref={popoverRef}>
            <InterventionButton label="Rhythm Check" icon="bolt-lightning" color="amber" onClick={() => { setShowRhythmPopover(!showRhythmPopover); if (!showRhythmPopover) { setShowAmioPopover(false); setShowDrugPopover(false); } }} disabled={!arrest.isActive} urgent={cycleDue} />
            {showRhythmPopover && (
              <div className="absolute top-full left-0 mt-2 z-[60] w-64 bg-white border-2 border-slate-300 rounded-3xl shadow-2xl p-4 animate-in fade-in zoom-in duration-150 ring-8 ring-red-500/10">
                <p className="text-[12px] font-black text-red-600 uppercase mb-4 text-center tracking-widest leading-none">Select Rhythm</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => { logEvent(ActionType.RHYTHM_CHECK, 'VF'); setShowRhythmPopover(false); }} className="bg-red-600 text-white text-[11px] font-black py-4 rounded-2xl shadow-md active:scale-95">VF</button>
                  <button onClick={() => { logEvent(ActionType.RHYTHM_CHECK, 'pVT'); setShowRhythmPopover(false); }} className="bg-red-600 text-white text-[11px] font-black py-4 rounded-2xl shadow-md active:scale-95">pVT</button>
                  <button onClick={() => { logEvent(ActionType.RHYTHM_CHECK, 'PEA'); setShowRhythmPopover(false); }} className="bg-slate-800 text-white text-[11px] font-black py-4 rounded-2xl shadow-md active:scale-95">PEA</button>
                  <button onClick={() => { logEvent(ActionType.RHYTHM_CHECK, 'Asystole'); setShowRhythmPopover(false); }} className="bg-slate-800 text-white text-[11px] font-black py-4 rounded-2xl shadow-md active:scale-95">ASY</button>
                </div>
              </div>
            )}
          </div>
          
          <InterventionButton label="Shock 200 J" icon="bolt" color="red" onClick={() => logEvent(ActionType.SHOCK)} disabled={!arrest.isActive} shockAlert={isShockAdvised} />
          
          <InterventionButton label="Epinephrine" icon="syringe" color="emerald" onClick={() => logEvent(ActionType.EPINEPHRINE)} disabled={!arrest.isActive} urgent={epiDue} />
          
          <div className="relative" ref={amioPopoverRef}>
            <InterventionButton label="Amiodarone" icon="capsules" color="purple" onClick={() => { setShowAmioPopover(!showAmioPopover); if (!showAmioPopover) { setShowRhythmPopover(false); setShowDrugPopover(false); } }} disabled={!arrest.isActive} />
            {showAmioPopover && (
              <div className="absolute top-full right-0 mt-2 z-[60] w-60 bg-white border-2 border-slate-300 rounded-3xl shadow-2xl p-4 animate-in fade-in zoom-in duration-150 ring-8 ring-purple-500/10">
                <p className="text-[12px] font-black text-purple-600 uppercase mb-4 text-center tracking-widest leading-none">Select Dose</p>
                <div className="grid grid-cols-1 gap-3">
                  <button onClick={() => { logEvent(ActionType.AMIODARONE_300); setShowAmioPopover(false); }} className="bg-purple-600 text-white text-[11px] font-black py-4 rounded-2xl shadow-md active:scale-95">300 mg (1st)</button>
                  <button onClick={() => { logEvent(ActionType.AMIODARONE_150); setShowAmioPopover(false); }} className="bg-purple-600 text-white text-[11px] font-black py-4 rounded-2xl shadow-md active:scale-95">150 mg (2nd)</button>
                </div>
              </div>
            )}
          </div>
          
          <InterventionButton label="Lidocaine" icon="vial" color="cyan" onClick={() => logEvent(ActionType.LIDOCAINE)} disabled={!arrest.isActive} />
          
          <InterventionButton label="Airway" icon="lungs" color="slate" onClick={() => logEvent(ActionType.INTUBATION)} disabled={!arrest.isActive} />
          
          <InterventionButton label="IV / IO Access" icon="faucet-drip" color="blue" onClick={() => logEvent(ActionType.IV_IO)} disabled={!arrest.isActive} />

          <div className="relative" ref={drugPopoverRef}>
            <InterventionButton label="Other Drugs" icon="prescription-bottle-medical" color="zinc" onClick={() => { setShowDrugPopover(!showDrugPopover); if (!showDrugPopover) { setShowRhythmPopover(false); setShowAmioPopover(false); } }} disabled={!arrest.isActive} />
            {showDrugPopover && (
              <div className="absolute top-0 right-full mr-2 z-[60] w-36 bg-white border-2 border-slate-300 rounded-3xl shadow-2xl p-3 animate-in fade-in slide-in-from-right duration-150 ring-8 ring-zinc-500/10">
                <p className="text-[9px] font-black text-zinc-600 uppercase mb-2 text-center tracking-widest leading-none">Drugs</p>
                <div className="grid grid-cols-1 gap-2">
                  <button onClick={() => { logEvent(ActionType.NAHCO3); setShowDrugPopover(false); }} className="bg-zinc-600 text-white text-[10px] font-black py-2.5 rounded-xl shadow-sm active:scale-95">NaHCO3</button>
                  <button onClick={() => { logEvent(ActionType.CALCIUM); setShowDrugPopover(false); }} className="bg-orange-500 text-white text-[10px] font-black py-2.5 rounded-xl shadow-sm active:scale-95">Calcium</button>
                  <button onClick={() => { logEvent(ActionType.RI_GLUCOSE); setShowDrugPopover(false); }} className="bg-pink-500 text-white text-[10px] font-black py-2.5 rounded-xl shadow-sm active:scale-95">RI+Glucose</button>
                </div>
              </div>
            )}
          </div>

          <div className="col-span-2 bg-white p-3 rounded-2xl border border-slate-200 flex gap-2 items-center shadow-sm">
            <input type="number" placeholder="EtCO2 mmHg" value={etco2Input} onChange={e => setEtco2Input(e.target.value)} disabled={!arrest.isActive} className="flex-1 bg-slate-50 border-none rounded-lg px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
            <button onClick={() => { logEvent(ActionType.ETCO2, `${etco2Input} mmHg`); setEtco2Input(''); }} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-black uppercase text-[10px] active:scale-95">Log</button>
          </div>
        </div>

        <button 
          onClick={handleROSC}
          disabled={!arrest.isActive || hasRosc}
          className={`w-full py-6 rounded-2xl flex items-center justify-center gap-4 shadow-lg transition-all active:scale-[0.98] border-b-4 border-red-800 disabled:opacity-20 ${roscFlashing ? 'bg-white text-red-600' : 'bg-red-600 text-white'} ${hasRosc ? 'opacity-50 cursor-not-allowed border-none' : ''}`}
        >
          <i className={`fas fa-heart-pulse text-2xl ${roscFlashing || hasRosc ? '' : 'animate-pulse'}`}></i>
          <span className="text-xl font-black uppercase tracking-[0.2em]">{hasRosc ? 'ROSC LOGGED' : 'ROSC ACHIEVED'}</span>
        </button>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Protocol Timeline</span>
            {arrest.events.length > 0 && (
               <button onClick={handleAIAnalysis} disabled={isAnalyzing} className="text-[9px] font-black text-blue-600 uppercase flex items-center gap-2 px-2 py-1 bg-blue-50 rounded-lg">
                 {isAnalyzing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-robot"></i>}
                 AI Debrief
               </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto p-3 space-y-3 custom-scrollbar">
            {/* ROSC Milestone Summary */}
            {showRoscSummary && hasRosc && (
              <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 shadow-sm animate-in zoom-in duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                    <i className="fas fa-check text-[10px]"></i>
                  </div>
                  <h3 className="text-[13px] font-black text-emerald-800 uppercase tracking-wider">ROSC Milestone Summary</h3>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-white/60 p-2 rounded-xl">
                    <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Total Cycles</p>
                    <p className="text-xl font-mono font-black text-slate-800">{roscStats.cycles}</p>
                  </div>
                  <div className="bg-white/60 p-2 rounded-xl">
                    <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Defibrillations</p>
                    <p className="text-xl font-mono font-black text-slate-800">{roscStats.shocks}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest mb-2 border-b border-emerald-100 pb-1">Drug Dosage Totals</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-[10px] font-bold text-slate-600">Epinephrine</span>
                      <span className="text-[11px] font-black text-slate-800">{roscStats.drugs.epi} doses</span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-[10px] font-bold text-slate-600">Amiodarone</span>
                      <span className="text-[11px] font-black text-slate-800">{roscStats.drugs.amio} doses</span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-[10px] font-bold text-slate-600">Lidocaine</span>
                      <span className="text-[11px] font-black text-slate-800">{roscStats.drugs.lido} doses</span>
                    </div>
                    {roscStats.drugs.nahco3 > 0 && (
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-[10px] font-bold text-slate-600">NaHCO3</span>
                        <span className="text-[11px] font-black text-slate-800">{roscStats.drugs.nahco3} doses</span>
                      </div>
                    )}
                    {roscStats.drugs.calcium > 0 && (
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-[10px] font-bold text-slate-600">Calcium</span>
                        <span className="text-[11px] font-black text-slate-800">{roscStats.drugs.calcium} doses</span>
                      </div>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => setShowRoscSummary(false)}
                  className="w-full mt-4 py-2 border border-emerald-200 text-emerald-600 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  Dismiss Summary
                </button>
              </div>
            )}

            {arrest.events.map(e => (
              <div key={e.id} className="flex gap-3 items-center p-2.5 rounded-lg bg-slate-50/50 border border-slate-100 group relative min-h-[44px]">
                <span className="text-[9px] font-mono text-slate-400 shrink-0">{e.wallTime}</span>
                <div className="flex-1 flex flex-col justify-center">
                  <p className="text-[11px] font-black text-slate-800 uppercase leading-tight">{e.type}</p>
                  {e.details && <p className="text-[9px] text-slate-500 italic mt-0.5 leading-tight">{e.details}</p>}
                </div>
                {/* Delete Button */}
                <button 
                  onClick={() => deleteEvent(e.id)}
                  className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 p-2 transition-opacity shrink-0"
                  title="ลบรายการนี้"
                >
                  <i className="fas fa-trash-can text-[11px]"></i>
                </button>
              </div>
            ))}
            {arrest.events.length === 0 && (
              <div className="p-8 text-center text-slate-300">
                <i className="fas fa-clipboard-check text-3xl mb-2 opacity-20"></i>
                <p className="text-[10px] font-bold uppercase tracking-widest">No Events Logged</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {showAnalysis && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 no-print">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-xl font-black text-slate-900">Medical Case Review</h2>
              <button onClick={() => setShowAnalysis(false)} className="text-slate-300 text-2xl"><i className="fas fa-times"></i></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto text-sm leading-relaxed text-slate-700 bg-slate-50 p-5 rounded-2xl border border-slate-100 mb-6 whitespace-pre-wrap font-sans">
              {analysisResult}
            </div>
            <button onClick={() => window.print()} className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 active:scale-95 transition-transform">
              <i className="fas fa-print"></i> Print Official Record
            </button>
          </div>
        </div>
      )}

      <footer className="p-4 bg-slate-100 text-[8px] text-slate-400 text-center border-t border-slate-200 uppercase font-black tracking-widest no-print">
        ACLS Scribe • version 1.3.1 • Medical Use Only
      </footer>
    </div>
  );

  async function handleAIAnalysis() {
    if (arrest.events.length < 2) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeArrest(arrest.events);
      setAnalysisResult(result || "Review generation failed.");
      setShowAnalysis(true);
    } catch (e) {
      setAnalysisResult("AI Analysis currently unavailable.");
      setShowAnalysis(true);
    } finally {
      setIsAnalyzing(false);
    }
  }
};

const InterventionButton: React.FC<{ 
  label: string; 
  icon: string; 
  color: string; 
  onClick: () => void; 
  disabled?: boolean; 
  urgent?: boolean;
  shockAlert?: boolean;
}> = ({ label, icon, color, onClick, disabled, urgent, shockAlert }) => {
  const [isFlashing, setIsFlashing] = useState(false);

  const colorMap: any = {
    amber: 'bg-amber-500',
    red: 'bg-red-600',
    emerald: 'bg-emerald-600',
    purple: 'bg-purple-600',
    slate: 'bg-slate-700',
    rose: 'bg-rose-600',
    cyan: 'bg-cyan-600',
    blue: 'bg-blue-600',
    zinc: 'bg-zinc-500',
    orange: 'bg-orange-500',
    pink: 'bg-pink-500'
  };

  const textMap: any = {
    amber: 'text-amber-600',
    red: 'text-red-600',
    emerald: 'text-emerald-600',
    purple: 'text-purple-600',
    slate: 'text-slate-700',
    rose: 'text-rose-600',
    cyan: 'text-cyan-600',
    blue: 'text-blue-600',
    zinc: 'text-zinc-600',
    orange: 'text-orange-600',
    pink: 'text-pink-600'
  };
  
  const handleTap = () => {
    if (disabled) return;
    setIsFlashing(true);
    onClick();
    setTimeout(() => setIsFlashing(false), 200);
  };

  const isSwapped = isFlashing && !disabled;
  
  const bgColorClass = isSwapped ? colorMap[color] : (disabled ? 'bg-slate-100' : 'bg-white');
  const iconBgClass = isSwapped ? 'bg-white shadow-inner' : (colorMap[color] || 'bg-slate-500');
  const iconTextClass = isSwapped ? textMap[color] : 'text-white';
  const labelTextClass = isSwapped ? 'text-white' : 'text-slate-700';

  return (
    <button
      onClick={handleTap}
      disabled={disabled}
      className={`w-full h-24 rounded-2xl flex flex-col items-center justify-center gap-2 shadow-sm active:scale-95 transition-all duration-150 disabled:opacity-20 border-b-4 border-slate-200 ${bgColorClass} ${urgent ? 'ring-4 ring-amber-400 animate-pulse' : ''} ${shockAlert ? 'ring-4 ring-red-500 animate-pulse bg-red-50 border-red-500' : ''}`}
    >
      <div className={`p-2.5 rounded-xl transition-colors duration-150 ${iconBgClass} ${iconTextClass}`}>
        <i className={`fas fa-${icon} text-xl`}></i>
      </div>
      <span className={`text-[10px] font-black uppercase tracking-tighter leading-tight text-center px-1 transition-colors duration-150 ${labelTextClass}`}>{label}</span>
    </button>
  );
};

export default App;
