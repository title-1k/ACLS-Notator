
export enum ActionType {
  COMPRESSION_START = 'Compression Started',
  COMPRESSION_STOP = 'Compression Stopped',
  RHYTHM_CHECK = 'Rhythm Check',
  SHOCK = 'Shock 200 J',
  EPINEPHRINE = 'Epinephrine 1mg',
  AMIODARONE_300 = 'Amiodarone 300mg',
  AMIODARONE_150 = 'Amiodarone 150mg',
  LIDOCAINE = 'Lidocaine',
  INTUBATION = 'Advanced Airway',
  ROSC = 'ROSC Achieved',
  PRONOUNCED = 'Arrest Terminated',
  IV_IO = 'IV/IO Access',
  BLOOD_GAS = 'Blood Gas Drawn',
  ETCO2 = 'End-tidal CO2',
  OTHER = 'Manual Note'
}

export const ACLSRhythms = {
  SHOCKABLE: ['VF', 'pVT'],
  NON_SHOCKABLE: ['Asystole', 'PEA'],
  OTHER: ['Organized Rhythm', 'Unknown']
};

export interface ACLSEvent {
  id: string;
  timestamp: number; // ms since start
  wallTime: string; // HH:mm:ss
  type: ActionType | string;
  details?: string;
}

export interface ArrestState {
  isActive: boolean;
  startTime: number | null;
  events: ACLSEvent[];
}
