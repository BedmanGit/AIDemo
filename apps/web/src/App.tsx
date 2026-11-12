import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, AudioLines, Check, ChevronDown, CircleAlert, Headphones, Mic, MicOff, PhoneOff, Radio, Search, Sparkles, Square, Volume2 } from 'lucide-react';
import { models, type ModelId, type ServerMessage } from '../../../packages/shared/src/protocol';
import { AudioPlayback, encodeAudio } from './audio';

type Status = 'offline' | 'connecting' | 'listening' | 'speaking';
type Transcript = { id: number; speaker: 'user' | 'assistant'; text: string; finished: boolean };
type Resources = { socket?: WebSocket; stream?: MediaStream; context?: AudioContext; source?: MediaStreamAudioSourceNode; worklet?: AudioWorkletNode; silent?: GainNode; playback?: AudioPlayback; muted: boolean; ready: boolean; timer?: number };

const statusLabels: Record<Status, string> = { offline: 'Not connected', connecting: 'Connecting', listening: 'Listening', speaking: 'Speaking' };

export function App() {
  const [model, setModel] = useState<ModelId>(models[0].id);
  const [status, setStatus] = useState<Status>('offline');
  const [muted, setMuted] = useState(false);
  const [messages, setMessages] = useState<Transcript[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [searchConfigured, setSearchConfigured] = useState<boolean | null>(null);
  const [seconds, setSeconds] = useState(0);
  const resources = useRef<Resources | null>(null);
  const nextId = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const selectedModel = models.find((item) => item.id === model)!;
  const active = status !== 'offline';

  useEffect(() => {
    fetch('/api/health').then((response) => response.json()).then((data: { configured: boolean; searchConfigured: boolean }) => {
      setConfigured(data.configured);
      setSearchConfigured(data.searchConfigured);
    }).catch(() => { setConfigured(null); setSearchConfigured(null); });
    return () => { cleanup(); };
  }, []);

  useEffect(() => {
    if (!active || status === 'connecting') return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active, status === 'connecting']);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages]);

  function cleanup() {
    const current = resources.current;
    resources.current = null;
    if (!current) return;
    if (current.timer) window.clearTimeout(current.timer);
    current.playback?.clear();
    current.worklet?.disconnect();
    current.source?.disconnect();
    current.silent?.disconnect();
    current.stream?.getTracks().forEach((track) => track.stop());
    if (current.socket && current.socket.readyState < WebSocket.CLOSING) current.socket.close();
    if (current.context && current.context.state !== 'closed') void current.context.close();
  }

  function endSession(message?: string) {
    cleanup();
    setStatus('offline');
    setMuted(false);
    if (message) setError(message);
  }

  function addTranscript(event: Extract<ServerMessage, { type: 'transcript' }>) {
    setMessages((previous) => {
      const last = previous[previous.length - 1];
      if (last && last.speaker === event.speaker && !last.finished) {
        return [...previous.slice(0, -1), { ...last, text: last.text + event.text, finished: event.finished }];
      }
      return [...previous, { id: nextId.current++, speaker: event.speaker, text: event.text, finished: event.finished }];
    });
  }

  async function connect() {
    if (resources.current) return;
    const current: Resources = { muted: false, ready: false };
    resources.current = current;
    setMessages([]);
    setError('');
    setNotice('');
    setSeconds(0);
    setStatus('connecting');
    try {
      current.context = new AudioContext();
      await current.context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (resources.current !== current) { stream.getTracks().forEach((track) => track.stop()); return; }
      current.stream = stream;
      await current.context.audioWorklet.addModule('/audio-capture.js');
      if (resources.current !== current) return;
      current.playback = new AudioPlayback(current.context, (playing) => {
        if (resources.current === current && current.ready) setStatus(playing ? 'speaking' : 'listening');
      });
      current.source = current.context.createMediaStreamSource(stream);
      current.worklet = new AudioWorkletNode(current.context, 'audio-capture');
      current.silent = current.context.createGain();
      current.silent.gain.value = 0;
      current.source.connect(current.worklet).connect(current.silent).connect(current.context.destination);
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`);
      current.socket = socket;
      current.timer = window.setTimeout(() => { if (resources.current === current && !current.ready) endSession('Connection timed out. Check the server and try again.'); }, 20000);
      current.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (resources.current !== current || !current.ready || current.muted || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 1024 * 1024) return endSession('Audio connection is overloaded. Please reconnect.');
        socket.send(JSON.stringify({ type: 'audio', data: encodeAudio(event.data), sampleRate: current.context!.sampleRate }));
      };
      socket.onopen = () => { if (resources.current === current) socket.send(JSON.stringify({ type: 'start', model })); };
      socket.onmessage = (event) => {
        if (resources.current !== current) return;
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          switch (message.type) {
            case 'ready':
              current.ready = true;
              if (current.timer) window.clearTimeout(current.timer);
              setStatus('listening');
              break;
            case 'audio': current.playback?.enqueue(message.data); break;
            case 'interrupted':
              current.playback?.clear();
              setMessages((previous) => previous.map((item, index) => index === previous.length - 1 ? { ...item, finished: true } : item));
              break;
            case 'transcript': addTranscript(message); break;
            case 'turn-complete':
              setMessages((previous) => previous.map((item, index) => index === previous.length - 1 ? { ...item, finished: true } : item));
              break;
            case 'notice': setNotice(message.message); break;
            case 'error': endSession(message.message); break;
          }
        } catch { endSession('Could not process the audio stream. Please reconnect.'); }
      };
      socket.onerror = () => { if (resources.current === current) endSession('Could not reach the local voice server.'); };
      socket.onclose = () => { if (resources.current === current) endSession('The session ended. Connect again to start a new conversation.'); };
    } catch (reason) {
      if (resources.current !== current) return;
      const message = reason instanceof DOMException && (reason.name === 'NotAllowedError' || reason.name === 'SecurityError')
        ? 'Microphone access was denied. Allow microphone access in your browser and try again.'
        : 'Could not start the microphone. Check your device and browser permissions.';
      endSession(message);
    }
  }

  function toggleMute() {
    const current = resources.current;
    if (!current?.ready || !current.socket) return;
    current.muted = !current.muted;
    setMuted(current.muted);
    if (current.muted && current.socket.readyState === WebSocket.OPEN) current.socket.send(JSON.stringify({ type: 'audio-end' }));
  }

  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return <div className="app-shell">
    <aside className="rail" aria-label="Application navigation">
      <div className="brand-mark"><AudioLines size={23} strokeWidth={2.2} /></div>
      <div className="rail-item" title="Voice studio" aria-label="Voice studio"><Mic size={19} /></div>
      <div className="rail-bottom"><span className="rail-dot" /><span>LOCAL</span></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="brand-name">voice<span> / </span>studio</div><div className="topbar-right"><span className="local-indicator"><span /> Local workspace</span><div className="avatar">VS</div></div></header>
      <main className="main">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR WORKSPACE <span className="eyebrow-slash">/</span> VOICE</div><h1>Voice studio<span className="heading-period">.</span></h1><p>A little more conversation, a little less typing.</p></div><div className="session-tag"><Radio size={14} /> LIVE AUDIO</div></div>
        <div className="workspace">
          <section className="conversation" aria-label="Voice conversation">
            <div className="section-header"><div><span className="section-index">01</span><span className="section-title">Live session</span></div><span className={`status-pill ${status}`}><span />{statusLabels[status]}</span></div>
            <div className="stage">
              <div className="stage-top"><span>VOICE CHANNEL</span><span>{active && status !== 'connecting' ? elapsed : '00:00'}</span></div>
              <div className={`sound-visual ${status}`} aria-hidden="true"><div className="sound-ring ring-one" /><div className="sound-ring ring-two" /><div className="sound-core"><AudioLines size={48} strokeWidth={1.4} /></div><div className="wave wave-left"><i /><i /><i /><i /><i /><i /><i /></div><div className="wave wave-right"><i /><i /><i /><i /><i /><i /><i /></div></div>
              <div className="stage-copy"><div className="stage-label">{status === 'offline' ? 'READY WHEN YOU ARE' : status === 'connecting' ? 'GETTING THINGS READY' : muted ? 'MICROPHONE MUTED' : status === 'speaking' ? 'YOUR ASSISTANT IS SPEAKING' : 'YOUR ASSISTANT IS LISTENING'}</div><h2>{status === 'offline' ? 'Let’s talk.' : status === 'connecting' ? 'Connecting...' : muted ? 'Mic is muted' : status === 'speaking' ? 'Speaking with you' : 'I’m listening'}</h2><p>{status === 'offline' ? 'Start a session to begin.' : status === 'connecting' ? 'Opening your voice channel.' : muted ? 'Unmute to continue the conversation.' : 'Speak naturally, at your own pace.'}</p></div>
              <div className="controls">{!active ? <button className="primary-button" onClick={() => void connect()}><Mic size={18} /> Start conversation <span className="button-arrow">↗</span></button> : <button className={`icon-button ${muted ? 'is-muted' : ''}`} onClick={toggleMute} disabled={status === 'connecting'} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} title={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? <MicOff size={20} /> : <Mic size={20} />}</button>}<button className="end-button" onClick={() => endSession()} disabled={!active}><PhoneOff size={18} /> End session</button></div>
              <div className="stage-footer"><span><span className="tiny-dot" /> {active ? 'SESSION ACTIVE' : 'STANDING BY'}</span><span><Volume2 size={14} /> AUDIO ENABLED</span></div>
            </div>
            {(error || notice || configured === false) && <div className={`alert ${error ? 'alert-error' : ''}`} role="status"><CircleAlert size={17} /><span>{error || notice || 'Add your Gemini API key to the local .env file to connect.'}</span></div>}
            <div className="transcript-header"><div><span className="section-index">02</span><span className="section-title">Transcript</span><span className="transcript-count">{messages.length}</span></div><span className="transcript-live"><span /> {active ? 'LIVE' : 'SESSION ONLY'}</span></div>
            <div className="transcript" aria-live="polite" aria-label="Conversation transcript">{messages.length === 0 ? <div className="transcript-empty"><div className="empty-icon"><AudioLines size={20} /></div><div><strong>Your conversation will appear here</strong><p>Once you start talking, follow along in real time.</p></div></div> : messages.map((message) => <div className="message" key={message.id}><div className={`message-avatar ${message.speaker}`}>{message.speaker === 'assistant' ? <Sparkles size={15} /> : 'Y'}</div><div><div className="message-name">{message.speaker === 'assistant' ? 'Assistant' : 'You'}</div><p>{message.text}</p></div></div>)}<div ref={transcriptEnd} /></div>
          </section>
          <aside className="settings" aria-label="Session settings"><div className="settings-header"><span className="section-index">03</span><span className="section-title">Session settings</span></div><div className="settings-content"><div className="field-label"><span>AI MODEL</span><span className="field-number">01</span></div><label className="select-wrap"><span className="sr-only">AI model</span><select value={model} disabled={active} onChange={(event) => setModel(event.target.value as ModelId)}>{models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><ChevronDown size={16} /></label><p className="field-hint">{selectedModel.description}</p><div className="divider" /><div className="field-label"><span>SESSION DETAILS</span><span className="field-number">02</span></div><div className="detail-row"><span>Voice model</span><strong><span className="provider-mark">✳</span> Google Gemini</strong></div><div className="detail-row"><span>Web search</span><strong><Search size={14} /> {searchConfigured ? 'Tavily' : 'Not configured'}</strong></div><div className="detail-row"><span>Input</span><strong><Mic size={14} /> Microphone</strong></div><div className="detail-row"><span>Output</span><strong><Headphones size={14} /> Audio</strong></div><div className="detail-row"><span>Interruptions</span><strong><Check size={14} className="green-icon" /> Enabled</strong></div><div className="divider" /><div className="info-block"><div className="info-icon"><Activity size={17} /></div><div><strong>Session privacy</strong><p>Audio is sent to Gemini; search queries go to Tavily. Transcripts are not saved.</p></div></div></div><div className="settings-bottom"><span><Square size={9} fill="currentColor" /> PRIVATE SESSION</span><ArrowDown size={15} /></div></aside>
        </div>
        <footer className="page-footer"><span>VOICE STUDIO <span className="footer-separator">/</span> A SPACE TO THINK OUT LOUD</span><span>POWERED BY GEMINI LIVE</span></footer>
      </main>
    </div>
  </div>;
}