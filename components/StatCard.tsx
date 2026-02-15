
import React from 'react';

interface StatCardProps {
  label: string;
  value: string;
  color: string;
  urgent?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, color, urgent }) => (
  <div className={`bg-gray-800 p-4 rounded-xl border-l-4 ${color} ${urgent ? 'animate-pulse ring-2 ring-red-500' : ''}`}>
    <p className="text-xs uppercase text-gray-400 font-bold tracking-wider">{label}</p>
    <p className="text-2xl font-mono font-bold">{value}</p>
  </div>
);

export default StatCard;
