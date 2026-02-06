import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { 
  Phone, Video, Send, Search, User, LogOut, 
  Menu, X, Smile, MoreVertical, Check, CheckCheck,
  Paperclip, Trash2, Edit2, FileText, Download,
  Mic, MicOff, VideoOff, Camera, Moon, Sun, Image as ImageIcon,
  WifiOff, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EmojiPicker from 'emoji-picker-react';

// Simple notification sound (Base64)
const NOTIFICATION_SOUND = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//uQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWgAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//uQZAAAAAAAIAAAAAAREALgAAAAAAIAAAAAAREALgAAABBAAAAgEAF//uQZAAAAAAAIAAAAAAREALgAAAAAAIAAAAAAREALgAAABBAAAAgEAF//uQZAAAAAAAIAAAAAAREALgAAAAAAIAAAAAAREALgAAABBAAAAgEAF"; 

function App() {
  // --- STATE ---
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(!!localStorage.getItem('messenger_user'));
  const [me, setMe] = useState(null);

  const [chats, setChats] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState(new Set()); 
  
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState(null);

  // Call State
  const [stream, setStream] = useState(null);
  const [receivingCall, setReceivingCall] = useState(false);
  const [caller, setCaller] = useState("");
  const [callerSignal, setCallerSignal] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [callerName, setCallerName] = useState("");
  const [callStatus, setCallStatus] = useState("");
  const [isVideoCall, setIsVideoCall] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  // Refs
  const selectedUserRef = useRef(null);
  const meRef = useRef(null);
  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const notificationAudio = useRef(new Audio(NOTIFICATION_SOUND));
  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);

  // --- EFFECTS ---

  // Theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Keep refs updated
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { meRef.current = me; }, [me]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
    // Mark as read if looking at the chat
    if (selectedUser && messages[selectedUser.id]) {
        const unread = messages[selectedUser.id].some(m => !m.is_read && m.from_user_id === selectedUser.id);
        if (unread && socket && isConnected) {
             socket.emit('mark_read', { fromUserId: selectedUser.id });
        }
    }
  }, [messages, selectedUser, typingUsers, isConnected]);

  // Init Socket
  useEffect(() => {
      // Reverting strict websocket force to see if it helps with "Server not found" on some networks
      // but keeping it as a preference for better performance
      const newSocket = io({
          transports: ['websocket', 'polling'], 
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
      });
      setSocket(newSocket);

      newSocket.on('connect', () => {
          console.log("Connected to server");
          setIsConnected(true);
          // Auto-login on reconnect
          const savedUser = localStorage.getItem('messenger_user');
          const savedPass = localStorage.getItem('messenger_pass');
          if (savedUser && savedPass) {
              // Ensure we don't show login form momentarily
              setIsAutoLoggingIn(true); 
              newSocket.emit('login', { username: savedUser, password: savedPass });
          } else {
              setIsAutoLoggingIn(false);
          }
      });

      newSocket.on('disconnect', () => {
          console.log("Disconnected from server");
          setIsConnected(false);
      });

      newSocket.on('connect_error', (err) => {
          console.error("Connection error:", err);
          setIsConnected(false);
      });

      return () => newSocket.close();
  }, []);

  // Socket Listeners
  useEffect(() => {
    if (!socket) return;

    // --- EVENT HANDLERS ---
    
    const onLoginSuccess = (userData) => {
      setIsLoading(false);
      setIsAutoLoggingIn(false);
      setIsLoggedIn(true);
      setMe(userData);
      localStorage.setItem('messenger_user', userData.username);
      if (password) localStorage.setItem('messenger_pass', password);
      setAuthError("");
    };

    const onLoginError = (msg) => {
        setIsLoading(false);
        setIsAutoLoggingIn(false);
        setAuthError(msg);
        if (msg === "Invalid credentials") {
             localStorage.removeItem('messenger_user');
             localStorage.removeItem('messenger_pass');
        }
    };

    const onRegisterSuccess = () => {
        setIsLoading(false);
        alert("Registration successful! Login now.");
        setIsRegistering(false);
        setAuthError("");
    };
    
    const onRegisterError = (msg) => {
        setIsLoading(false);
        setAuthError(msg);
    };

    const onRecentChats = (chatList) => setChats(chatList);
    const onSearchResults = (results) => setSearchResults(results);
    const onOnlineUsers = (ids) => setOnlineUsers(new Set(ids));
    
    const onUserStatus = ({ userId, status }) => {
        setOnlineUsers(prev => {
            const newSet = new Set(prev);
            if (status === 'online') newSet.add(userId);
            else newSet.delete(userId);
            return newSet;
        });
    };

    const onAvatarUpdated = ({ avatarUrl }) => {
        setMe(prev => ({ ...prev, avatar_url: avatarUrl }));
    };

    const onHistory = ({ userId, messages: history }) => {
      setMessages(prev => ({ ...prev, [userId]: history }));
    };

    const onPrivateMessage = (msg) => {
      const { fromUserId, username, content, timestamp, id } = msg;

      setMessages(prev => {
        const userMsgs = prev[fromUserId] || [];
        const exists = userMsgs.some(m => (id && m.id === id) || (!id && m.created_at === timestamp && m.content === content));
        if (exists) return prev;
        return { ...prev, [fromUserId]: [...userMsgs, msg] };
      });
      
      setChats(prev => {
        if (!prev.find(c => c.id === fromUserId)) return [{ id: fromUserId, username, avatar_url: msg.avatar_url }, ...prev]; 
        const otherChats = prev.filter(c => c.id !== fromUserId);
        const currentChat = prev.find(c => c.id === fromUserId) || { id: fromUserId, username };
        return [currentChat, ...otherChats];
      });

      if (document.hidden || selectedUserRef.current?.id !== fromUserId) {
          notificationAudio.current.play().catch(e => console.log("Audio play failed", e)); 
      } else {
          socket.emit('mark_read', { fromUserId });
      }
    };

    const onMessageSent = (msg) => {
        const { toUserId, timestamp, content, id } = msg;
        setMessages(prev => {
            const userMsgs = prev[toUserId] || [];
            const exists = userMsgs.some(m => (id && m.id === id) || (!id && m.created_at === timestamp && m.content === content));
            if (exists) return prev;
            return { ...prev, [toUserId]: [...userMsgs, { ...msg, from_user_id: meRef.current?.id }] };
        });
    };

    const onMessagesRead = ({ byUserId }) => {
        setMessages(prev => {
            const userMsgs = prev[byUserId];
            if (!userMsgs) return prev;
            return {
                ...prev,
                [byUserId]: userMsgs.map(m => m.from_user_id === meRef.current?.id ? { ...m, is_read: true } : m)
            };
        });
    };

    const onMessageEdited = ({ messageId, newContent, fromUserId }) => {
        setMessages(prev => {
            const newState = { ...prev };
            Object.keys(newState).forEach(userId => {
                newState[userId] = newState[userId].map(m => 
                    m.id === messageId ? { ...m, content: newContent, is_edited: true } : m
                );
            });
            return newState;
        });
    };

    const onMessageDeleted = ({ messageId }) => {
        setMessages(prev => {
            const newState = { ...prev };
            Object.keys(newState).forEach(userId => {
                newState[userId] = newState[userId].map(m => 
                    m.id === messageId ? { ...m, is_deleted: true, content: 'Message deleted' } : m
                );
            });
            return newState;
        });
    };

    const onTyping = ({ fromUserId }) => setTypingUsers(prev => new Set(prev).add(fromUserId));
    const onStopTyping = ({ fromUserId }) => setTypingUsers(prev => { const s = new Set(prev); s.delete(fromUserId); return s; });

    const onCallUser = (data) => {
      setReceivingCall(true);
      setCaller(data.from);
      setCallerName(data.name);
      setCallerSignal(data.signal);
    };

    socket.on('login_success', onLoginSuccess);
    socket.on('login_error', onLoginError);
    socket.on('register_success', onRegisterSuccess);
    socket.on('register_error', onRegisterError);
    socket.on('recent_chats', onRecentChats);
    socket.on('search_results', onSearchResults);
    socket.on('online_users', onOnlineUsers);
    socket.on('user_status', onUserStatus);
    socket.on('avatar_updated', onAvatarUpdated);
    socket.on('history', onHistory);
    socket.on('private message', onPrivateMessage);
    socket.on('message_sent', onMessageSent);
    socket.on('messages_read', onMessagesRead);
    socket.on('message_edited', onMessageEdited);
    socket.on('message_deleted', onMessageDeleted);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);
    socket.on('callUser', onCallUser);

    return () => {
        socket.off('login_success', onLoginSuccess);
        socket.off('login_error', onLoginError);
        socket.off('register_success', onRegisterSuccess);
        socket.off('register_error', onRegisterError);
        socket.off('recent_chats', onRecentChats);
        socket.off('search_results', onSearchResults);
        socket.off('online_users', onOnlineUsers);
        socket.off('user_status', onUserStatus);
        socket.off('avatar_updated', onAvatarUpdated);
        socket.off('history', onHistory);
        socket.off('private message', onPrivateMessage);
        socket.off('message_sent', onMessageSent);
        socket.off('messages_read', onMessagesRead);
        socket.off('message_edited', onMessageEdited);
        socket.off('message_deleted', onMessageDeleted);
        socket.off('typing', onTyping);
        socket.off('stop_typing', onStopTyping);
        socket.off('callUser', onCallUser);
    };
  }, [socket]); // Only depend on socket!


  // --- HANDLERS ---

  const handleAuth = (e) => {
    e.preventDefault();
    if (!socket || !isConnected) {
        setAuthError("Connecting to server...");
        return;
    }
    setIsLoading(true);
    setAuthError("");

    // Timeout safety
    setTimeout(() => {
        setIsLoading(prev => {
            if (prev) {
                setAuthError("Request timed out. Check connection.");
                return false;
            }
            return false;
        });
    }, 10000);

    if (isRegistering) socket.emit('register', { username, password });
    else socket.emit('login', { username, password });
  };

  const selectUser = (user) => {
    if (!socket) return;
    setSelectedUser(user);
    setSearchQuery("");
    setSearchResults([]);
    setShowChatOnMobile(true);
    socket.emit('get_history', user.id);
    socket.emit('mark_read', { fromUserId: user.id });
    if (!chats.find(c => c.id === user.id)) setChats([user, ...chats]);
  };

  const handleInput = (e) => {
      setInputMessage(e.target.value);
      if (!socket) return;
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
    if ((!inputMessage.trim() && !editingMessageId) || !selectedUser || !socket) return;

    if (editingMessageId) {
        socket.emit('edit_message', { messageId: editingMessageId, newContent: inputMessage, toUserId: selectedUser.id });
        setEditingMessageId(null);
    } else {
        socket.emit("private message", { content: inputMessage, toUserId: selectedUser.id });
    }
    
    setInputMessage("");
    setShowEmojiPicker(false);
    socket.emit('stop_typing', { toUserId: selectedUser.id });
  };

  const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (!file || !selectedUser) return;
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
          const type = file.type.startsWith('image/') ? 'image' : 'file';
          socket.emit("private message", { 
              content: type === 'image' ? 'Sent an image' : `Sent a file: ${file.name}`, 
              toUserId: selectedUser.id,
              type,
              file: reader.result,
              fileName: file.name
          });
      };
  };

  const handleAvatarUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
          socket.emit('update_avatar', { avatarUrl: reader.result });
      };
  };

  const deleteMessage = (msgId) => {
      if (!selectedUser) return;
      if (confirm("Delete this message?")) {
          socket.emit('delete_message', { messageId: msgId, toUserId: selectedUser.id });
      }
  };

  const startEditMessage = (msg) => {
      setEditingMessageId(msg.id);
      setInputMessage(msg.content);
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  // --- WebRTC ---
  const startCall = async (video) => {
    setIsVideoCall(video);
    setCallStatus(video ? "Starting Video Call..." : "Calling...");
    setIsMuted(false);
    setIsCameraOff(!video);
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

  const toggleMute = () => {
      if (stream) {
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
              audioTrack.enabled = !audioTrack.enabled;
              setIsMuted(!audioTrack.enabled);
          }
      }
  };

  const toggleCamera = () => {
      if (stream) {
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
              videoTrack.enabled = !videoTrack.enabled;
              setIsCameraOff(!videoTrack.enabled);
          }
      }
  };

  // --- UI HELPERS ---
  const Avatar = ({ user, size = "md", onClick }) => {
      const sizes = { sm: "w-8 h-8", md: "w-10 h-10", lg: "w-16 h-16", xl: "w-24 h-24" };
      return (
          <div onClick={onClick} className={`${sizes[size]} relative rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-500 text-white font-bold shadow-md cursor-pointer hover:opacity-90 transition`}>
              {user?.avatar_url ? (
                  <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                  <span className="text-lg">{user?.username?.[0]?.toUpperCase()}</span>
              )}
          </div>
      );
  };

  // --- RENDER ---

  if (!isLoggedIn) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-black flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl shadow-2xl w-full max-w-md">
                <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg transform rotate-12">
                        <Send className="text-white w-8 h-8 -rotate-12" />
                    </div>
                </div>
                <h2 className="text-3xl font-bold text-center text-white mb-2">Messenger</h2>
                
                {isAutoLoggingIn ? (
                     <div className="flex flex-col items-center justify-center py-10">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-slate-400">Restoring session...</p>
                        <button onClick={() => setIsAutoLoggingIn(false)} className="mt-4 text-sm text-slate-500 hover:text-white underline">Cancel</button>
                     </div>
                ) : (
                    <>
                        <p className="text-slate-400 text-center mb-8">
                    {!isConnected ? (
                        <span className="flex items-center justify-center gap-2 text-yellow-400">
                            <WifiOff size={16} /> Connecting...
                        </span>
                    ) : (
                        "Sign in to continue"
                    )}
                </p>
                <form onSubmit={handleAuth} className="space-y-4">
                    <div className="relative">
                        <User className="absolute left-4 top-3.5 text-slate-400 w-5 h-5" />
                        <input className="w-full bg-slate-900/50 border border-slate-700 p-3 pl-12 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" 
                            placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} disabled={!isConnected} />
                    </div>
                    <div className="relative">
                        <div className="absolute left-4 top-3.5 text-slate-400 font-bold w-5 h-5 flex items-center justify-center">***</div>
                        <input className="w-full bg-slate-900/50 border border-slate-700 p-3 pl-12 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" 
                            type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} disabled={!isConnected} />
                    </div>
                    <button disabled={!isConnected || isLoading} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 p-3.5 rounded-xl font-bold text-white shadow-lg hover:shadow-blue-500/30 transition transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                        {isLoading ? "Please wait..." : (isRegistering ? "Create Account" : "Sign In")}
                    </button>
                </form>
                <div className="mt-6 text-center">
                        <button onClick={()=>setIsRegistering(!isRegistering)} className="text-sm text-slate-400 hover:text-white transition underline decoration-slate-600 underline-offset-4">
                            {isRegistering ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
                        </button>
                    </div>
                    </>
                )}
                {authError && <div className="mt-4 text-red-400 text-center text-sm bg-red-500/10 p-2 rounded-lg border border-red-500/20">{authError}</div>}
            </motion.div>
        </div>
    )
  }

  return (
    <div className={`flex h-screen overflow-hidden font-sans transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* SIDEBAR */}
      <AnimatePresence>
        <motion.div 
            className={`${showChatOnMobile ? 'hidden' : 'flex'} md:flex w-full md:w-[24rem] border-r dark:border-slate-800 border-slate-200 flex-col dark:bg-slate-900/50 bg-white/50 backdrop-blur-xl relative z-10`}
            initial={{ x: -50, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
        >
            {/* Header */}
            <div className="p-4 border-b dark:border-slate-800 border-slate-200 flex justify-between items-center sticky top-0 dark:bg-slate-900/80 bg-white/80 backdrop-blur-md z-20">
                <div className="flex items-center gap-3">
                    <div className="relative group cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
                        <Avatar user={me} />
                        <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                            <Camera size={16} className="text-white" />
                        </div>
                        <input type="file" ref={avatarInputRef} className="hidden" onChange={handleAvatarUpload} accept="image/*" />
                    </div>
                    <div>
                        <h1 className="font-bold text-lg leading-tight">{me?.username}</h1>
                        <div className="flex items-center gap-2 text-xs font-medium">
                            {isConnected ? (
                                <span className="text-green-500">Online</span>
                            ) : (
                                <span className="text-yellow-500 flex items-center gap-1"><WifiOff size={12}/> Reconnecting...</span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={toggleTheme} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition">
                        {theme === 'dark' ? <Sun size={20} className="text-yellow-400" /> : <Moon size={20} className="text-slate-600" />}
                    </button>
                    <button onClick={()=>{localStorage.clear(); window.location.reload()}} className="p-2 hover:bg-red-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-red-500 transition">
                        <LogOut size={20} />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="p-4">
                <div className="relative group">
                    <Search className="absolute left-3 top-3 text-slate-400 w-5 h-5 group-focus-within:text-blue-500 transition" />
                    <input 
                        className="w-full dark:bg-slate-800/50 bg-slate-100 border dark:border-slate-700/50 border-slate-200 p-2.5 pl-10 rounded-xl dark:text-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition"
                        placeholder="Search..."
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
                            <motion.div key={user.id} onClick={() => selectUser(user)} whileHover={{ scale: 1.02 }} className="p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-4 transition">
                                <Avatar user={user} />
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
                        className={`p-3 rounded-2xl cursor-pointer flex items-center gap-4 transition border border-transparent ${selectedUser?.id === chat.id ? 'bg-blue-500/10 dark:bg-blue-600/20 border-blue-500/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                    >
                        <div className="relative">
                            <Avatar user={chat} />
                            {onlineUsers.has(chat.id) && (
                                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 dark:border-slate-900 border-white rounded-full"></span>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline">
                                <div className="font-semibold dark:text-slate-200 text-slate-800 truncate">{chat.username}</div>
                            </div>
                            <div className="text-sm text-slate-500 truncate flex items-center gap-1">
                                {typingUsers.has(chat.id) ? (
                                    <span className="text-blue-500 animate-pulse">typing...</span>
                                ) : (
                                    <span>Tap to chat</span>
                                )}
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </motion.div>
      </AnimatePresence>

      {/* CHAT AREA */}
      <div className={`${!showChatOnMobile ? 'hidden' : 'flex'} md:flex flex-1 flex-col dark:bg-black/20 bg-slate-50 relative`}>
        {selectedUser ? (
            <>
                {/* Chat Header */}
                <div className="p-3 dark:bg-slate-900/80 bg-white/80 backdrop-blur-md border-b dark:border-slate-800 border-slate-200 flex justify-between items-center shadow-sm z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setShowChatOnMobile(false)} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-white">
                            <X size={24} />
                        </button>
                        <div className="relative">
                            <Avatar user={selectedUser} size="md" />
                            {onlineUsers.has(selectedUser.id) && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 dark:border-slate-900 border-white rounded-full"></span>}
                        </div>
                        <div>
                            <h3 className="font-bold dark:text-slate-100 text-slate-800">{selectedUser.username}</h3>
                            <div className="text-xs text-slate-500">
                                {typingUsers.has(selectedUser.id) ? <span className="text-blue-500">typing...</span> : (onlineUsers.has(selectedUser.id) ? 'Online' : 'Offline')}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => startCall(false)} className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-green-100 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-300 hover:text-green-600 dark:hover:text-green-400 transition shadow-sm">
                            <Phone size={20} />
                        </button>
                        <button onClick={() => startCall(true)} className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition shadow-sm">
                            <Video size={20} />
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {messages[selectedUser.id]?.map((msg, i) => {
                        const isMe = msg.from_user_id === me?.id;
                        return (
                            <motion.div 
                                key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`group relative max-w-[85%] md:max-w-md p-3 px-4 rounded-2xl shadow-sm backdrop-blur-sm ${isMe ? 'bg-blue-600 text-white rounded-br-sm' : 'dark:bg-slate-800 bg-white dark:text-slate-200 text-slate-800 rounded-bl-sm border dark:border-slate-700 border-slate-200'}`}>
                                    {/* Actions Menu */}
                                    {isMe && !msg.is_deleted && (
                                        <div className="absolute -top-3 -right-2 hidden group-hover:flex bg-slate-800 border border-slate-600 rounded-lg shadow-lg overflow-hidden">
                                            <button onClick={() => startEditMessage(msg)} className="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-blue-400"><Edit2 size={12} /></button>
                                            <button onClick={() => deleteMessage(msg.id)} className="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-red-400"><Trash2 size={12} /></button>
                                        </div>
                                    )}

                                    {/* Content */}
                                    {msg.type === 'image' ? (
                                        <img src={msg.file_url} alt="Shared" className="rounded-lg max-w-full cursor-pointer hover:opacity-95 transition" onClick={() => window.open(msg.file_url, '_blank')} />
                                    ) : msg.type === 'file' ? (
                                        <a href={msg.file_url} download={msg.file_name} className="flex items-center gap-3 bg-black/10 p-2 rounded-lg hover:bg-black/20 transition">
                                            <div className="bg-slate-700 p-2 rounded text-white"><FileText size={20} /></div>
                                            <div className="text-sm underline truncate max-w-[150px]">{msg.file_name}</div>
                                            <Download size={16} />
                                        </a>
                                    ) : (
                                        <div className={`text-[15px] leading-relaxed break-words ${msg.is_deleted ? 'italic opacity-50' : ''}`}>
                                            {msg.content}
                                        </div>
                                    )}

                                    <div className={`text-[10px] text-right mt-1 opacity-60 flex justify-end items-center gap-1`}>
                                        {msg.is_edited && !msg.is_deleted && <span className="mr-1">(edited)</span>}
                                        {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                                        {isMe && (
                                            <span className={msg.is_read ? 'text-blue-200' : ''}>
                                                <CheckCheck size={14} />
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 dark:bg-slate-900 bg-white border-t dark:border-slate-800 border-slate-200 relative">
                    <form onSubmit={sendMessage} className="flex gap-3 items-end max-w-4xl mx-auto">
                        <div className="relative">
                            <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-3 text-slate-400 hover:text-yellow-500 transition">
                                <Smile size={24} />
                            </button>
                            {showEmojiPicker && (
                                <div className="absolute bottom-14 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
                                    <EmojiPicker theme={theme === 'dark' ? "dark" : "light"} onEmojiClick={(emoji) => setInputMessage(prev => prev + emoji.emoji)} />
                                </div>
                            )}
                        </div>

                        <div className="relative">
                            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-400 hover:text-blue-500 transition">
                                <Paperclip size={24} />
                            </button>
                        </div>
                        
                        <div className="flex-1 dark:bg-slate-800 bg-slate-100 rounded-3xl border dark:border-slate-700 border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition flex items-center relative">
                            <input
                                className="w-full bg-transparent p-3.5 px-5 dark:text-white text-slate-900 placeholder-slate-500 focus:outline-none max-h-32"
                                placeholder={editingMessageId ? "Editing message..." : "iMessage..."}
                                value={inputMessage}
                                onChange={handleInput}
                            />
                            {editingMessageId && (
                                <button type="button" onClick={() => { setEditingMessageId(null); setInputMessage(""); }} className="absolute right-2 top-2 p-1 bg-slate-700 rounded-full text-slate-400 hover:text-white">
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        
                        <button type="submit" disabled={!inputMessage.trim()} className="p-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-full shadow-lg transition transform hover:scale-105">
                            {editingMessageId ? <Check size={20} /> : <Send size={20} />}
                        </button>
                    </form>
                </div>
            </>
        ) : (
            <div className="hidden md:flex flex-1 flex-col items-center justify-center text-slate-500 bg-slate-50 dark:bg-slate-950/50">
                <div className="w-32 h-32 dark:bg-slate-900 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border dark:border-slate-800 border-slate-200">
                    <Send size={48} className="opacity-20" />
                </div>
                <div className="text-xl font-medium">No Chat Selected</div>
            </div>
        )}

        {/* Call Overlay */}
        {(callAccepted || receivingCall || callStatus) && !callEnded && (
             <div className="absolute inset-0 bg-black/80 backdrop-blur-xl z-50 flex flex-col items-center justify-center p-6">
                <div className="text-2xl font-semibold mb-8 text-white">{callStatus || "In Call"}</div>
                
                <div className="flex flex-col md:flex-row gap-6 w-full max-w-4xl h-[60vh] relative">
                    {/* Remote Video (Main) */}
                    <div className="flex-1 relative bg-slate-800 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-slate-700">
                        {callAccepted ? (
                            <video playsInline ref={userVideo} autoPlay className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center flex-col gap-6">
                                <div className="w-32 h-32 bg-slate-700 rounded-full flex items-center justify-center animate-bounce shadow-xl">
                                    <span className="text-4xl font-bold text-white">{callerName ? callerName[0] : "👤"}</span>
                                </div>
                                <div className="text-2xl font-light text-white">{callerName || "Calling..."}</div>
                            </div>
                        )}
                    </div>

                    {/* My Video (PiP) */}
                    <div className="absolute top-4 right-4 w-32 h-48 md:w-48 md:h-36 bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-white/20 z-10">
                        {isVideoCall && !isCameraOff ? (
                             <video playsInline muted ref={myVideo} autoPlay className="w-full h-full object-cover transform scale-x-[-1]" />
                        ) : (
                             <div className="w-full h-full flex items-center justify-center flex-col gap-2 bg-slate-800">
                                <User size={24} className="text-slate-400" />
                                <span className="text-xs text-slate-400">Camera Off</span>
                             </div>
                        )}
                    </div>
                </div>

                <div className="mt-10 flex gap-6 items-center bg-slate-900/90 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
                    {receivingCall && !callAccepted ? (
                        <button onClick={answerCall} className="bg-green-500 hover:bg-green-400 text-white w-16 h-16 rounded-full flex items-center justify-center shadow-lg transform hover:scale-110 transition animate-pulse">
                            <Phone size={28} />
                        </button>
                    ) : (
                        <>
                             <button onClick={toggleMute} className={`p-4 rounded-full transition ${isMuted ? 'bg-white text-black' : 'bg-slate-700 text-white hover:bg-slate-600'}`}>
                                {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                             </button>
                             <button onClick={toggleCamera} className={`p-4 rounded-full transition ${isCameraOff ? 'bg-white text-black' : 'bg-slate-700 text-white hover:bg-slate-600'}`}>
                                {isCameraOff ? <VideoOff size={24} /> : <Video size={24} />}
                             </button>
                        </>
                    )}
                    
                    <button onClick={leaveCall} className="bg-red-500 hover:bg-red-400 text-white w-16 h-16 rounded-full flex items-center justify-center shadow-lg transform hover:scale-110 transition">
                        <Phone size={28} className="rotate-[135deg]" />
                    </button>
                </div>
             </div>
        )}
      </div>
    </div>
  )
}

export default App;
