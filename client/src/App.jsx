import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { 
  Phone, Video, Send, Search, User, LogOut, 
  Menu, X, Smile, MoreVertical, Check, CheckCheck 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EmojiPicker from 'emoji-picker-react';

const socket = io();

// Simple notification sound (Base64)
const NOTIFICATION_SOUND = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//uQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWgAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//uQZAAAAAAAIAAAAAAREALgAAAAAAIAAAAAAREALgAAABBAAAAgEAF//uQZAAAAAAAIAAAAAAREALgAAAAAAIAAAAAAREALgAAABBAAAAgEAF//uQZAAAAAAAIAAAAAAREALgAAAAAAIAAAAAAREALgAAABBAAAAgEAF"; 

function App() {
  // --- STATE ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [me, setMe] = useState(null);

  const [chats, setChats] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState(new Set()); // Set of userIds who are typing to me
  
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [inputMessage, setInputMessage] = useState("");

  // WebRTC
  const [stream, setStream] = useState(null);
  const [receivingCall, setReceivingCall] = useState(false);
  const [caller, setCaller] = useState("");
  const [callerSignal, setCallerSignal] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [callerName, setCallerName] = useState("");
  const [callStatus, setCallStatus] = useState("");
  const [isVideoCall, setIsVideoCall] = useState(true);

  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const notificationAudio = useRef(new Audio(NOTIFICATION_SOUND));

  // --- EFFECTS ---

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedUser, typingUsers]);

  // Auth & Socket Listeners
  useEffect(() => {
    const savedUser = localStorage.getItem('messenger_user');
    const savedPass = localStorage.getItem('messenger_pass');
    if (savedUser && savedPass) {
      setUsername(savedUser);
      setPassword(savedPass);
      if (socket.connected) socket.emit('login', { username: savedUser, password: savedPass });
      else socket.once('connect', () => socket.emit('login', { username: savedUser, password: savedPass }));
    }

    socket.on('login_success', (userData) => {
      setIsLoggedIn(true);
      setMe(userData);
      localStorage.setItem('messenger_user', username);
      localStorage.setItem('messenger_pass', password);
    });

    socket.on('login_error', (msg) => {
        setAuthError(msg);
        if (msg === "Invalid credentials") {
             localStorage.removeItem('messenger_user');
             localStorage.removeItem('messenger_pass');
        }
    });

    socket.on('register_success', () => {
        alert("Registration successful! Login now.");
        setIsRegistering(false);
    });
    
    socket.on('register_error', (msg) => setAuthError(msg));

    socket.on('recent_chats', (chatList) => setChats(chatList));
    socket.on('search_results', (results) => setSearchResults(results));
    
    socket.on('online_users', (ids) => setOnlineUsers(new Set(ids)));
    socket.on('user_status', ({ userId, status }) => {
        setOnlineUsers(prev => {
            const newSet = new Set(prev);
            if (status === 'online') newSet.add(userId);
            else newSet.delete(userId);
            return newSet;
        });
    });

    socket.on('history', ({ userId, messages: history }) => {
      setMessages(prev => ({ ...prev, [userId]: history }));
    });

    socket.on('private message', ({ content, fromUserId, username, timestamp }) => {
      setMessages(prev => {
        const userMsgs = prev[fromUserId] || [];
        return { ...prev, [fromUserId]: [...userMsgs, { content, from_user_id: fromUserId, created_at: timestamp }] };
      });
      
      setChats(prev => {
        if (!prev.find(c => c.id === fromUserId)) return [{ id: fromUserId, username }, ...prev];
        // Move to top
        const otherChats = prev.filter(c => c.id !== fromUserId);
        const currentChat = prev.find(c => c.id === fromUserId) || { id: fromUserId, username };
        return [currentChat, ...otherChats];
      });

      // Play sound if not in this chat or window blurred
      if (document.hidden || selectedUser?.id !== fromUserId) {
          // notificationAudio.current.play().catch(e => console.log("Audio play failed", e)); 
      }
    });

    socket.on('message_sent', ({ content, toUserId, timestamp }) => {
        setMessages(prev => {
            const userMsgs = prev[toUserId] || [];
            return { ...prev, [toUserId]: [...userMsgs, { content, from_user_id: me?.id, created_at: timestamp }] };
        });
    });

    // Typing
    socket.on('typing', ({ fromUserId }) => {
        setTypingUsers(prev => new Set(prev).add(fromUserId));
    });
    socket.on('stop_typing', ({ fromUserId }) => {
        setTypingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(fromUserId);
            return newSet;
        });
    });

    // Call
    socket.on("callUser", (data) => {
      setReceivingCall(true);
      setCaller(data.from);
      setCallerName(data.name);
      setCallerSignal(data.signal);
    });

    return () => {
        socket.off('login_success');
        socket.off('recent_chats');
        socket.off('private message');
        // ... cleanup
    };
  }, [username, password, me, selectedUser]);


  // --- HANDLERS ---

  const handleAuth = (e) => {
    e.preventDefault();
    if (isRegistering) socket.emit('register', { username, password });
    else socket.emit('login', { username, password });
  };

  const selectUser = (user) => {
    setSelectedUser(user);
    setSearchQuery("");
    setSearchResults([]);
    setShowChatOnMobile(true);
    socket.emit('get_history', user.id);
    
    if (!chats.find(c => c.id === user.id)) setChats([user, ...chats]);
  };

  const handleInput = (e) => {
      setInputMessage(e.target.value);
      
      if (selectedUser) {
          socket.emit('typing', { toUserId: selectedUser.id });
          
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          
          typingTimeoutRef.current = setTimeout(() => {
              socket.emit('stop_typing', { toUserId: selectedUser.id });
          }, 2000);
      }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedUser) return;
    socket.emit("private message", { content: inputMessage, toUserId: selectedUser.id });
    setInputMessage("");
    setShowEmojiPicker(false);
    socket.emit('stop_typing', { toUserId: selectedUser.id });
  };

  const onEmojiClick = (emojiObject) => {
      setInputMessage(prev => prev + emojiObject.emoji);
  };

  // --- WebRTC ---
  const startCall = async (video) => {
    setIsVideoCall(video);
    setCallStatus(video ? "Starting Video Call..." : "Calling...");
    try {
        const currentStream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
        setStream(currentStream);
        if (video && myVideo.current) myVideo.current.srcObject = currentStream;

        const peer = new SimplePeer({ initiator: true, trickle: false, stream: currentStream });
        
        peer.on("signal", (data) => {
            socket.emit("callUser", { userToCall: selectedUser.id, signalData: data, from: me.id, name: me.username });
        });
        peer.on("stream", (remoteStream) => { if (userVideo.current) userVideo.current.srcObject = remoteStream; });
        socket.on("callAccepted", (signal) => {
            setCallAccepted(true);
            setCallStatus("Connected");
            peer.signal(signal);
        });
        connectionRef.current = peer;
    } catch (err) {
        alert("Call failed: " + err.message);
        setCallStatus("");
    }
  };

  const answerCall = async () => {
    setCallAccepted(true);
    setCallStatus("Connecting...");
    try {
        const currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: false, audio: true }));
        setStream(currentStream);
        if (myVideo.current && currentStream.getVideoTracks().length > 0) myVideo.current.srcObject = currentStream;

        const peer = new SimplePeer({ initiator: false, trickle: false, stream: currentStream });
        peer.on("signal", (data) => socket.emit("answerCall", { signal: data, to: caller }));
        peer.on("stream", (remoteStream) => { if (userVideo.current) userVideo.current.srcObject = remoteStream; });
        peer.signal(callerSignal);
        connectionRef.current = peer;
    } catch (err) {
        alert("Error answering: " + err.message);
    }
  };

  const leaveCall = () => {
    setCallEnded(true);
    if (connectionRef.current) connectionRef.current.destroy();
    window.location.reload();
  };


  // --- RENDER ---

  if (!isLoggedIn) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-black flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white/10 backdrop-blur-lg border border-white/20 p-8 rounded-3xl shadow-2xl w-full max-w-md"
            >
                <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg transform rotate-12">
                        <Send className="text-white w-8 h-8 -rotate-12" />
                    </div>
                </div>
                <h2 className="text-3xl font-bold text-center text-white mb-2">Welcome Back</h2>
                <p className="text-slate-400 text-center mb-8">Enter your details to access your chats.</p>
                
                <form onSubmit={handleAuth} className="space-y-4">
                    <div className="relative">
                        <User className="absolute left-4 top-3.5 text-slate-400 w-5 h-5" />
                        <input className="w-full bg-slate-900/50 border border-slate-700 p-3 pl-12 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" 
                            placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
                    </div>
                    <div className="relative">
                        <div className="absolute left-4 top-3.5 text-slate-400 font-bold w-5 h-5 flex items-center justify-center">***</div>
                        <input className="w-full bg-slate-900/50 border border-slate-700 p-3 pl-12 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" 
                            type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
                    </div>
                    
                    <button className="w-full bg-gradient-to-r from-blue-600 to-purple-600 p-3.5 rounded-xl font-bold text-white shadow-lg hover:shadow-blue-500/30 transition transform hover:scale-[1.02] active:scale-95">
                        {isRegistering ? "Create Account" : "Sign In"}
                    </button>
                </form>
                
                <div className="mt-6 text-center">
                    <button onClick={()=>setIsRegistering(!isRegistering)} className="text-sm text-slate-400 hover:text-white transition underline decoration-slate-600 underline-offset-4">
                        {isRegistering ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
                    </button>
                </div>
                {authError && <div className="mt-4 text-red-400 text-center text-sm bg-red-500/10 p-2 rounded-lg border border-red-500/20">{authError}</div>}
            </motion.div>
        </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* SIDEBAR */}
      <AnimatePresence>
        <motion.div 
            className={`${showChatOnMobile ? 'hidden' : 'flex'} md:flex w-full md:w-[24rem] border-r border-slate-800 flex-col bg-slate-900/50 backdrop-blur-xl relative z-10`}
            initial={{ x: -50, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
        >
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900/80 backdrop-blur-md z-20">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md">
                        {me?.username[0].toUpperCase()}
                    </div>
                    <div>
                        <h1 className="font-bold text-lg leading-tight">{me?.username}</h1>
                        <div className="text-xs text-green-400 flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Online
                        </div>
                    </div>
                </div>
                <button onClick={()=>{localStorage.clear(); window.location.reload()}} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-red-400 transition">
                    <LogOut size={20} />
                </button>
            </div>

            {/* Search */}
            <div className="p-4">
                <div className="relative group">
                    <Search className="absolute left-3 top-3 text-slate-500 w-5 h-5 group-focus-within:text-blue-400 transition" />
                    <input 
                        className="w-full bg-slate-800/50 border border-slate-700/50 p-2.5 pl-10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition"
                        placeholder="Search users..."
                        value={searchQuery}
                        onChange={e => { setSearchQuery(e.target.value); if(e.target.value) socket.emit('search_users', e.target.value); else setSearchResults([]); }}
                    />
                </div>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
                {searchResults.length > 0 && (
                    <div className="mb-4">
                        <div className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Found Users</div>
                        {searchResults.map(user => (
                            <motion.div key={user.id} onClick={() => selectUser(user)} whileHover={{ scale: 1.02 }} className="p-3 rounded-xl hover:bg-slate-800 cursor-pointer flex items-center gap-4 transition">
                                <div className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center text-lg font-bold text-slate-300">
                                    {user.username[0].toUpperCase()}
                                </div>
                                <div>{user.username}</div>
                            </motion.div>
                        ))}
                    </div>
                )}

                {chats.map(chat => (
                    <motion.div 
                        key={chat.id} 
                        onClick={() => selectUser(chat)} 
                        whileTap={{ scale: 0.98 }}
                        className={`p-3 rounded-xl cursor-pointer flex items-center gap-4 transition border border-transparent ${selectedUser?.id === chat.id ? 'bg-blue-600/10 border-blue-500/20' : 'hover:bg-slate-800/50'}`}
                    >
                        <div className="relative">
                            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-sm">
                                {chat.username[0].toUpperCase()}
                            </div>
                            {onlineUsers.has(chat.id) && (
                                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-slate-900 rounded-full"></span>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline">
                                <div className="font-semibold text-slate-200 truncate">{chat.username}</div>
                                {/* Optional: Timestamp of last message could go here */}
                            </div>
                            <div className="text-sm text-slate-500 truncate flex items-center gap-1">
                                {typingUsers.has(chat.id) ? (
                                    <span className="text-blue-400 animate-pulse">typing...</span>
                                ) : (
                                    <span>Tap to open chat</span>
                                )}
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </motion.div>
      </AnimatePresence>

      {/* CHAT AREA */}
      <div className={`${!showChatOnMobile ? 'hidden' : 'flex'} md:flex flex-1 flex-col bg-black/40 relative`}>
        {selectedUser ? (
            <>
                {/* Chat Header */}
                <div className="p-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex justify-between items-center shadow-sm z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setShowChatOnMobile(false)} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white">
                            <X size={24} />
                        </button>
                        <div className="relative">
                            <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center font-bold text-white">
                                 {selectedUser.username[0].toUpperCase()}
                            </div>
                            {onlineUsers.has(selectedUser.id) && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-slate-900 rounded-full"></span>}
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-100">{selectedUser.username}</h3>
                            <div className="text-xs text-slate-400">
                                {typingUsers.has(selectedUser.id) ? <span className="text-blue-400">typing...</span> : (onlineUsers.has(selectedUser.id) ? 'Online' : 'Offline')}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => startCall(false)} className="p-3 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-300 hover:text-green-400 transition shadow-sm">
                            <Phone size={20} />
                        </button>
                        <button onClick={() => startCall(true)} className="p-3 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-300 hover:text-blue-400 transition shadow-sm">
                            <Video size={20} />
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
                    {messages[selectedUser.id]?.map((msg, i) => {
                        const isMe = msg.from_user_id === me?.id;
                        return (
                            <motion.div 
                                key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`max-w-[85%] md:max-w-md p-3 px-4 rounded-2xl shadow-md backdrop-blur-sm ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'}`}>
                                    <div className="text-[15px] leading-relaxed break-words">{msg.content}</div>
                                    <div className={`text-[10px] text-right mt-1 opacity-60 flex justify-end items-center gap-1`}>
                                        {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                                        {isMe && <CheckCheck size={12} />}
                                    </div>
                                </div>
                            </motion.div>
                        )
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-slate-900 border-t border-slate-800 relative">
                    <form onSubmit={sendMessage} className="flex gap-3 items-end">
                        <div className="relative">
                            <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-3 text-slate-400 hover:text-yellow-400 transition">
                                <Smile size={24} />
                            </button>
                            {showEmojiPicker && (
                                <div className="absolute bottom-14 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
                                    <EmojiPicker theme="dark" onEmojiClick={onEmojiClick} />
                                </div>
                            )}
                        </div>
                        
                        <div className="flex-1 bg-slate-800 rounded-2xl border border-slate-700 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition flex items-center">
                            <input
                                className="w-full bg-transparent p-3 text-white placeholder-slate-500 focus:outline-none max-h-32"
                                placeholder="Message..."
                                value={inputMessage}
                                onChange={handleInput}
                            />
                        </div>
                        
                        <button type="submit" disabled={!inputMessage.trim()} className="p-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-full shadow-lg transition transform hover:scale-105">
                            <Send size={20} />
                        </button>
                    </form>
                </div>
            </>
        ) : (
            <div className="hidden md:flex flex-1 flex-col items-center justify-center text-slate-600 bg-slate-950/50">
                <div className="w-32 h-32 bg-slate-900 rounded-full flex items-center justify-center mb-6 shadow-inner">
                    <Send size={48} className="opacity-20" />
                </div>
                <div className="text-xl font-medium">Select a chat to start messaging</div>
                <div className="text-sm opacity-50 mt-2">Search for users in the sidebar</div>
            </div>
        )}

        {/* Call Overlay */}
        {(callAccepted || receivingCall || callStatus) && !callEnded && (
             <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-6">
                <div className="text-3xl font-bold mb-8 animate-pulse text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-green-400">{callStatus || "In Call"}</div>
                
                <div className="flex flex-col md:flex-row gap-6 w-full max-w-5xl h-[60vh]">
                    {/* My Video */}
                    <div className="flex-1 relative bg-slate-800 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-slate-700">
                        {isVideoCall ? (
                             <video playsInline muted ref={myVideo} autoPlay className="w-full h-full object-cover transform scale-x-[-1]" />
                        ) : (
                             <div className="w-full h-full flex items-center justify-center flex-col gap-4">
                                <div className="w-24 h-24 bg-slate-700 rounded-full flex items-center justify-center">
                                    <User size={40} />
                                </div>
                                <span className="text-xl">You</span>
                             </div>
                        )}
                        <div className="absolute bottom-4 left-4 bg-black/60 px-4 py-1.5 rounded-full text-sm backdrop-blur-md border border-white/10">You</div>
                    </div>
                    
                    {/* Remote Video */}
                    <div className="flex-1 relative bg-slate-800 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-slate-700">
                        {callAccepted ? (
                            <video playsInline ref={userVideo} autoPlay className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center flex-col gap-6">
                                <div className="w-32 h-32 bg-slate-700 rounded-full flex items-center justify-center animate-bounce shadow-xl">
                                    <span className="text-4xl font-bold">{callerName ? callerName[0] : "👤"}</span>
                                </div>
                                <div className="text-2xl font-light">{callerName || "Calling..."}</div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-10 flex gap-8">
                    {receivingCall && !callAccepted && (
                        <button onClick={answerCall} className="bg-green-500 hover:bg-green-400 text-white w-20 h-20 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30 transform hover:scale-110 transition animate-bounce">
                            <Phone size={32} />
                        </button>
                    )}
                    <button onClick={leaveCall} className="bg-red-500 hover:bg-red-400 text-white w-20 h-20 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transform hover:scale-110 transition">
                        <Phone size={32} className="rotate-[135deg]" />
                    </button>
                </div>
             </div>
        )}
      </div>
    </div>
  )
}

export default App;
