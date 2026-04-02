/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, ChangeEvent } from 'react';
import { Peer, DataConnection, MediaConnection } from 'peerjs';
import { Mic, MicOff, Hand, Video, Send, X, LogIn, Shield, FileUp, Radio, User, Key, Settings } from 'lucide-react';

interface Student {
  id: string;
  name: string;
  hand: boolean;
}

interface ChatMessage {
  text: string;
  type: 'moi' | 'dist' | 'sys';
  sender?: string;
}

interface PeerData {
  type: 'HANDSHAKE' | 'HAND_RAISE' | 'HAND_DOWN' | 'PPT_ON' | 'PPT_OFF' | 'CMD_MUTE' | 'CMD_KICK';
  name?: string;
  peerId?: string;
  url?: string;
}

export default function App() {
  const [userName, setUserName] = useState<string>("");
  const [personalId, setPersonalId] = useState<string>("");
  const [personalModCode, setPersonalModCode] = useState<string>(() => localStorage.getItem('smart_classroom_mod_code') || "");
  const [isJoined, setIsJoined] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [splashFade, setSplashFade] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempSessionId, setTempSessionId] = useState("");
  const [tempModCode, setTempModCode] = useState("");
  const [peerId, setPeerId] = useState<string>("EN ATTENTE...");
  const [isProfessor, setIsProfessor] = useState(false);
  const [status, setStatus] = useState<'offline' | 'online'>('offline');
  const [targetId, setTargetId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [connectedStudents, setConnectedStudents] = useState<Student[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [pptUrl, setPptUrl] = useState<string | null>(null);
  const [openWindows, setOpenWindows] = useState<{ id: string; name: string }[]>([]);
  const [windowOffset, setWindowOffset] = useState(0);
  const [showModModal, setShowModModal] = useState(false);
  const [modCode, setModCode] = useState("");
  const [modError, setModError] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeConnectionsRef = useRef<DataConnection[]>([]);
  const studentStreamsRef = useRef<{ [key: string]: MediaStream }>({});
  const chatBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Kora sound is handled by the <audio> element in the DOM
    return () => {
      peerRef.current?.destroy();
      localStreamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const playKora = () => {
    if (audioRef.current) {
      audioRef.current.volume = 1.0;
      audioRef.current.play().then(() => {
        console.log("Audio playing successfully");
      }).catch(e => {
        console.error("Audio play blocked or failed:", e);
      });
    }
  };

  const startApp = () => {
    playKora();
    setSplashFade(true);
    setTimeout(() => {
      setShowSplash(false);
    }, 1000);
  };

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleJoin = async () => {
    if (!userName.trim()) return alert("Veuillez entrer votre nom.");
    // Ensure audio stops when entering the classroom to avoid noise during call
    audioRef.current?.pause();
    setIsJoined(true);
    await init(userName);
  };

  const init = async (name: string, customId?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const monID = customId || (personalId.trim() ? (personalId.startsWith("SMART-") ? personalId : "SMART-" + personalId) : ("SMART-" + Math.random().toString(36).substring(2, 6).toUpperCase()));
      setPersonalId(monID);

      const peer = new Peer(monID, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
          ]
        }
      });
      peerRef.current = peer;

      peer.on('open', id => {
        console.log("ID Professionnel généré : " + id);
        setPeerId(id);
        setStatus('online');
      });

      peer.on('disconnected', () => {
        console.log("Connexion au serveur PeerJS perdue. Reconnexion...");
        peer.reconnect();
      });

      peer.on('connection', conn => {
        setupData(conn, name);
      });

      peer.on('call', call => {
        console.log("Réception d'un appel entrant...");
        call.answer(localStreamRef.current!);

        call.on('stream', remoteStream => {
          if (!isProfessor) {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
              remoteVideoRef.current.play();
            }
          } else {
            studentStreamsRef.current[call.peer] = remoteStream;
            setConnectedStudents(prev => [...prev]); // Trigger re-render
          }
        });
      });

      peer.on('error', err => {
        console.error("Type d'erreur PeerJS :", err.type);
        if (err.type === 'peer-unavailable') {
          alert("Impossible de joindre ce cours. Vérifiez l'ID.");
        }
      });

    } catch (e) {
      alert("Accès Caméra/Micro refusé ou erreur d'initialisation. Vérifiez les permissions.");
      console.error(e);
      setIsJoined(false);
    }
  };

  const setupData = (conn: DataConnection, currentUserName: string) => {
    if (!activeConnectionsRef.current.find(c => c.peer === conn.peer)) {
      activeConnectionsRef.current.push(conn);
    }

    conn.on('open', () => {
      try {
        // Ensure we only send a plain object with serializable values
        conn.send({ 
          type: "HANDSHAKE", 
          name: String(currentUserName) 
        });
      } catch (err) {
        console.error("Erreur lors de l'envoi du handshake:", err);
      }
    });

    conn.on('data', (data: any) => {
      const peerData = data as PeerData;
      if (peerData.type === "HANDSHAKE") {
        setConnectedStudents(prev => {
          if (!prev.find(s => s.id === conn.peer)) {
            return [...prev, { id: conn.peer, name: peerData.name || "Inconnu", hand: false }];
          }
          return prev;
        });
      } else if (peerData.type === "HAND_RAISE") {
        setConnectedStudents(prev => prev.map(s => s.id === peerData.peerId ? { ...s, hand: true } : s));
        addChat(`Système: ${peerData.name} veut parler.`, 'sys');
      } else if (peerData.type === "HAND_DOWN") {
        setConnectedStudents(prev => prev.map(s => s.id === peerData.peerId ? { ...s, hand: false } : s));
        fermerFenetre(peerData.peerId!);
      } else if (peerData.type === "PPT_ON") {
        setPptUrl(peerData.url || null);
      } else if (peerData.type === "PPT_OFF") {
        setPptUrl(null);
      } else if (peerData.type === "CMD_MUTE") {
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks()[0].enabled = false;
          setIsMicOn(false);
        }
      } else if (peerData.type === "CMD_KICK") {
        window.location.reload();
      } else if (typeof data === "string") {
        addChat(data, 'dist');
      }
    });

    conn.on('close', () => {
      activeConnectionsRef.current = activeConnectionsRef.current.filter(c => c.peer !== conn.peer);
      setConnectedStudents(prev => prev.filter(s => s.id !== conn.peer));
      fermerFenetre(conn.peer);
    });
  };

  const rejoindreCours = () => {
    const profId = targetId.trim();
    if (!profId) return alert("Veuillez entrer l'ID SMART-XXXX du professeur");
    if (!peerRef.current) return;

    console.log("Tentative de poignée de main avec : " + profId);

    const conn = peerRef.current.connect(profId, { reliable: true });
    setupData(conn, userName);

    const call = peerRef.current.call(profId, localStreamRef.current!);
    call.on('stream', stream => {
      console.log("Flux vidéo reçu avec succès !");
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.onloadedmetadata = () => {
          remoteVideoRef.current?.play();
        };
      }
    });
  };

  const checkModCode = () => {
    if (modCode === "BBA2026" || (personalModCode.trim() && modCode === personalModCode)) {
      setIsProfessor(true);
      setShowModModal(false);
      setModCode(""); // Reset input
      setModError(false);
      if (remoteVideoRef.current && localStreamRef.current) {
        remoteVideoRef.current.srcObject = localStreamRef.current;
      }
    } else {
      setModError(true);
      setTimeout(() => setModError(false), 3000);
    }
  };

  const updateSessionSettings = () => {
    const formattedId = tempSessionId.trim() ? (tempSessionId.toUpperCase().startsWith("SMART-") ? tempSessionId.toUpperCase() : "SMART-" + tempSessionId.toUpperCase()) : personalId;
    
    setPersonalId(formattedId);
    setPersonalModCode(tempModCode);
    localStorage.setItem('smart_classroom_mod_code', tempModCode);
    
    if (formattedId !== peerId) {
      peerRef.current?.destroy();
      init(userName, formattedId);
    }
    
    setShowSettingsModal(false);
  };

  const openSettings = () => {
    setTempSessionId(personalId.replace("SMART-", ""));
    setTempModCode(personalModCode);
    setShowSettingsModal(true);
  };

  const leverMain = () => {
    const newHandState = !handRaised;
    setHandRaised(newHandState);
    const currentPeerId = peerRef.current?.id || "";
    activeConnectionsRef.current.forEach(c => {
      try {
        // Ensure we only send a plain object with serializable values
        c.send({
          type: newHandState ? "HAND_RAISE" : "HAND_DOWN",
          name: String(userName),
          peerId: String(currentPeerId)
        });
      } catch (err) {
        console.error("Erreur lors de l'envoi du signal de main levée:", err);
      }
    });
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const enabled = !isMicOn;
      localStreamRef.current.getAudioTracks()[0].enabled = enabled;
      setIsMicOn(enabled);
    }
  };

  const toggleRecord = () => {
    setIsRecording(!isRecording);
  };

  const envoyerMessage = () => {
    if (!chatInput.trim()) return;
    const message = `${userName}: ${chatInput}`;
    activeConnectionsRef.current.forEach(c => {
      try {
        c.send(String(message));
      } catch (err) {
        console.error("Erreur lors de l'envoi du message chat:", err);
      }
    });
    addChat(chatInput, 'moi', userName);
    setChatInput("");
  };

  const addChat = (text: string, type: ChatMessage['type'], sender?: string) => {
    setChatMessages(prev => [...prev, { text, type, sender }]);
  };

  const adminAction = (id: string, type: PeerData['type']) => {
    const conn = activeConnectionsRef.current.find(c => c.peer === id);
    if (conn) {
      try {
        // Ensure we only send a plain object with serializable values
        conn.send({ type: String(type) });
      } catch (err) {
        console.error("Erreur action admin:", err);
      }
    }
  };

  const accepterEtudiant = (id: string, name: string) => {
    if (!studentStreamsRef.current[id]) {
      alert("Le flux vidéo de l'étudiant n'est pas encore disponible.");
      return;
    }
    if (openWindows.find(w => w.id === id)) return;

    setOpenWindows(prev => [...prev, { id, name }]);
    setWindowOffset(prev => (prev + 40) % 200);
  };

  const fermerFenetre = (id: string) => {
    setOpenWindows(prev => prev.filter(w => w.id !== id));
  };

  const partagerDocument = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      setPptUrl(url);
      activeConnectionsRef.current.forEach(c => {
        try {
          // Ensure we only send a plain object with serializable values
          c.send({ 
            type: "PPT_ON", 
            url: String(url) 
          });
        } catch (err) {
          console.error("Erreur lors de l'envoi du document:", err);
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const fermerDocument = () => {
    setPptUrl(null);
    activeConnectionsRef.current.forEach(c => {
      try {
        c.send({ type: "PPT_OFF" });
      } catch (err) {
        console.error("Erreur fermeture document:", err);
      }
    });
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white overflow-hidden font-sans selection:bg-blue-500/30">
      <audio 
        ref={audioRef}
        loop
        crossOrigin="anonymous"
        onCanPlayThrough={() => {
          console.log("Audio can play through");
          setAudioLoaded(true);
        }}
        onError={(e) => {
          console.error("Audio error event:", e);
          if (audioRef.current && audioRef.current.src !== "https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3") {
            console.log("Switching to fallback audio...");
            audioRef.current.src = "https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3";
            audioRef.current.load();
          }
        }}
      >
        <source src="https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a1b5a5.mp3" type="audio/mpeg" />
      </audio>

      {showSplash ? (
        <div className={`fixed inset-0 z-[200] bg-black flex items-center justify-center transition-opacity duration-1000 ${splashFade ? 'opacity-0' : 'opacity-100'}`}>
          <div className="text-center px-4">
            <img 
              src="https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?q=80&w=1920&auto=format&fit=crop" 
              alt="Smart Classroom African Collaboration" 
              className="w-full max-w-4xl rounded-3xl shadow-2xl border border-white/10 mb-8 object-cover aspect-video"
              referrerPolicy="no-referrer"
            />
            <h1 className="text-blue-500 font-extrabold text-5xl md:text-7xl tracking-tighter italic mb-2">Smart Classroom</h1>
            <p className="text-gray-500 text-sm font-bold uppercase tracking-[0.5em] mb-8">L'excellence au cœur de l'Afrique</p>
            
            <div className="mt-8 flex flex-col items-center gap-6">
              <button 
                onClick={startApp}
                className="bg-blue-600 hover:bg-blue-500 text-white px-16 py-5 rounded-full font-black text-xl uppercase tracking-widest transition-all shadow-2xl shadow-blue-900/40 animate-bounce flex items-center gap-3"
              >
                <LogIn className="w-6 h-6" />
                Commencer
              </button>
              
              <button 
                onClick={playKora}
                className="text-[10px] text-blue-400/50 hover:text-blue-400 font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
              >
                <Radio className={`w-3 h-3 ${audioLoaded ? 'animate-pulse' : 'animate-spin'}`} />
                {audioLoaded ? 'Tester le son (Kora) 🎵' : 'Chargement du son...'}
              </button>
            </div>
          </div>
        </div>
      ) : !isJoined ? (
        <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
          <div className="glass-panel p-8 rounded-3xl w-full max-w-md border border-white/10 shadow-2xl">
            <div className="text-center mb-8">
              <span className="text-blue-500 font-extrabold text-4xl tracking-tighter italic">Smart Classroom</span>
              <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-2">Elite Edition v21</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Votre Identité</label>
                <div className="relative flex items-center">
                  <User className="absolute left-4 w-5 h-5 text-gray-500" />
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Nom et Prénom"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-5 py-4 text-sm outline-none focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <button
                onClick={handleJoin}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all shadow-lg shadow-blue-900/40"
              >
                Démarrer la Session
              </button>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 text-center">
              <p className="text-[9px] text-gray-600 font-bold uppercase tracking-widest leading-relaxed">
                Plateforme de visioconférence sécurisée<br/>pour l'excellence académique
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-gray-200 min-h-screen flex flex-col overflow-hidden bg-[#050505]">
      {/* Modal Réglages */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-8 rounded-3xl w-full max-w-sm border border-white/10 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center">
                <Settings className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Réglages Session</h2>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest">Configuration Professeur</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">ID de Session (ex: MATHS)</label>
                <input
                  type="text"
                  value={tempSessionId}
                  onChange={(e) => setTempSessionId(e.target.value.toUpperCase())}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500 transition-all"
                  placeholder="MATHS"
                />
                <p className="text-[8px] text-gray-600 mt-2 italic">L'ID final sera SMART-{tempSessionId || '...'}</p>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Code Modérateur Personnel</label>
                <input
                  type="password"
                  value={tempModCode}
                  onChange={(e) => setTempModCode(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500 transition-all"
                  placeholder="Votre code secret"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl font-bold text-xs uppercase transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={updateSessionSettings}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-bold text-xs uppercase transition-all shadow-lg shadow-blue-900/20"
                >
                  Appliquer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Moderator Modal */}
      {showModModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="glass-panel p-8 rounded-3xl w-full max-w-xs border border-white/10 shadow-2xl">
            <h3 className="text-xs font-black text-blue-500 uppercase tracking-widest mb-6 text-center">Accès Modérateur</h3>
            <div className="relative flex items-center mb-2">
              <Key className="absolute left-4 w-5 h-5 text-gray-500" />
              <input
                type="password"
                value={modCode}
                onChange={(e) => {
                  setModCode(e.target.value);
                  setModError(false);
                }}
                placeholder="Code d'accès"
                className={`w-full bg-white/5 border ${modError ? 'border-red-500' : 'border-white/10'} rounded-2xl pl-12 pr-5 py-4 text-sm outline-none focus:border-blue-500 transition-all`}
              />
            </div>
            {modError && (
              <p className="text-[10px] text-red-500 font-bold text-center mb-4 animate-bounce">
                Code incorrect, vous vous êtes trompé !
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setShowModModal(false)} className="flex-1 bg-white/5 py-3 rounded-xl text-xs font-bold uppercase">Annuler</button>
              <button onClick={checkModCode} className="flex-1 bg-blue-600 py-3 rounded-xl text-xs font-bold uppercase">Valider</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="h-20 bg-black/80 border-b border-white/5 flex items-center justify-between px-8 z-50 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-blue-500 font-extrabold text-2xl tracking-tighter italic">Smart Classroom</span>
            <span className="text-[10px] text-gray-500 font-bold tracking-[0.2em] uppercase">Elite Edition</span>
          </div>

          <div className="h-10 w-[1px] bg-white/10 mx-2"></div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${status === 'online' ? 'bg-green-500 status-pulse' : 'bg-gray-600'}`}></div>
              <span className="text-sm font-semibold text-white">{userName}</span>
            </div>
            <span className="text-[11px] text-blue-400/80 font-mono">ID: {peerId}</span>
          </div>
        </div>

        <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10">
          <input
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Code de session..."
            className="bg-transparent px-4 py-2 text-sm w-48 outline-none placeholder:text-gray-600 font-medium"
          />
          <button
            onClick={rejoindreCours}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl text-xs font-bold uppercase transition-all shadow-lg shadow-blue-900/40"
          >
            Rejoindre
          </button>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={leverMain}
            className={`p-2.5 rounded-xl border transition-colors group ${handRaised ? 'bg-orange-600 border-orange-500' : 'bg-white/5 border-white/10 hover:border-orange-500'}`}
          >
            <Hand className={`w-5 h-5 ${handRaised ? 'text-white' : 'text-orange-500'}`} />
          </button>
          <button
            onClick={toggleMic}
            className={`${isMicOn ? 'bg-blue-600/10 border-blue-500/50 text-blue-400' : 'bg-red-600/10 border-red-500/50 text-red-400'} border px-4 py-2.5 rounded-xl text-xs font-bold hover:bg-opacity-20 transition-all flex items-center gap-2`}
          >
            {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            MICRO {isMicOn ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={toggleRecord}
            className={`${isRecording ? 'bg-red-600 border-red-500 text-white' : 'bg-red-600/10 border-red-500/30 text-red-500'} border px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2`}
          >
            <Radio className={`w-4 h-4 ${isRecording ? 'animate-pulse' : ''}`} />
            {isRecording ? 'STOP' : 'REC'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex relative overflow-hidden">
        <section className="flex-1 relative bg-black flex items-center justify-center">
          {/* Whiteboard / PPT */}
          {pptUrl && (
            <div id="whiteboard">
              <div className="h-12 bg-white border-b border-gray-200 flex items-center px-6 justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
                  <span className="text-xs text-gray-800 font-bold uppercase tracking-wider">Projection en direct</span>
                </div>
                {isProfessor && (
                  <button onClick={fermerDocument} className="text-gray-400 hover:text-red-500 font-bold transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                )}
              </div>
              <div className="flex-1 relative overflow-hidden">
                <iframe src={pptUrl} className="w-full h-full border-none"></iframe>
                {/* Non-interactive overlay for students */}
                {!isProfessor && (
                  <div className="absolute inset-0 z-10 bg-transparent cursor-default"></div>
                )}
              </div>
            </div>
          )}

          {/* Remote Video */}
          <div className="w-full h-full flex items-center justify-center">
            <video ref={remoteVideoRef} className="opacity-90 w-full h-full object-cover" autoPlay playsInline></video>
            {!remoteVideoRef.current?.srcObject && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-600 flex-col gap-4">
                <Video className="w-16 h-16 opacity-20" />
                <span className="text-sm font-medium uppercase tracking-widest opacity-40">En attente de diffusion...</span>
              </div>
            )}
          </div>

          {/* Local Video Wrapper */}
          {!isProfessor && (
            <div id="local-wrapper">
              <video ref={localVideoRef} muted autoPlay playsInline></video>
            </div>
          )}

          {/* Floating Student Windows (Professor Only) */}
          {isProfessor && openWindows.map((win, idx) => (
            <div
              key={win.id}
              className="student-window"
              style={{
                top: `${50 + (idx * 40) % 200}px`,
                left: `${50 + (idx * 40) % 200}px`,
              }}
            >
              <div className="bg-orange-600 px-3 py-1 flex justify-between items-center cursor-move">
                <span className="text-[10px] font-black uppercase text-white">{win.name}</span>
                <button onClick={() => fermerFenetre(win.id)} className="text-white font-bold transition">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <video
                autoPlay
                playsInline
                className="bg-black"
                ref={el => {
                  if (el && studentStreamsRef.current[win.id]) {
                    el.srcObject = studentStreamsRef.current[win.id];
                  }
                }}
              ></video>
            </div>
          ))}
        </section>

        {/* Sidebar */}
        <aside className="w-80 bg-gray-950 border-l border-white/5 flex flex-col shadow-2xl z-50">
          {isProfessor && (
            <div id="admin-panel" className="flex flex-col border-b border-white/5">
              <div className="p-6">
                <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em] mb-4">Gestion du Cours</h3>
                <div className="flex flex-col gap-3 mb-6">
                  <button
                    onClick={openSettings}
                    className="w-full bg-white/5 border border-white/10 py-3 rounded-xl font-bold text-[10px] uppercase hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                  >
                    <Settings className="w-3 h-3 text-blue-500" />
                    Réglages
                  </button>
                  <button
                    onClick={() => document.getElementById('file-input')?.click()}
                    className="w-full bg-gradient-to-r from-blue-600 to-blue-800 py-4 rounded-2xl font-bold text-xs uppercase shadow-xl shadow-blue-900/30 transition-all flex items-center justify-center gap-2"
                  >
                    <FileUp className="w-4 h-4" />
                    Diffuser un Document
                  </button>
                </div>
                <input type="file" id="file-input" className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx" onChange={partagerDocument} />

                <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em] mb-4">Étudiants Actifs ({connectedStudents.length})</h3>
                <div id="student-list" className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                  {connectedStudents.map(s => (
                    <div key={s.id} className={`bg-gray-800 p-3 rounded-xl border-l-4 ${s.hand ? 'border-orange-500' : 'border-blue-500'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-white">{s.name}</span>
                        {s.hand && <span className="text-orange-500 text-[10px] font-black animate-pulse">MAIN LEVÉE</span>}
                      </div>
                      <div className="flex flex-col gap-2">
                        {s.hand && (
                          <button
                            onClick={() => accepterEtudiant(s.id, s.name)}
                            className="bg-green-600 py-1.5 rounded text-[10px] font-bold hover:bg-green-500 transition-colors"
                          >
                            Ouvrir Vidéo
                          </button>
                        )}
                        <div className="flex gap-1">
                          <button onClick={() => adminAction(s.id, 'CMD_MUTE')} className="flex-1 bg-gray-700 py-1 rounded text-[9px] hover:bg-orange-700 transition-colors">MUTE</button>
                          <button onClick={() => adminAction(s.id, 'CMD_KICK')} className="flex-1 bg-gray-700 py-1 rounded text-[9px] hover:bg-red-700 transition-colors">KICK</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {connectedStudents.length === 0 && (
                    <div className="text-center py-8 text-gray-600 text-[10px] font-bold uppercase tracking-widest">Aucun étudiant</div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div id="chat-ui" className="flex-1 flex flex-col min-h-0">
            <div className="px-6 py-4 border-b border-white/5 bg-black/20">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Conversation</span>
            </div>
            <div ref={chatBoxRef} className="flex-1 p-6 overflow-y-auto space-y-4">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`${msg.type === 'moi' ? "bg-blue-600 ml-auto" : msg.type === 'sys' ? "text-orange-400 text-center text-[9px]" : "bg-gray-800"} p-2 rounded-lg max-w-[80%] text-xs`}
                >
                  {msg.type !== 'sys' && <div className="font-bold text-[10px] opacity-60 mb-1">{msg.sender || (msg.type === 'moi' ? 'Moi' : 'Étudiant')}</div>}
                  {msg.text}
                </div>
              ))}
            </div>
            <div className="p-6 bg-black/40">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && envoyerMessage()}
                  placeholder="Dire quelque chose..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                />
                <button onClick={envoyerMessage} className="absolute right-4 text-blue-500 hover:text-blue-400 transition-colors">
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="h-10 bg-black border-t border-white/5 flex items-center justify-between px-8">
        <div className="flex items-center gap-4">
          <span className="text-[9px] text-gray-600 font-bold italic tracking-wider">PROJET SMART CLASSROOM &copy; 2026</span>
          <span className="text-[9px] text-blue-900 font-black">|</span>
          <span className="text-[9px] text-gray-500 font-bold uppercase">Développeur : Abdoulaye Issa Dessoh</span>
        </div>
        {!isProfessor && (
          <button onClick={() => setShowModModal(true)} className="text-[9px] text-gray-600 hover:text-blue-500 font-black tracking-widest transition-colors flex items-center gap-1">
            <Shield className="w-3 h-3" />
            MODÉRATEUR
          </button>
        )}
        {isProfessor && (
          <div className="text-[9px] text-blue-500 font-black tracking-widest uppercase flex items-center gap-1">
            <Shield className="w-3 h-3" />
            MODE PROFESSEUR ACTIF
          </div>
        )}
      </footer>
    </div>
  )}
</div>
  );
}
