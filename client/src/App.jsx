import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import SimplePeer from 'simple-peer'

const socket = io();

function App() {
  // Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [me, setMe] = useState(null); // { id, username }

  // App State
  const [chats, setChats] = useState([]); // List of users we have chatted with
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null); 
  const [messages, setMessages] = useState({}); // { userId: [messages] }
  const [isConnected, setIsConnected] = useState(socket.connected);
  
  // Mobile View State
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);

  // WebRTC State
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedUser]);

  // Load saved session
  useEffect(() => {
    const savedUser = localStorage.getItem('messenger_user');
    const savedPass = localStorage.getItem('messenger_pass');
    if (savedUser && savedPass) {
      setUsername(savedUser);
      setPassword(savedPass);
      if (socket.connected) {
         socket.emit('login', { username: savedUser, password: savedPass });
      } else {
         socket.once('connect', () => {
             socket.emit('login', { username: savedUser, password: savedPass });
         });
      }
    }
  }, []);

  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    
    // Auth
    socket.on('login_success', (userData) => { // userData: { id, username }
      setAuthError("");
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
      alert("Registration successful!");
      setIsRegistering(false);
    });
    socket.on('register_error', (msg) => setAuthError(msg));

    // Data
    socket.on('recent_chats', (chatList) => {
      setChats(chatList);
    });

    socket.on('search_results', (results) => {
      setSearchResults(results);
    });

    socket.on('history', ({ userId, messages: history }) => {
      setMessages(prev => ({
        ...prev,
        [userId]: history
      }));
    });

    socket.on('private message', ({ content, fromUserId, username, timestamp }) => {
      // Add message to store
      setMessages(prev => {
        const userMsgs = prev[fromUserId] || [];
        return {
          ...prev,
          [fromUserId]: [...userMsgs, { content, from_user_id: fromUserId, created_at: timestamp }]
        };
      });

      // Update chat list if new user
      setChats(prev => {
        if (!prev.find(c => c.id === fromUserId)) {
          return [{ id: fromUserId, username }, ...prev];
        }
        return prev;
      });
    });

    socket.on('message_sent', ({ content, toUserId, timestamp }) => {
        setMessages(prev => {
            const userMsgs = prev[toUserId] || [];
            return {
              ...prev,
              [toUserId]: [...userMsgs, { content, from_user_id: me?.id, created_at: timestamp }]
            };
        });
    });

    // WebRTC
    socket.on("callUser", (data) => {
      setReceivingCall(true);
      setCaller(data.from); // userId
      setCallerName(data.name);
      setCallerSignal(data.signal);
    });

    return () => {
      socket.off('login_success');
      socket.off('recent_chats');
      socket.off('private message');
      socket.off('message_sent');
      // ... cleanup others
    };
  }, [username, password, me]);

  const handleAuth = (e) => {
    e.preventDefault();
    if (isRegistering) socket.emit('register', { username, password });
    else socket.emit('login', { username, password });
  };

  const handleSearch = (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (q.length > 0) socket.emit('search_users', q);
    else setSearchResults([]);
  };

  const selectUser = (user) => {
    setSelectedUser(user);
    setSearchQuery("");
    setSearchResults([]);
    setShowChatOnMobile(true); // Switch view on mobile
    
    // Load history
    socket.emit('get_history', user.id);
    
    // Add to chats if not present
    if (!chats.find(c => c.id === user.id)) {
        setChats([user, ...chats]);
    }
  };

  const sendMessage = (e, text) => {
    e.preventDefault();
    if (!text.trim() || !selectedUser) return;
    socket.emit("private message", { content: text, toUserId: selectedUser.id });
  };

  const goBack = () => {
      setShowChatOnMobile(false);
      setSelectedUser(null);
  };

  // --- WebRTC ---
  const startCall = async (video) => {
    setIsVideoCall(video);
    setCallStatus(video ? "Starting Video Call..." : "Starting Audio Call...");
    
    try {
        const currentStream = await navigator.mediaDevices.getUserMedia({ 
            video: video, 
            audio: true 
        });
        setStream(currentStream);
        if (video && myVideo.current) myVideo.current.srcObject = currentStream;

        const peer = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: currentStream
        });

        peer.on("signal", (data) => {
            socket.emit("callUser", {
                userToCall: selectedUser.id,
                signalData: data,
                from: me.id,
                name: me.username
            });
        });

        peer.on("stream", (remoteStream) => {
            if (userVideo.current) userVideo.current.srcObject = remoteStream;
        });

        socket.on("callAccepted", (signal) => {
            setCallAccepted(true);
            setCallStatus("Connected");
            peer.signal(signal);
        });

        connectionRef.current = peer;

    } catch (err) {
        console.error(err);
        alert("Could not access media devices. " + err.message);
        setCallStatus("");
    }
  };

  const answerCall = async () => {
    setCallAccepted(true);
    setCallStatus("Connecting...");
    
    try {
        // Try video first, fallback to audio if needed or if user prefers? 
        // For simplicity, let's assume we answer with video if available
        const currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => {
            return navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        });
        
        setStream(currentStream);
        if (myVideo.current && currentStream.getVideoTracks().length > 0) {
             myVideo.current.srcObject = currentStream;
        }

        const peer = new SimplePeer({
            initiator: false,
            trickle: false,
            stream: currentStream
        });

        peer.on("signal", (data) => {
            socket.emit("answerCall", { signal: data, to: caller });
        });

        peer.on("stream", (remoteStream) => {
            if (userVideo.current) userVideo.current.srcObject = remoteStream;
        });

        peer.signal(callerSignal);
        connectionRef.current = peer;
    } catch (err) {
        alert("Error answering call: " + err.message);
    }
  };

  const leaveCall = () => {
    setCallEnded(true);
    if (connectionRef.current) connectionRef.current.destroy();
    if (stream) stream.getTracks().forEach(track => track.stop());
    window.location.reload();
  };

  if (!isLoggedIn) {
    return (
        <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
            <form onSubmit={handleAuth} className="bg-gray-800 p-8 rounded-2xl shadow-2xl w-80 flex flex-col gap-6 transform transition hover:scale-105">
                <h2 className="text-3xl font-extrabold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">Messenger</h2>
                
                <div className="space-y-4">
                    <input className="w-full bg-gray-700 p-4 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
                    <input className="w-full bg-gray-700 p-4 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
                </div>
                
                <button className="w-full bg-gradient-to-r from-blue-600 to-purple-600 p-4 rounded-xl font-bold hover:opacity-90 transition shadow-lg">{isRegistering ? "Register" : "Login"}</button>
                
                <div className="text-center text-sm text-gray-400 cursor-pointer hover:text-white transition" onClick={()=>setIsRegistering(!isRegistering)}>
                    {isRegistering ? "Back to Login" : "Create Account"}
                </div>
                {authError && <div className="text-red-400 text-center text-sm bg-red-900/20 p-2 rounded">{authError}</div>}
            </form>
        </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden font-sans">
      
      {/* Sidebar (List) - Hidden on mobile if chat is open */}
      <div className={`${showChatOnMobile ? 'hidden' : 'flex'} md:flex w-full md:w-96 border-r border-gray-800 flex-col bg-gray-900`}>
        <div className="p-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
            <h1 className="text-2xl font-bold mb-4 px-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Chats</h1>
            <div className="relative">
                <span className="absolute left-3 top-3 text-gray-500">🔍</span>
                <input 
                    className="w-full bg-gray-800 p-3 pl-10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                    placeholder="Search people..."
                    value={searchQuery}
                    onChange={handleSearch}
                />
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Search Results */}
            {searchResults.length > 0 ? (
                <div className="p-2">
                    <div className="px-4 py-2 text-xs text-gray-500 uppercase font-bold tracking-wider">Global Search</div>
                    {searchResults.map(user => (
                        <div key={user.id} onClick={() => selectUser(user)} className="p-3 mx-2 rounded-xl hover:bg-gray-800 cursor-pointer flex items-center gap-4 transition">
                            <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center text-lg font-bold text-gray-300">
                                {user.username[0].toUpperCase()}
                            </div>
                            <div>{user.username}</div>
                        </div>
                    ))}
                </div>
            ) : (
                /* Chat List */
                <div className="p-2 space-y-1">
                    {chats.map(chat => (
                        <div 
                            key={chat.id} 
                            onClick={() => selectUser(chat)} 
                            className={`p-3 mx-2 rounded-xl cursor-pointer flex items-center gap-4 transition ${selectedUser?.id === chat.id ? 'bg-blue-600/20' : 'hover:bg-gray-800'}`}
                        >
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-xl font-bold shadow-lg">
                                {chat.username[0].toUpperCase()}
                            </div>
                            <div className="flex-1">
                                <div className="font-bold text-gray-100">{chat.username}</div>
                                <div className="text-sm text-gray-500 truncate">Tap to open chat</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
        
        <div className="p-4 border-t border-gray-800 bg-gray-900 flex justify-between items-center">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-xs">Me</div>
                <div className="font-bold text-gray-300">{me?.username}</div>
            </div>
            <button onClick={()=>{localStorage.clear(); window.location.reload()}} className="text-sm text-red-400 hover:text-red-300 transition">Logout</button>
        </div>
      </div>

      {/* Main Chat Area - Hidden on mobile if list is shown */}
      <div className={`${!showChatOnMobile ? 'hidden' : 'flex'} md:flex flex-1 flex-col bg-black/50 relative`}>
        {selectedUser ? (
            <>
                <div className="p-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center shadow-md z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={goBack} className="md:hidden text-gray-400 hover:text-white mr-2">
                            ← Back
                        </button>
                        <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center font-bold shadow-md">
                             {selectedUser.username[0].toUpperCase()}
                        </div>
                        <h3 className="font-bold text-lg">{selectedUser.username}</h3>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => startCall(false)} className="p-3 bg-gray-800 rounded-full hover:bg-gray-700 transition text-green-400" title="Audio Call">
                            📞
                        </button>
                        <button onClick={() => startCall(true)} className="p-3 bg-gray-800 rounded-full hover:bg-gray-700 transition text-blue-400" title="Video Call">
                            📹
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-900/50">
                    {(messages[selectedUser.id] || []).map((msg, i) => {
                        const isMe = msg.from_user_id === me?.id;
                        return (
                            <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] md:max-w-md p-3 px-4 rounded-2xl shadow-md ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-100 rounded-bl-none'}`}>
                                    <div className="leading-relaxed">{msg.content}</div>
                                    <div className={`text-[10px] text-right mt-1 opacity-70`}>
                                        {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                    <div ref={messagesEndRef} />
                </div>

                <ChatInput onSend={sendMessage} />
            </>
        ) : (
            <div className="hidden md:flex flex-1 flex-col items-center justify-center text-gray-600">
                <div className="text-6xl mb-6 opacity-20">💬</div>
                <div className="text-xl">Select a chat to start messaging</div>
            </div>
        )}

        {/* Call Modal */}
        {(callAccepted || receivingCall || callStatus) && !callEnded && (
             <div className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-4">
                <div className="text-2xl font-bold mb-8 animate-pulse text-white">{callStatus || "In Call"}</div>
                
                <div className="flex flex-col md:flex-row gap-4 w-full max-w-4xl">
                    {/* My Video */}
                    <div className="flex-1 relative bg-gray-800 rounded-2xl overflow-hidden aspect-video flex items-center justify-center shadow-2xl ring-1 ring-gray-700">
                        {isVideoCall ? (
                             <video playsInline muted ref={myVideo} autoPlay className="w-full h-full object-cover transform scale-x-[-1]" />
                        ) : (
                             <div className="text-4xl">🎤 Me</div>
                        )}
                        <div className="absolute bottom-4 left-4 bg-black/50 px-3 py-1 rounded-full text-xs backdrop-blur-sm">You</div>
                    </div>
                    
                    {/* Remote Video */}
                    <div className="flex-1 relative bg-gray-800 rounded-2xl overflow-hidden aspect-video flex items-center justify-center shadow-2xl ring-1 ring-gray-700">
                        {callAccepted ? (
                            <video playsInline ref={userVideo} autoPlay className="w-full h-full object-cover" />
                        ) : (
                            <div className="flex flex-col items-center gap-4">
                                <div className="w-24 h-24 bg-gray-700 rounded-full flex items-center justify-center text-4xl animate-bounce">
                                    {callerName ? callerName[0] : "👤"}
                                </div>
                                <div className="text-xl">{callerName || "Calling..."}</div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-12 flex gap-8">
                    {receivingCall && !callAccepted && (
                        <button onClick={answerCall} className="bg-green-500 hover:bg-green-600 text-white w-16 h-16 rounded-full flex items-center justify-center text-2xl shadow-lg transform hover:scale-110 transition animate-pulse">
                            📞
                        </button>
                    )}
                    <button onClick={leaveCall} className="bg-red-500 hover:bg-red-600 text-white w-16 h-16 rounded-full flex items-center justify-center text-2xl shadow-lg transform hover:scale-110 transition">
                        ❌
                    </button>
                </div>
             </div>
        )}
      </div>
    </div>
  )
}

function ChatInput({ onSend }) {
    const [text, setText] = useState("");
    return (
      <form onSubmit={(e) => { onSend(e, text); setText(""); }} className="p-3 md:p-4 bg-gray-900 border-t border-gray-800 flex gap-2 safe-area-bottom">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 p-3 md:p-4 rounded-2xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 px-5 transition"
          placeholder="Message..."
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button type="submit" className="bg-blue-600 text-white w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center hover:bg-blue-500 shadow-lg transition transform hover:scale-105 active:scale-95">
            ➤
        </button>
      </form>
    )
}

export default App
