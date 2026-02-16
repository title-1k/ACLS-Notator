
import React from 'react';

interface StatCardProps {
  label: string;
  value: string;
  color: string;
  urgent?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, color, urgent }) => (
  <div className={`bg-white p-3 rounded-xl border-l-4 shadow-sm ${color} ${urgent ? 'animate-pulse ring-2 ring-red-500 bg-red-50' : 'border-slate-200'}`}>
    <p className="text-[8px] uppercase text-slate-400 font-black tracking-widest">{label}</p>
    <p className={`text-lg font-mono font-bold ${urgent ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
  </div>
);

export default StatCard;
