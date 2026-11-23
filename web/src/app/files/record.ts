export type RecordMode = 'audio' | 'camera' | 'screen';

export const canRecord = () => typeof window !== 'undefined' && 'MediaRecorder' in window;

export const canRecordScreen = () =>
  canRecord() && (!window.isSecureContext || typeof navigator.mediaDevices?.getDisplayMedia === 'function');
