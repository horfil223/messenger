import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import SimplePeer from 'simple-peer'
import { format } from 'date-fns' // You might need to install date-fns or use native Date

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
            <form onSubmit={handleAuth} className="bg-gray-800 p-8 rounded-lg shadow-xl w-80 flex flex-col gap-4">
                <h2 className="text-2xl font-bold text-center text-blue-400">Messenger</h2>
                <input className="bg-gray-700 p-3 rounded text-white" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
                <input className="bg-gray-700 p-3 rounded text-white" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
                <button className="bg-blue-600 p-3 rounded font-bold hover:bg-blue-500">{isRegistering ? "Register" : "Login"}</button>
                <div className="text-center text-xs text-gray-400 cursor-pointer" onClick={()=>setIsRegistering(!isRegistering)}>
                    {isRegistering ? "Back to Login" : "Create Account"}
                </div>
                {authError && <div className="text-red-400 text-center text-sm">{authError}</div>}
            </form>
        </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-80 border-r border-gray-700 flex flex-col bg-gray-800">
        <div className="p-4 border-b border-gray-700">
            <input 
                className="w-full bg-gray-700 p-2 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search users..."
                value={searchQuery}
                onChange={handleSearch}
            />
        </div>
        
        <div className="flex-1 overflow-y-auto">
            {/* Search Results */}
            {searchResults.length > 0 ? (
                <div>
                    <div className="p-2 text-xs text-gray-400 uppercase font-bold">Search Results</div>
                    {searchResults.map(user => (
                        <div key={user.id} onClick={() => selectUser(user)} className="p-3 hover:bg-gray-700 cursor-pointer flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-lg font-bold">
                                {user.username[0].toUpperCase()}
                            </div>
                            <div>{user.username}</div>
                        </div>
                    ))}
                </div>
            ) : (
                /* Chat List */
                <div>
                    {chats.map(chat => (
                        <div 
                            key={chat.id} 
                            onClick={() => selectUser(chat)} 
                            className={`p-3 hover:bg-gray-700 cursor-pointer flex items-center gap-3 border-b border-gray-700 ${selectedUser?.id === chat.id ? 'bg-gray-700' : ''}`}
                        >
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-xl font-bold">
                                {chat.username[0].toUpperCase()}
                            </div>
                            <div>
                                <div className="font-bold">{chat.username}</div>
                                <div className="text-xs text-gray-400">Tap to chat</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
        
        <div className="p-4 border-t border-gray-700 bg-gray-800 flex justify-between items-center">
            <div className="text-sm font-bold text-gray-300">{me?.username}</div>
            <button onClick={()=>{localStorage.clear(); window.location.reload()}} className="text-xs text-red-400 hover:text-red-300">Logout</button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-gray-900 relative">
        {selectedUser ? (
            <>
                <div className="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center shadow-md z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center font-bold">
                             {selectedUser.username[0].toUpperCase()}
                        </div>
                        <h3 className="font-bold text-lg">{selectedUser.username}</h3>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => startCall(false)} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600 transition" title="Audio Call">
                            📞
                        </button>
                        <button onClick={() => startCall(true)} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600 transition" title="Video Call">
                            📹
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {(messages[selectedUser.id] || []).map((msg, i) => {
                        const isMe = msg.from_user_id === me?.id;
                        return (
                            <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-md p-3 rounded-2xl shadow-md ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-100 rounded-bl-none'}`}>
                                    <div>{msg.content}</div>
                                    <div className={`text-[10px] text-right mt-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
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
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                <div className="text-6xl mb-4">💬</div>
                <div>Select a chat to start messaging</div>
            </div>
        )}

        {/* Call Modal */}
        {(callAccepted || receivingCall || callStatus) && !callEnded && (
             <div className="absolute inset-0 bg-black bg-opacity-95 z-50 flex flex-col items-center justify-center">
                <div className="text-2xl font-bold mb-8 animate-pulse">{callStatus || "In Call"}</div>
                
                <div className="grid grid-cols-2 gap-4 w-full max-w-4xl p-4">
                    {/* My Video */}
                    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
                        {isVideoCall ? (
                             <video playsInline muted ref={myVideo} autoPlay className="w-full h-full object-cover" />
                        ) : (
                             <div className="text-4xl">🎤 Me</div>
                        )}
                    </div>
                    
                    {/* Remote Video */}
                    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
                        {callAccepted ? (
                            <video playsInline ref={userVideo} autoPlay className="w-full h-full object-cover" />
                        ) : (
                            <div className="text-4xl">👤 {callerName || "Calling..."}</div>
                        )}
                    </div>
                </div>

                <div className="mt-8 flex gap-6">
                    {receivingCall && !callAccepted && (
                        <button onClick={answerCall} className="bg-green-500 hover:bg-green-600 text-white px-8 py-4 rounded-full text-xl font-bold shadow-lg transform hover:scale-105 transition">
                            Answer
                        </button>
                    )}
                    <button onClick={leaveCall} className="bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-full text-xl font-bold shadow-lg transform hover:scale-105 transition">
                        End Call
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
      <form onSubmit={(e) => { onSend(e, text); setText(""); }} className="p-4 bg-gray-800 border-t border-gray-700 flex gap-2">
        <input
          className="flex-1 bg-gray-700 border border-gray-600 p-3 rounded-full text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 px-6"
          placeholder="Message..."
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button type="submit" className="bg-blue-600 text-white w-12 h-12 rounded-full flex items-center justify-center hover:bg-blue-500 shadow-lg transition transform hover:scale-105">
            ➤
        </button>
      </form>
    )
}

export default App
