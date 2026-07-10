import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { join, dirname } from '@tauri-apps/api/path';
import { useStore } from '../store/useStore';
import { blobToWhisperWav, cleanTranscript } from '../audio';

const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const WHISPER_MODEL_MB = 142;

interface WhisperStatus {
  binary: string | null;
  model_present: boolean;
  model_path: string;
}

/* ────────────────────────────────────────────────────────────
   Record button (editor topbar)
──────────────────────────────────────────────────────────── */

export const VoiceMemoButton: React.FC<{
  onResult: (transcript: string, audioRelPath: string) => void;
}> = ({ onResult }) => {
  const { vaultPath } = useStore();
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { // unmount: stop everything
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stream.getTracks().forEach(t => t.stop());
  }, []);

  const start = async () => {
    if (!('__TAURI_INTERNALS__' in window)) { toast.error('Voice memos need the desktop app'); return; }
    try {
      const status = await invoke<WhisperStatus>('check_whisper');
      if (!status.binary || !status.model_present) {
        toast.error('Set up voice transcription first: Settings → General → Voice');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => finish(new Blob(chunksRef.current, { type: rec.mimeType }));
      rec.start();
      recorderRef.current = rec;
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
      setState('recording');
    } catch (e: any) {
      toast.error(e?.name === 'NotAllowedError'
        ? 'Microphone access denied — allow it in System Settings → Privacy'
        : `Could not start recording: ${e?.message ?? e}`);
    }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach(t => t.stop());
    setState('working');
  };

  const finish = async (blob: Blob) => {
    try {
      if (!vaultPath) throw new Error('No vault open');
      const wav = await blobToWhisperWav(blob);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const relPath = `assets/voice-${stamp}.wav`;
      const absPath = await join(vaultPath, relPath);
      const assetsDir = await join(vaultPath, 'assets');
      if (!(await exists(assetsDir))) await mkdir(assetsDir);
      await writeFile(absPath, wav);

      const raw = await invoke<string>('transcribe_audio', { wavPath: absPath });
      const transcript = cleanTranscript(raw);
      if (!transcript) {
        toast('No speech detected — audio saved anyway.', { icon: '🤫' });
        onResult('', relPath);
      } else {
        onResult(transcript, relPath);
        toast.success('Transcribed locally 🎙️');
      }
    } catch (e: any) {
      toast.error(`${e?.message ?? e}`, { duration: 6000 });
    } finally {
      setState('idle');
    }
  };

  if (state === 'recording') {
    return (
      <button className="icon-btn sm voice-recording" onClick={stop} title="Stop recording">
        <Square size={13} />
        <span className="voice-timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
      </button>
    );
  }
  if (state === 'working') {
    return (
      <button className="icon-btn sm" disabled title="Transcribing locally…">
        <Loader2 size={15} className="spinning" />
      </button>
    );
  }
  return (
    <button className="icon-btn sm" onClick={start} title="Record voice memo (transcribed locally)">
      <Mic size={15} />
    </button>
  );
};

/* ────────────────────────────────────────────────────────────
   Settings panel (Settings → General → Voice)
──────────────────────────────────────────────────────────── */

export const WhisperSettings: React.FC = () => {
  const [status, setStatus] = useState<WhisperStatus | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const refresh = async () => {
    try { setStatus(await invoke<WhisperStatus>('check_whisper')); }
    catch { setStatus(null); }
  };
  useEffect(() => { if ('__TAURI_INTERNALS__' in window) refresh(); }, []);

  const downloadModel = async () => {
    if (!status || progress !== null) return;
    setProgress(0);
    try {
      const res = await fetch(WHISPER_MODEL_URL);
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
      const total = Number(res.headers.get('Content-Length')) || WHISPER_MODEL_MB * 1024 * 1024;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setProgress(Math.min(99, Math.round((received / total) * 100)));
      }
      const all = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) { all.set(c, off); off += c.length; }

      const dir = await dirname(status.model_path);
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      await writeFile(status.model_path, all);
      toast.success('Whisper model installed — voice memos are ready');
      await refresh();
    } catch (e: any) {
      toast.error(`Model download failed: ${e?.message ?? e}`);
    } finally {
      setProgress(null);
    }
  };

  if (!('__TAURI_INTERNALS__' in window)) return null;

  return (
    <div className="setting-row" style={{ alignItems: 'flex-start' }}>
      <div>
        <div className="setting-info-label">Voice Transcription (Whisper)</div>
        <div className="setting-info-desc">
          Record voice memos in the editor; speech is transcribed 100% on-device by whisper.cpp.
        </div>
        <div className="whisper-status">
          {status === null ? 'Checking…' : (
            <>
              <span className={status.binary ? 'ok' : 'missing'}>
                {status.binary ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {status.binary ? `binary: ${status.binary}` : 'whisper not installed — run: brew install whisper-cpp'}
              </span>
              <span className={status.model_present ? 'ok' : 'missing'}>
                {status.model_present ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {status.model_present ? 'model: ggml-base (multilingual)' : `model: not downloaded (${WHISPER_MODEL_MB} MB)`}
              </span>
            </>
          )}
        </div>
      </div>
      {status && !status.model_present && (
        <button className="security-btn primary" onClick={downloadModel} disabled={progress !== null}>
          {progress !== null ? `${progress}%` : <><Download size={13} /> Download model</>}
        </button>
      )}
    </div>
  );
};
