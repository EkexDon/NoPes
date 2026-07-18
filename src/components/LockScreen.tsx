import React, { useEffect, useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { loadLockConfig, verifyPassword } from '../vaultLock';

/**
 * Full-screen privacy gate. Rendered above the entire app while locked —
 * solid background, nothing underneath is readable or clickable.
 */
export const LockScreen: React.FC<{ onUnlock: () => void }> = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const tryUnlock = async () => {
    if (checking) return;
    const config = loadLockConfig();
    if (!config) { onUnlock(); return; } // lock was disabled elsewhere
    setChecking(true);
    try {
      if (await verifyPassword(password, config)) {
        onUnlock();
      } else {
        setPassword('');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        inputRef.current?.focus();
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className={`lock-card ${shake ? 'shake' : ''}`}>
        <div className="lock-icon"><Lock size={26} /></div>
        <div className="lock-title">NoPes is locked</div>
        <div className="lock-hint">Enter your vault password to continue</div>
        <input
          ref={inputRef}
          type="password"
          className="lock-input"
          placeholder="Password"
          value={password}
          autoFocus
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') tryUnlock(); }}
        />
        <button className="lock-unlock-btn" onClick={tryUnlock} disabled={checking || !password}>
          <Unlock size={13} /> {checking ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
};
