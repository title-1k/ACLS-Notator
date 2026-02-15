
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
    
    // Ensure context is resumed (browsers often block auto-play)
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    const osc = audioCtxRef.current.createOscillator();
    const envelope = audioCtxRef.current.createGain();

    // Use a higher frequency for the warning period (last 10 seconds)
    const frequency = highPitch ? 1760 : 880; 
    osc.frequency.setValueAtTime(frequency, audioCtxRef.current.currentTime);
    osc.type = 'sine';

    envelope.gain.setValueAtTime(0.1, audioCtxRef.current.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + 0.1);

    osc.connect(envelope);
    envelope.connect(audioCtxRef.current.destination);

    osc.start();
    osc.stop(audioCtxRef.current.currentTime + 0.1);
  };

  return (
    <div className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-75 ${
      isWarning 
        ? (tick ? 'bg-orange-600 border-orange-400 scale-105 shadow-lg shadow-orange-900/50' : 'bg-orange-900/40 border-orange-700')
        : (tick ? 'bg-blue-900/40 border-blue-500' : 'bg-gray-800 border-gray-700')
    }`}>
      <div className="flex items-center gap-4 mb-2">
        <i className={`fas fa-heartbeat text-2xl ${isWarning ? 'text-orange-400 animate-bounce' : (tick ? 'text-blue-400' : 'text-gray-500')}`}></i>
        <span className="text-xl font-bold font-mono">{bpm} BPM</span>
      </div>
      <div className="flex gap-2">
        <button 
          onClick={() => setBpm(prev => Math.max(100, prev - 5))}
          className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600"
        >
          -5
        </button>
        <button 
          onClick={() => setBpm(prev => Math.min(120, prev + 5))}
          className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600"
        >
          +5
        </button>
        <button 
          onClick={() => setIsMuted(!isMuted)}
          className={`px-3 py-1 rounded transition-colors ${isMuted ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}
        >
          <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'}`}></i>
        </button>
      </div>
      <p className={`text-[10px] uppercase tracking-widest mt-2 font-bold ${isWarning ? 'text-orange-400' : 'text-gray-500'}`}>
        {isWarning ? 'CYCLE ENDING' : 'Metronome'}
      </p>
    </div>
  );
};

export default Metronome;
