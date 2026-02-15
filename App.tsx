
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { ActionType, ACLSEvent, ArrestState, ACLSRhythms } from './types';
import Metronome from './components/Metronome';
import StatCard from './components/StatCard';
import { analyzeArrest } from './services/geminiService';

// Audio decoding utilities as per Gemini API guidelines
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
  const [lastEpiTime, setLastEpiTime] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  
  // Rhythm Popover State
  const [showRhythmPopover, setShowRhythmPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Timers
  useEffect(() => {
    let interval: number;
    if (arrest.isActive && arrest.startTime) {
      interval = window.setInterval(() => {
        const now = Date.now();
        const currentElapsed = now - (arrest.startTime || now);
        setElapsedTime(currentElapsed);
        
        // Find last rhythm check or arrest start for cycle timer
        const lastCheck = [...arrest.events].reverse().find(e => e.type === ActionType.RHYTHM_CHECK);
        const cycleBase = lastCheck ? lastCheck.timestamp : 0;
        setCycleTime(currentElapsed - cycleBase);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [arrest.isActive, arrest.startTime, arrest.events]);

  // Click outside to close popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowRhythmPopover(false);
      }
    };
    if (showRhythmPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRhythmPopover]);

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

    setArrest(prev => ({
      ...prev,
      events: [newEvent, ...prev.events]
    }));

    if (type === ActionType.EPINEPHRINE) {
      setLastEpiTime(timestamp);
    }
  }, [arrest.startTime]);

  const playROSCAlert = async () => {
    setIsPlayingAudio(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: 'Shout urgently and loudly in Thai: ROSC! หาเตียง ICU!' }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }, // Kore has a strong profile
            },
          },
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
      console.error("Failed to generate ROSC alert audio:", error);
      setIsPlayingAudio(false);
    }
  };

  const handleROSC = () => {
    logEvent(ActionType.ROSC);
    playROSCAlert();
  };

  const handleRhythmSelect = (rhythm: string) => {
    logEvent(ActionType.RHYTHM_CHECK, rhythm);
    setShowRhythmPopover(false);
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
        type: 'Arrest Started'
      }]
    });
    setElapsedTime(0);
    setCycleTime(0);
    setLastEpiTime(null);
    setAnalysisResult(null);
    setShowAnalysis(false);
    setShowRhythmPopover(false);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAIAnalysis = async () => {
    if (arrest.events.length === 0) return;
    setIsAnalyzing(true);
    const result = await analyzeArrest(arrest.events);
    setAnalysisResult(result);
    setIsAnalyzing(false);
    setShowAnalysis(true);
  };

  const epiDue = lastEpiTime !== null && (elapsedTime - lastEpiTime) >= 180000; // 3 mins
  const cycleDue = cycleTime >= 120000; // 2 mins
  const isCycleWarning = cycleTime >= 110000 && cycleTime < 120000;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col max-w-4xl mx-auto shadow-2xl relative">
      
      {/* Header */}
      <header className="p-4 border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-50 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 p-2 rounded-lg animate-pulse">
            <i className="fas fa-heart text-white"></i>
          </div>
          <h1 className="font-bold text-xl tracking-tight uppercase">ACLS Scribe</h1>
        </div>
        {!arrest.isActive ? (
          <button 
            onClick={startArrest}
            className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded-full font-bold transition-all transform active:scale-95 shadow-lg shadow-red-900/40"
          >
            START CODE
          </button>
        ) : (
          <button 
            onClick={() => {
              logEvent(ActionType.PRONOUNCED);
              setArrest(prev => ({ ...prev, isActive: false }));
            }}
            className="bg-gray-700 hover:bg-gray-600 px-6 py-2 rounded-full font-bold transition-all"
          >
            STOP CODE
          </button>
        )}
      </header>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
        <StatCard 
          label="Total Duration" 
          value={formatTime(elapsedTime)} 
          color="border-blue-500" 
        />
        <StatCard 
          label="Next Cycle" 
          value={formatTime(Math.max(0, 120000 - cycleTime))} 
          color="border-yellow-500" 
          urgent={cycleDue}
        />
        <StatCard 
          label="Next Epi" 
          value={lastEpiTime !== null ? formatTime(Math.max(0, 180000 - (elapsedTime - lastEpiTime))) : '---'} 
          color="border-green-500" 
          urgent={epiDue}
        />
        <Metronome isActive={arrest.isActive} isWarning={isCycleWarning} />
      </div>

      {/* Action Controls */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          
          {/* Rhythm Check with Popover Container */}
          <div className="relative" ref={popoverRef}>
            <ActionButton 
              label="RHYTHM CHECK" 
              icon="fa-bolt-lightning" 
              color="bg-yellow-600" 
              onClick={() => setShowRhythmPopover(!showRhythmPopover)}
              disabled={!arrest.isActive}
              urgent={cycleDue}
              active={showRhythmPopover}
            />
            
            {showRhythmPopover && (
              <div className="absolute top-full left-0 mt-2 z-[60] w-64 bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-black uppercase text-red-500 mb-2">Shockable</p>
                    <div className="flex gap-2">
                      {ACLSRhythms.SHOCKABLE.map(r => (
                        <button 
                          key={r}
                          onClick={() => handleRhythmSelect(r)}
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2 rounded-lg transition-transform active:scale-95"
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-blue-400 mb-2">Non-Shockable</p>
                    <div className="flex gap-2">
                      {ACLSRhythms.NON_SHOCKABLE.map(r => (
                        <button 
                          key={r}
                          onClick={() => handleRhythmSelect(r)}
                          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 rounded-lg transition-transform active:scale-95"
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-gray-500 mb-2">Other</p>
                    <div className="grid grid-cols-1 gap-2">
                      {ACLSRhythms.OTHER.map(r => (
                        <button 
                          key={r}
                          onClick={() => handleRhythmSelect(r)}
                          className="bg-gray-900 hover:bg-gray-850 border border-gray-700 text-gray-300 text-[10px] font-bold py-1.5 rounded-lg transition-transform active:scale-95"
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <ActionButton 
            label="SHOCK 200J" 
            icon="fa-bolt" 
            color="bg-red-600" 
            onClick={() => logEvent(ActionType.SHOCK)}
            disabled={!arrest.isActive}
          />
          <ActionButton 
            label="EPINEPHRINE" 
            icon="fa-syringe" 
            color="bg-green-600" 
            onClick={() => logEvent(ActionType.EPINEPHRINE)}
            disabled={!arrest.isActive}
            urgent={epiDue}
          />
          <ActionButton 
            label="AMIODARONE 300" 
            icon="fa-capsules" 
            color="bg-purple-600" 
            onClick={() => logEvent(ActionType.AMIODARONE_300)}
            disabled={!arrest.isActive}
          />
          <ActionButton 
            label="AMIODARONE 150" 
            icon="fa-capsules" 
            color="bg-purple-500" 
            onClick={() => logEvent(ActionType.AMIODARONE_150)}
            disabled={!arrest.isActive}
          />
          <ActionButton 
            label="LIDOCAINE" 
            icon="fa-prescription-bottle" 
            color="bg-blue-600" 
            onClick={() => logEvent(ActionType.LIDOCAINE)}
            disabled={!arrest.isActive}
          />
          <ActionButton 
            label="ROSC" 
            icon="fa-heart-pulse" 
            color="bg-emerald-500" 
            onClick={handleROSC}
            disabled={!arrest.isActive}
            active={isPlayingAudio}
          />
          <ActionButton 
            label="AIRWAY" 
            icon="fa-lungs" 
            color="bg-gray-600" 
            onClick={() => logEvent(ActionType.INTUBATION)}
            disabled={!arrest.isActive}
          />
           <ActionButton 
            label="IV/IO ACCESS" 
            icon="fa-hand-holding-medical" 
            color="bg-indigo-600" 
            onClick={() => logEvent(ActionType.IV_IO)}
            disabled={!arrest.isActive}
          />
        </div>

        {/* AI Analysis View */}
        {showAnalysis && (
          <div className="mb-6 bg-blue-900/20 border border-blue-800 rounded-xl p-6 relative">
            <button onClick={() => setShowAnalysis(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">
              <i className="fas fa-times"></i>
            </button>
            <h3 className="text-xl font-bold text-blue-400 mb-4 flex items-center gap-2">
              <i className="fas fa-robot"></i> AI Debriefing Analysis
            </h3>
            <div className="prose prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
              {analysisResult}
            </div>
          </div>
        )}

        {/* Event Log */}
        <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
          <div className="p-4 border-b border-gray-700 bg-gray-800/50 flex justify-between items-center">
            <h2 className="font-bold text-gray-300 uppercase tracking-widest text-xs">Arrest Log</h2>
            <div className="flex gap-2">
               <button 
                onClick={handleAIAnalysis}
                disabled={isAnalyzing || arrest.events.length < 2}
                className="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded-md font-bold disabled:opacity-50 flex items-center gap-1"
              >
                {isAnalyzing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-wand-magic-sparkles"></i>}
                AI ANALYSIS
              </button>
              <button 
                onClick={() => {
                  const text = arrest.events.map(e => `${e.wallTime} - ${e.type}${e.details ? ` (${e.details})` : ''}`).join('\n');
                  navigator.clipboard.writeText(text);
                  alert('Log copied to clipboard');
                }}
                className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-md"
              >
                COPY LOG
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {arrest.events.length === 0 ? (
              <div className="p-8 text-center text-gray-500 italic text-sm">
                No events recorded. Start the arrest to begin tracking.
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase text-gray-500 bg-gray-900/50">
                  <tr>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Elapsed</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {arrest.events.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-750 transition-colors group">
                      <td className="px-4 py-3 font-mono text-sm text-gray-400">{event.wallTime}</td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-400">{formatTime(event.timestamp)}</td>
                      <td className="px-4 py-3 text-sm font-semibold group-hover:text-white">
                        <div className="flex flex-col">
                          {renderEventTypeLabel(event.type)}
                          {event.details && <span className="text-[10px] text-gray-400 font-mono mt-0.5 tracking-tight">{event.details}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <footer className="p-4 bg-gray-950 text-[10px] text-gray-600 text-center uppercase tracking-[0.2em] font-bold">
        ACLS Digital Scribe Protocol v3.3 • Clinical Use Only
      </footer>
    </div>
  );
};

const ActionButton: React.FC<{ label: string; icon: string; color: string; onClick: () => void; disabled?: boolean; urgent?: boolean; active?: boolean }> = ({ label, icon, color, onClick, disabled, urgent, active }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full ${color} p-4 rounded-xl flex flex-col items-center justify-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-30 disabled:grayscale hover:brightness-110 ${urgent ? 'animate-pulse ring-4 ring-yellow-400' : ''} ${active ? 'ring-2 ring-white scale-[0.98]' : ''}`}
  >
    <i className={`fas ${icon} text-xl`}></i>
    <span className="text-[10px] font-black leading-tight uppercase text-center">{label}</span>
  </button>
);

const renderEventTypeLabel = (type: string) => {
  const base = "px-2 py-0.5 rounded text-[10px] mr-2 inline-block ";
  switch(type) {
    case ActionType.SHOCK: return <><span className={base + "bg-red-900 text-red-200 border border-red-500"}>SHOCK</span> {type}</>;
    case ActionType.EPINEPHRINE: return <><span className={base + "bg-green-900 text-green-200 border border-green-500"}>MED</span> {type}</>;
    case ActionType.AMIODARONE_300:
    case ActionType.AMIODARONE_150:
    case ActionType.LIDOCAINE: return <><span className={base + "bg-purple-900 text-purple-200 border border-purple-500"}>ANTIARR</span> {type}</>;
    case ActionType.ROSC: return <><span className={base + "bg-emerald-600 text-white font-black"}>SUCCESS</span> {type}</>;
    case ActionType.RHYTHM_CHECK: return <><span className={base + "bg-yellow-900 text-yellow-200 border border-yellow-500"}>CHECK</span> {type}</>;
    default: return type;
  }
}

export default App;
