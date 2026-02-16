
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { ActionType, ACLSEvent, ArrestState, ACLSRhythms } from './types';
import Metronome from './components/Metronome';
import StatCard from './components/StatCard';
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

  const [patientInfo, setPatientInfo] = useState({ name: '', hn: '', location: '', leader: '' });
  const [elapsedTime, setElapsedTime] = useState(0);
  const [cycleTime, setCycleTime] = useState(0);
  const [lastEpiTime, setLastEpiTime] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [etco2Input, setEtco2Input] = useState('');
  const [showRhythmPopover, setShowRhythmPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let interval: number;
    if (arrest.isActive && arrest.startTime) {
      interval = window.setInterval(() => {
        const now = Date.now();
        const currentElapsed = now - (arrest.startTime || now);
        setElapsedTime(currentElapsed);
        const lastCheck = [...arrest.events].reverse().find(e => e.type === ActionType.RHYTHM_CHECK);
        const cycleBase = lastCheck ? lastCheck.timestamp : 0;
        setCycleTime(currentElapsed - cycleBase);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [arrest.isActive, arrest.startTime, arrest.events]);

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
    // Haptic feedback for iPhone users
    if (window.navigator.vibrate) window.navigator.vibrate(50);
  }, [arrest.startTime]);

  const playROSCAlert = async () => {
    setIsPlayingAudio(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: 'Alert: ROSC detected. Prepare ICU transfer.' }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const decodedBytes = decodeBase64(base64Audio);
        const audioBuffer = await decodeAudioData(decodedBytes, audioCtx, 24000, 1);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.onended = () => setIsPlayingAudio(false);
        source.start();
      } else {
        setIsPlayingAudio(false);
      }
    } catch (error) {
      console.error(error);
      setIsPlayingAudio(false);
    }
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
    setLastEpiTime(null);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const epiDue = lastEpiTime !== null && (elapsedTime - lastEpiTime) >= 180000;
  const cycleDue = cycleTime >= 120000;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto shadow-none sm:shadow-2xl border-x border-slate-200">
      {/* Fixed Header for Mobile */}
      <header className="p-4 bg-white border-b-2 border-slate-900 sticky top-0 z-50 shadow-sm no-print">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <span className="bg-red-600 text-white px-2 py-0.5 rounded text-xs">ACLS</span>
            SCRIBE
          </h1>
          {!arrest.isActive ? (
            <button onClick={startArrest} className="bg-red-600 text-white px-5 py-2 rounded-lg font-black uppercase text-xs shadow-lg active:scale-95">
              Start Code
            </button>
          ) : (
            <button onClick={() => setArrest(p => ({...p, isActive: false}))} className="bg-slate-900 text-white px-5 py-2 rounded-lg font-black uppercase text-xs active:scale-95">
              Stop
            </button>
          )}
        </div>

        {/* Vital Timers */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`p-2 rounded-lg border-2 ${cycleDue ? 'bg-amber-50 border-amber-500 animate-pulse' : 'bg-slate-50 border-slate-100'}`}>
            <p className="text-[8px] font-black text-slate-400 uppercase text-center">Cycle</p>
            <p className="text-sm font-mono font-bold text-center">{formatTime(Math.max(0, 120000 - cycleTime))}</p>
          </div>
          <div className={`p-2 rounded-lg border-2 ${epiDue ? 'bg-green-50 border-green-500 animate-pulse' : 'bg-slate-50 border-slate-100'}`}>
            <p className="text-[8px] font-black text-slate-400 uppercase text-center">Epi</p>
            <p className="text-sm font-mono font-bold text-center">{lastEpiTime !== null ? formatTime(Math.max(0, 180000 - (elapsedTime - lastEpiTime))) : '--:--'}</p>
          </div>
          <Metronome isActive={arrest.isActive} isWarning={cycleTime >= 110000} />
        </div>
      </header>

      {/* Intervention Grid - Optimized for Mobile Thumb Reach */}
      <main className="flex-1 p-4 pb-24 overflow-y-auto space-y-4 custom-scrollbar">
        <div className="grid grid-cols-2 gap-3">
          <div className="relative" ref={popoverRef}>
            <InterventionButton label="Rhythm Check" icon="bolt-lightning" color="amber" onClick={() => setShowRhythmPopover(!showRhythmPopover)} disabled={!arrest.isActive} urgent={cycleDue} />
            {showRhythmPopover && (
              <div className="absolute bottom-full left-0 mb-2 z-[60] w-64 bg-white border-2 border-slate-200 rounded-2xl shadow-2xl p-4 animate-in slide-in-from-bottom duration-150">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { logEvent(ActionType.RHYTHM_CHECK, 'VF/pVT'); setShowRhythmPopover(false); }} className="bg-red-600 text-white text-[10px] font-black py-3 rounded-lg">SHOCKABLE</button>
                  <button onClick={() => { logEvent(ActionType.RHYTHM_CHECK, 'PEA/Asystole'); setShowRhythmPopover(false); }} className="bg-slate-800 text-white text-[10px] font-black py-3 rounded-lg">NON-SHOCKABLE</button>
                </div>
              </div>
            )}
          </div>
          <InterventionButton label="Shock" icon="bolt" color="red" onClick={() => logEvent(ActionType.SHOCK)} disabled={!arrest.isActive} />
          <InterventionButton label="Epinephrine" icon="syringe" color="emerald" onClick={() => logEvent(ActionType.EPINEPHRINE)} disabled={!arrest.isActive} urgent={epiDue} />
          <InterventionButton label="Amiodarone" icon="capsules" color="purple" onClick={() => logEvent(ActionType.AMIODARONE_300)} disabled={!arrest.isActive} />
          <InterventionButton label="Airway" icon="lungs" color="slate" onClick={() => logEvent(ActionType.INTUBATION)} disabled={!arrest.isActive} />
          <InterventionButton label="ROSC" icon="heart-pulse" color="rose" onClick={() => { logEvent(ActionType.ROSC); playROSCAlert(); }} disabled={!arrest.isActive} />
          
          <div className="col-span-2 bg-white p-3 rounded-2xl border border-slate-200 flex gap-2 items-center">
            <input type="number" placeholder="EtCO2" value={etco2Input} onChange={e => setEtco2Input(e.target.value)} disabled={!arrest.isActive} className="flex-1 bg-slate-50 border-none rounded-lg px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
            <button onClick={() => { logEvent(ActionType.ETCO2, `${etco2Input} mmHg`); setEtco2Input(''); }} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-black uppercase text-[10px]">Log</button>
          </div>
        </div>

        {/* Live Event Feed */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live Timeline</span>
            {arrest.events.length > 0 && (
               <button onClick={handleAIAnalysis} disabled={isAnalyzing} className="text-[9px] font-black text-blue-600 uppercase">Debrief</button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto p-2 space-y-2">
            {arrest.events.map(e => (
              <div key={e.id} className="flex gap-3 items-start p-2 rounded-lg bg-slate-50/50">
                <span className="text-[9px] font-mono text-slate-400 mt-0.5">{e.wallTime}</span>
                <div>
                  <p className="text-[11px] font-black text-slate-800 uppercase leading-none">{e.type}</p>
                  {e.details && <p className="text-[9px] text-slate-500 mt-1 italic">{e.details}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* AI Analysis Overlay */}
      {showAnalysis && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 flex items-end sm:items-center justify-center p-4 no-print">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-xl font-black text-slate-900">Clinical Review</h2>
              <button onClick={() => setShowAnalysis(false)} className="text-slate-300 text-2xl"><i className="fas fa-times"></i></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto text-sm leading-relaxed text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6">
              {analysisResult}
            </div>
            <button onClick={() => window.print()} className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase tracking-widest text-xs">Print Final Record</button>
          </div>
        </div>
      )}

      <footer className="p-4 bg-slate-100 text-[8px] text-slate-400 text-center border-t border-slate-200 uppercase font-black tracking-widest no-print">
        Official ACLS Record • Restricted Use
      </footer>
    </div>
  );

  async function handleAIAnalysis() {
    if (arrest.events.length < 2) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeArrest(arrest.events);
      setAnalysisResult(result || "Failed to generate report.");
      setShowAnalysis(true);
    } catch (e) {
      setAnalysisResult("AI Error. Please check connectivity.");
      setShowAnalysis(true);
    } finally {
      setIsAnalyzing(false);
    }
  }
};

const InterventionButton: React.FC<{ label: string; icon: string; color: string; onClick: () => void; disabled?: boolean; urgent?: boolean }> = ({ label, icon, color, onClick, disabled, urgent }) => {
  const colorMap: any = {
    amber: 'bg-amber-500',
    red: 'bg-red-600',
    emerald: 'bg-emerald-600',
    purple: 'bg-purple-600',
    slate: 'bg-slate-700',
    rose: 'bg-rose-600'
  };
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full h-24 rounded-2xl flex flex-col items-center justify-center gap-2 shadow-sm active:scale-95 transition-all disabled:opacity-20 border-b-4 border-slate-200 ${disabled ? 'bg-slate-100' : 'bg-white'} ${urgent ? 'ring-4 ring-amber-400 animate-pulse' : ''}`}
    >
      <div className={`p-2 rounded-xl text-white ${colorMap[color] || 'bg-slate-500'}`}>
        <i className={`fas fa-${icon} text-lg`}></i>
      </div>
      <span className="text-[9px] font-black uppercase text-slate-700 tracking-tighter">{label}</span>
    </button>
  );
};

export default App;
