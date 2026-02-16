
import React, { useState, useEffect, useRef } from 'react';

interface MetronomeProps {
  isActive: boolean;
  isWarning: boolean;
}

const Metronome: React.FC<MetronomeProps> = ({ isActive, isWarning }) => {
  const [bpm, setBpm] = useState(110);
  const [isMuted, setIsMuted] = useState(true);
  const [tick, setTick] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let interval: number;
    if (isActive) {
      const msPerBeat = 60000 / bpm;
      interval = window.setInterval(() => {
        setTick(prev => !prev);
        if (!isMuted) {
          playClick(isWarning);
        }
      }, msPerBeat);
    }
    return () => clearInterval(interval);
  }, [isActive, bpm, isMuted, isWarning]);

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

  return (
    <div className={`flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all ${
      isWarning 
        ? (tick ? 'bg-orange-600 border-orange-400 scale-105' : 'bg-orange-50 border-orange-200')
        : (tick ? 'bg-blue-600 border-blue-400' : 'bg-slate-50 border-slate-100')
    }`}>
      <button 
        onClick={() => setIsMuted(!isMuted)}
        className="flex flex-col items-center gap-1"
      >
        <i className={`fas ${isMuted ? 'fa-volume-mute text-slate-300' : 'fa-volume-up text-slate-800'} text-xs`}></i>
        <span className={`text-[10px] font-black font-mono ${tick && !isWarning ? 'text-white' : 'text-slate-900'}`}>{bpm}</span>
      </button>
    </div>
  );
};

export default Metronome;
