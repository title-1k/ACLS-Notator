
import React, { useState, useEffect, useRef } from 'react';

interface MetronomeProps {
  isActive: boolean;
  isWarning: boolean;
  forceMute?: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
}

const Metronome: React.FC<MetronomeProps> = ({ isActive, isWarning, forceMute = false, isMuted, onToggleMute }) => {
  const [bpm, setBpm] = useState(120);
  const [tick, setTick] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let interval: number;
    if (isActive) {
      const msPerBeat = 60000 / bpm;
      interval = window.setInterval(() => {
        setTick(prev => !prev);
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
      return Math.min(Math.max(next, 90), 150);
    });
  };

  return (
    <div className={`flex flex-col rounded-lg border-2 transition-all h-full overflow-hidden ${
      isWarning 
        ? (tick ? 'bg-orange-600 border-orange-400' : 'bg-orange-50 border-orange-200')
        : (tick ? 'bg-blue-600 border-blue-400' : 'bg-slate-50 border-slate-100')
    }`}>
      <div className="flex-1 flex items-center justify-between px-1">
        <button 
          onClick={(e) => { e.stopPropagation(); adjustBpm(-5); }}
          className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors ${tick && !isWarning ? 'text-white' : 'text-slate-400 active:bg-slate-200'}`}
        >
          <i className="fas fa-minus text-[10px]"></i>
        </button>

        <div className="flex flex-col items-center justify-center pointer-events-none leading-none">
          <span className={`text-[16px] font-black font-mono ${tick && !isWarning ? 'text-white' : 'text-slate-900'}`}>{bpm}</span>
          <span className={`text-[6px] font-black uppercase tracking-tighter mt-0.5 ${tick && !isWarning ? 'text-blue-100' : 'text-slate-400'}`}>BPM</span>
        </div>

        <button 
          onClick={(e) => { e.stopPropagation(); adjustBpm(5); }}
          className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors ${tick && !isWarning ? 'text-white' : 'text-slate-400 active:bg-slate-200'}`}
        >
          <i className="fas fa-plus text-[10px]"></i>
        </button>
      </div>
    </div>
  );
};

export default Metronome;
