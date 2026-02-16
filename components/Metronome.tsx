
import React, { useState, useEffect, useRef } from 'react';

interface MetronomeProps {
  isActive: boolean;
  isWarning: boolean;
  forceMute?: boolean;
}

const Metronome: React.FC<MetronomeProps> = ({ isActive, isWarning, forceMute = false }) => {
  const [bpm, setBpm] = useState(120);
  const [isMuted, setIsMuted] = useState(false);
  const [tick, setTick] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let interval: number;
    if (isActive) {
      const msPerBeat = 60000 / bpm;
      interval = window.setInterval(() => {
        setTick(prev => !prev);
        // Sound only plays if not manually muted AND not forced to mute (waiting for rhythm)
        if (!isMuted && !forceMute) {
          playClick(isWarning);
        }
      }, msPerBeat);
    }
    return () => clearInterval(interval);
  }, [isActive, bpm, isMuted, isWarning, forceMute]);

  const playClick = (highPitch: boolean) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    const osc = audioCtxRef.current.createOscillator();
    const envelope = audioCtxRef.current.createGain();
    const frequency = highPitch ? 1760 : 880; 
    osc.frequency.setValueAtTime(frequency, audioCtxRef.current.currentTime);
    osc.type = 'triangle';
    const peakGain = highPitch ? 0.9 : 0.7;
    envelope.gain.setValueAtTime(peakGain, audioCtxRef.current.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + 0.1);
    osc.connect(envelope);
    envelope.connect(audioCtxRef.current.destination);
    osc.start();
    osc.stop(audioCtxRef.current.currentTime + 0.1);
  };

  const adjustBpm = (delta: number) => {
    setBpm(prev => {
      const next = prev + delta;
      return Math.min(Math.max(next, 90), 150); // Clamp between 90 and 150
    });
  };

  return (
    <div className={`flex items-center justify-between rounded-lg border-2 transition-all h-full ${
      isWarning 
        ? (tick ? 'bg-orange-600 border-orange-400' : 'bg-orange-50 border-orange-200')
        : (tick ? 'bg-blue-600 border-blue-400' : 'bg-slate-50 border-slate-100')
    }`}>
      {/* Minus Button */}
      <button 
        onClick={(e) => { e.stopPropagation(); adjustBpm(-5); }}
        className={`w-8 h-full flex items-center justify-center rounded transition-colors ${tick && !isWarning ? 'text-white' : 'text-slate-400 active:bg-slate-200'}`}
        aria-label="Decrease BPM"
      >
        <i className="fas fa-minus text-[10px]"></i>
      </button>

      {/* Center Display: Icon and Text side-by-side */}
      <button 
        onClick={() => setIsMuted(!isMuted)}
        className="flex items-center justify-center gap-1.5 flex-1 px-0.5 h-full"
      >
        <i className={`fas ${isMuted || forceMute ? 'fa-volume-mute' : 'fa-volume-up'} text-[10px] ${tick && !isWarning ? 'text-white' : 'text-slate-400'}`}></i>
        <div className="flex flex-col items-center justify-center">
          <span className={`text-[12px] font-black font-mono leading-none ${tick && !isWarning ? 'text-white' : 'text-slate-900'}`}>{bpm}</span>
          <span className={`text-[6px] font-black uppercase tracking-tighter leading-none mt-0.5 ${tick && !isWarning ? 'text-blue-100' : 'text-slate-400'}`}>BPM</span>
        </div>
      </button>

      {/* Plus Button */}
      <button 
        onClick={(e) => { e.stopPropagation(); adjustBpm(5); }}
        className={`w-8 h-full flex items-center justify-center rounded transition-colors ${tick && !isWarning ? 'text-white' : 'text-slate-400 active:bg-slate-200'}`}
        aria-label="Increase BPM"
      >
        <i className="fas fa-plus text-[10px]"></i>
      </button>
    </div>
  );
};

export default Metronome;
