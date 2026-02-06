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

  // App State
  const [users, setUsers] = useState([]); 
  const [selectedUser, setSelectedUser] = useState(null); 
  const [chats, setChats] = useState({}); 
  const [me, setMe] = useState("");
  const [isConnected, setIsConnected] = useState(socket.connected);

  // WebRTC State
  const [stream, setStream] = useState(null);
  const [receivingCall, setReceivingCall] = useState(false);
  const [caller, setCaller] = useState("");
  const [callerSignal, setCallerSignal] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [callerName, setCallerName] = useState("");
  const [callStatus, setCallStatus] = useState(""); // "Calling...", "Connecting..."

  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();

  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on("me", (id) => setMe(id));
    
    socket.on("users", (userList) => {
      setUsers(userList.filter(u => u.id !== socket.id));
    });

    socket.on("private message", ({ content, from, username }) => {
      setChats(prevChats => {
        const userChat = prevChats[from] || [];
        return {
          ...prevChats,
          [from]: [...userChat, { text: content, fromSelf: false }]
        };
      });
    });

    // Auth Events
    socket.on('register_success', () => {
      setAuthError("");
      alert("Registration successful! You can now login.");
      setIsRegistering(false);
    });
    socket.on('register_error', (msg) => setAuthError(msg));
    socket.on('login_success', (user) => {
      setAuthError("");
      setIsLoggedIn(true);
      startCamera(); // Try to start camera on login
    });
    socket.on('login_error', (msg) => setAuthError(msg));

    // WebRTC Events
    socket.on("callUser", (data) => {
      setReceivingCall(true);
      setCaller(data.from);
      setCallerName(data.name);
      setCallerSignal(data.signal);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('me');
      socket.off('users');
      socket.off('private message');
      socket.off('register_success');
      socket.off('register_error');
      socket.off('login_success');
      socket.off('login_error');
      socket.off('callUser');
    };
  }, []);

  const handleAuth = (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    if (isRegistering) {
      socket.emit('register', { username, password });
    } else {
      socket.emit('login', { username, password });
    }
  };

  const startCamera = async () => {
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(currentStream);
      if (myVideo.current) myVideo.current.srcObject = currentStream;
      return currentStream;
    } catch (err) {
      console.error("Camera error:", err);
      alert("Could not access camera/microphone. Please check permissions.");
      return null;
    }
  };

  const sendMessage = (e, text) => {
    e.preventDefault();
    if (!text || !selectedUser) return;
    socket.emit("private message", { content: text, to: selectedUser.id });
    setChats(prevChats => {
      const userChat = prevChats[selectedUser.id] || [];
      return {
        ...prevChats,
        [selectedUser.id]: [...userChat, { text: text, fromSelf: true }]
      };
    });
  };

  // --- WebRTC Logic ---
  const initiateCall = async (id) => {
    let currentStream = stream;
    if (!currentStream) {
      currentStream = await startCamera();
    }
    if (!currentStream) return; // Failed to get camera

    setCallStatus("Calling...");
    
    const peer = new SimplePeer({
      initiator: true,
      trickle: false,
      stream: currentStream
    });

    peer.on("signal", (data) => {
      socket.emit("callUser", {
        userToCall: id,
        signalData: data,
        from: me,
        name: username
      });
    });

    peer.on("stream", (remoteStream) => {
      setCallStatus("");
      if (userVideo.current) userVideo.current.srcObject = remoteStream;
    });
    
    peer.on("error", err => {
        console.error("Peer error:", err);
        setCallStatus("Call Failed");
    });

    socket.on("callAccepted", (signal) => {
      setCallAccepted(true);
      setCallStatus("Connecting...");
      peer.signal(signal);
    });

    connectionRef.current = peer;
  };

  const answerCall = () => {
    setCallAccepted(true);
    setCallStatus("Connecting...");
    
    const peer = new SimplePeer({
      initiator: false,
      trickle: false,
      stream: stream
    });

    peer.on("signal", (data) => {
      socket.emit("answerCall", { signal: data, to: caller });
    });

    peer.on("stream", (remoteStream) => {
      setCallStatus("");
      if (userVideo.current) userVideo.current.srcObject = remoteStream;
    });

    peer.signal(callerSignal);
    connectionRef.current = peer;
  };

  const leaveCall = () => {
    setCallEnded(true);
    if (connectionRef.current) connectionRef.current.destroy();
    window.location.reload();
  };

  // --- RENDER ---
  if (!isLoggedIn) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-xl w-96">
          <h1 className="text-2xl font-bold mb-6 text-center text-blue-600">Messenger</h1>
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <input
              className="border p-3 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
            <input
              type="password"
              className="border p-3 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            {authError && <div className="text-red-500 text-sm text-center">{authError}</div>}
            
            <button type="submit" className="bg-blue-600 text-white p-3 rounded font-bold hover:bg-blue-700 transition">
              {isRegistering ? "Register" : "Login"}
            </button>
            
            <div className="text-center text-sm text-gray-500 cursor-pointer hover:underline" onClick={() => { setIsRegistering(!isRegistering); setAuthError(""); }}>
              {isRegistering ? "Already have an account? Login" : "Don't have an account? Register"}
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <div className="w-1/4 bg-white border-r flex flex-col">
        <div className="p-4 bg-blue-600 text-white shadow">
          <h2 className="font-bold text-lg">Chats</h2>
          <div className="text-xs opacity-80">{username}</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {users.length === 0 ? (
            <div className="p-4 text-gray-500 text-center">No one else is online</div>
          ) : (
            users.map(user => (
              <div 
                key={user.id}
                onClick={() => setSelectedUser(user)}
                className={`p-4 border-b cursor-pointer hover:bg-gray-50 transition ${selectedUser?.id === user.id ? 'bg-blue-50 border-l-4 border-blue-600' : ''}`}
              >
                <div className="font-bold text-gray-800">{user.username}</div>
                <div className="text-xs text-gray-500">Online</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col relative">
        {selectedUser ? (
          <>
            <div className="p-4 bg-white border-b flex justify-between items-center shadow-sm z-10">
              <h3 className="font-bold text-lg text-gray-800">{selectedUser.username}</h3>
              <div className="flex gap-2">
                {!callAccepted && (
                  <button 
                    onClick={() => initiateCall(selectedUser.id)}
                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded shadow transition flex items-center gap-2"
                  >
                    <span>📞</span> Call
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {(chats[selectedUser.id] || []).map((msg, idx) => (
                <div key={idx} className={`flex ${msg.fromSelf ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs p-3 rounded-lg shadow-sm ${msg.fromSelf ? 'bg-blue-500 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
            <ChatInput onSend={sendMessage} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Select a user</div>
        )}

        {(callAccepted || receivingCall) && !callEnded && (
          <div className="absolute inset-0 bg-black bg-opacity-95 z-50 flex flex-col items-center justify-center">
            {callStatus && <div className="text-white text-xl mb-4 animate-pulse">{callStatus}</div>}
            
            <div className="grid grid-cols-2 gap-4 w-full max-w-4xl p-4">
              <div className="relative">
                 <video playsInline muted ref={myVideo} autoPlay className="w-full rounded-lg border-2 border-gray-700 bg-gray-900" />
                 <span className="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 rounded">Me</span>
              </div>
              <div className="relative">
                 {callAccepted && <video playsInline ref={userVideo} autoPlay className="w-full rounded-lg border-2 border-gray-700 bg-gray-900" />}
                 <span className="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 rounded">{callerName || "Friend"}</span>
              </div>
            </div>
            
            <div className="mt-6 flex gap-4">
              {receivingCall && !callAccepted && (
                <button onClick={answerCall} className="bg-green-500 text-white px-8 py-3 rounded-full text-xl font-bold animate-pulse">
                  Answer Call
                </button>
              )}
              <button onClick={leaveCall} className="bg-red-600 text-white px-8 py-3 rounded-full text-xl font-bold hover:bg-red-700">
                End Call
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatInput({ onSend }) {
  const [text, setText] = useState("");
  return (
    <form onSubmit={(e) => { onSend(e, text); setText(""); }} className="p-4 bg-white border-t flex gap-2">
      <input
        className="flex-1 border p-3 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400 px-6"
        placeholder="Type a message..."
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <button type="submit" className="bg-blue-600 text-white w-12 h-12 rounded-full flex items-center justify-center hover:bg-blue-700 shadow transition">➤</button>
    </form>
  )
}

export default App
