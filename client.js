document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // STATE MANAGEMENT & PERSISTENCE
    let currentUser = localStorage.getItem('vibefy_username') || ""; 
    let userDisplayPicture = localStorage.getItem('vibefy_dp') || "";
    let currentChatPartner = "";
    let chatPreviews = {}; 
    let unreadChats = new Set(); 
    let allUsersForSearch = [];

//Calling feature

    let localStream = null;
    let peerConnection;
    let activeCallUser = "";

// WEBRTC BULLETPROOF LOGIC (ICE QUEUE & CAMERA FIX)

const peerConnectionConfig = {
    'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]
};

window.iceCandidatesQueue = []; // Network data ko rok kar rakhne ke liye

// 1. Camera / Mic Access
window.startMediaAccess = async (callType) => {
    document.getElementById('calling-user-name').innerText = window.activeCallUser || "Calling...";
    document.getElementById('video-call-modal').classList.remove('hidden');
    if (callType === 'audio') {
        document.getElementById('local-video').style.display = 'none';
    } else {
        document.getElementById('local-video').style.display = 'block';
    }

    try {
        const constraints = {
            audio: true,
            video: callType === 'video' 
        };
        window.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (callType === 'video') {
            document.getElementById('local-video').srcObject = window.localStream;
        }
        console.log(`${callType} access success!`);
    } catch (error) {
        console.error("Media Hardware Error:", error);
        window.localStream = new MediaStream(); 
    }
};
// Peer Connection Setup
window.createPeerConnection = () => {
    window.peerConnection = new RTCPeerConnection(peerConnectionConfig);

    if (window.localStream && window.localStream.getTracks().length > 0) {
        window.localStream.getTracks().forEach(track => {
            window.peerConnection.addTrack(track, window.localStream);
        });
    }

    window.peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log("BADI SCREEN WALI VIDEO AA GAYI!");
        }
    };

    window.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                to: window.activeCallUser,
                candidate: event.candidate
            });
        }
    };
};

// Start Call
window.startCall = async (username, type) => {
    window.activeCallUser = username;
    await window.startMediaAccess(type); 
    window.createPeerConnection();

    const offer = await window.peerConnection.createOffer();
    await window.peerConnection.setLocalDescription(offer);
    
    // Server ko type bhi bhej rahe hain
    socket.emit('call-user', { to: username, offer: offer, callType: type }); 
};

window.isEndingCall = false; 

window.endCall = () => {
    if (window.isEndingCall) return; 
    window.isEndingCall = true; 
    let userToDisconnect = window.activeCallUser;
    if (!userToDisconnect || userToDisconnect === "") {
        const headerName = document.getElementById('chat-header-name').innerText.trim();
        if (headerName !== "Select a user to Chat" && headerName !== "") {
            userToDisconnect = headerName;
        }
    }

    // Sirf receiver ko signal bhejo
    if (userToDisconnect) {
        socket.emit('end-call', { to: userToDisconnect });
    }

    closeCallUIAndCamera();
    window.activeCallUser = ""; 

    setTimeout(() => { window.isEndingCall = false; }, 1000); 
};

socket.off('call-ended'); 
socket.on('call-ended', () => {
    if (window.isEndingCall) return; 
    window.isEndingCall = true;
    alert("Call Ended by the other person..."); 
    closeCallUIAndCamera();
    window.activeCallUser = ""; 
    setTimeout(() => { window.isEndingCall = false; }, 1000);
});

// Common Cleanup Function
function closeCallUIAndCamera() {
    const modal = document.getElementById('video-call-modal');
    if(modal) modal.classList.add('hidden');
    if (window.localStream) {
        window.localStream.getTracks().forEach(track => track.stop());
        window.localStream = null;
    }
    const localVid = document.getElementById('local-video');
    const remoteVid = document.getElementById('remote-video');
    if(localVid) localVid.srcObject = null;
    if(remoteVid) remoteVid.srcObject = null;
    if (window.peerConnection) {
        window.peerConnection.close();
        window.peerConnection = null;
    }
    window.iceCandidatesQueue = [];
    
    // Mute reset
    window.isMuted = false; 
    const muteBtn = document.getElementById('mute-audio-btn');
    const muteIcon = document.getElementById('mute-icon');
    if(muteBtn && muteIcon) {
        muteBtn.classList.remove('muted');
        muteBtn.style.background = 'rgba(255, 255, 255, 0.1)';
        muteBtn.style.color = 'white';
        muteIcon.classList.remove('fa-microphone-slash');
        muteIcon.classList.add('fa-microphone');
    }
}

// Jab Call Aati Hai
socket.on('call-made', async (data) => {
    // Popup mein likh kar aayega ki "Incoming Voice/Video call..."
    const callText = data.callType === 'audio' ? 'Voice' : 'Video';
    const acceptCall = confirm(`Incoming ${callText} call from ${data.from}. Accept?`);
    
    if (acceptCall) {
        window.activeCallUser = data.from;
        
        // Receiver bhi same type ki call open karega
        await window.startMediaAccess(data.callType); 
        window.createPeerConnection();

        await window.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await window.peerConnection.createAnswer();
        await window.peerConnection.setLocalDescription(answer);

        socket.emit('make-answer', { to: data.from, answer: answer });
        
        window.iceCandidatesQueue.forEach(c => window.peerConnection.addIceCandidate(new RTCIceCandidate(c)));
        window.iceCandidatesQueue = [];
    }
});

// Jab samne wale ne call cut kar di ho
socket.on('call-ended', () => {
    console.log("Call Ended...");
    window.endCall(true);
});

socket.on('answer-made', async (data) => {
    await window.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    window.iceCandidatesQueue.forEach(c => window.peerConnection.addIceCandidate(new RTCIceCandidate(c)));
    window.iceCandidatesQueue = [];
    console.log("Connection Established!");
});

socket.on('ice-candidate', async (data) => {
    if (window.peerConnection && window.peerConnection.remoteDescription && window.peerConnection.remoteDescription.type) {
        await window.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else {
        window.iceCandidatesQueue.push(data.candidate);
    }
});
     
window.updateSidebarList = (username, msgText, isUnread = false) => {
    if (!username || !currentUser || username.toLowerCase() === currentUser.toLowerCase()) return;
    const userListDiv = document.getElementById('dynamic-user-list');
    let userItem = Array.from(userListDiv.children).find(item => 
        item.querySelector('.name') && item.querySelector('.name').innerText.toLowerCase() === username.toLowerCase()
    );
    const initial = username.charAt(0).toUpperCase();
    if (!userItem) {
        userItem = document.createElement('div');
        userItem.className = 'contact-item';
        userItem.innerHTML = `
            <div class="avatar-wrapper">
                <div class="default-avatar dp-placeholder">${initial}</div>
                <img src="" class="squircle dp-img hidden" style="width:45px; height:45px; object-fit:cover;">
                <span class="status-dot" style="background: #656570;"></span> 
            </div>
            <div class="contact-info">
                <span class="name">${username}</span>
                <span class="preview"></span>
            </div>
            <button class="delete-chat-btn" onclick="deleteConversation('${username}', event)" title="Clear Chat">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;
        userItem.onclick = () => {
            window.startPrivateChat(username);
            document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
            userItem.classList.add('active');
            document.getElementById('call-buttons-container').classList.remove('hidden');
        };
        userListDiv.appendChild(userItem);
    } else {
        if (msgText !== "Online" && msgText !== "Tap to chat") {
            userListDiv.prepend(userItem);
        }
    }

    let previewEl = userItem.querySelector('.preview');
    if (msgText) {
        if (isUnread) {
            previewEl.innerHTML = `<b style="font-weight: 900;">${msgText}</b> <span style="display:inline-block; width:8px; height:8px; background:#ff4d4d; border-radius:50%; margin-left:5px;"></span>`;
        } else {
            if (msgText === "Online" && previewEl.innerText !== "" && previewEl.innerText !== "Online" && previewEl.innerText !== "Tap to chat") {
            } else {
                previewEl.innerText = msgText;
            }
        }
    }

    // DP Fetch Logic
    if (userItem.querySelector('.dp-img').classList.contains('hidden')) {
        fetch('/api/profile/' + username).then(res => res.json()).then(data => {
            let fetchedDp = data.dp_path;
            if (!fetchedDp || fetchedDp === "" || fetchedDp.includes('pravatar')) {
                fetchedDp = 'default-avatar.png';
            }
            userItem.querySelector('.dp-img').src = fetchedDp;
            userItem.querySelector('.dp-img').classList.remove('hidden');
            userItem.querySelector('.dp-placeholder').classList.add('hidden');
        }).catch(() => {});
    }
};


    // INSTANT RECENT CHATS LOAD 
    window.loadRecentChats = async () => {
        if (!currentUser) return;
        try {
            const res = await fetch('/api/recent-chats/' + currentUser);
            const partners = await res.json();
            
            partners.forEach(partner => {
                if (partner.username.toLowerCase() !== currentUser.toLowerCase()) {
                    window.updateSidebarList(partner.username, partner.last_message || "Tap to chat", false);
                }
            });
        } catch (e) { console.error("Recent chats load error:", e); }
    };

    window.startPrivateChat = async (username) => {
        currentChatPartner = username;
        document.getElementById('chat-header-name').innerText = username;
        document.getElementById('typing-indicator').classList.add('hidden'); 
        document.getElementById('input-area').classList.remove('disabled-area');
        
        // Unread highlight hatana jab chat open ho 
        unreadChats.delete(username);
        const userItem = Array.from(document.getElementById('dynamic-user-list').children).find(i => i.querySelector('.name').innerText === username);
        if (userItem) {
            const previewEl = userItem.querySelector('.preview');
            previewEl.innerText = previewEl.textContent;
        }
        
        const chatHeaderDP = document.getElementById('chat-header-avatar');
        try {
            const response = await fetch('/api/profile/' + username);
            const profileData = await response.json();
            if (profileData.dp_path) {
                chatHeaderDP.src = profileData.dp_path;
                chatHeaderDP.classList.remove('hidden');
            } else {
                chatHeaderDP.classList.add('hidden'); 
            }
        } catch (error) { chatHeaderDP.classList.add('hidden'); }
        
        const msgContainer = document.getElementById('messages-container');
        msgContainer.innerHTML = '<div class="time-divider">Chatting securely with ' + username + '</div>';

        try {
            const historyRes = await fetch('/api/messages/' + currentUser + '/' + username);
            const messages = await historyRes.json();
            
            messages.forEach(msg => {
                const msgType = msg.sender === currentUser ? 'sent' : 'received';
                const dateObj = new Date(msg.created_at);
                const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                window.appendMessageToDom({
                    id: msg.id, sender: msg.sender, text: msg.text, img: msg.img, 
                    time: timeString, status: msg.status, deleted_everyone: msg.deleted_everyone 
                }, msgType);
            });
            
            socket.emit('mark_read', { sender: username, recipient: currentUser });
            msgContainer.scrollTop = msgContainer.scrollHeight;
        } catch (error) { console.error("Failed to load chat history:", error); }
    };

    if (currentUser) {
        socket.emit('auto_login', currentUser);
        window.loadRecentChats();
    }

    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        const savedUser = localStorage.getItem('vibefy_username');
        const savedDp = localStorage.getItem('vibefy_dp');
        if (savedUser) {
            document.getElementById('main-app').classList.remove('hidden');
            updateHeaderUI(savedUser, savedDp);
        } else {
            document.getElementById('auth-container').classList.remove('hidden');
        }
        splash.style.opacity = '0';
        splash.style.transition = 'opacity 0.5s ease-out';
        setTimeout(() => splash.classList.add('hidden'), 500);
    }, 3200);

    function updateHeaderUI(username, dp) {
    const nameEl = document.getElementById('header-mini-name');
    const dpEl = document.getElementById('header-mini-dp');
    const profileName = document.getElementById('profile-username-display');
    const profileDp = document.getElementById('profile-dp-display'); 
    let finalDp = dp;
    if (!finalDp || finalDp === "" || finalDp.includes('pravatar')) {
        finalDp = 'default-avatar.png';
    }

    if(nameEl) nameEl.innerText = username;
    if(dpEl) dpEl.src = finalDp;
    if(profileName) profileName.innerText = username;
    if(profileDp) profileDp.src = finalDp;
}

    // AUTHENTICATION (LOGIN/REGISTER/LOGOUT)
    window.toggleAuth = () => {
        document.getElementById('login-box').classList.toggle('hidden');
        document.getElementById('register-box').classList.toggle('hidden');
        document.getElementById('auth-error-msg').innerText = "";
    };

   window.register = () => {
    const usernameVal = document.getElementById('reg-username').value.trim();
    const passwordVal = document.getElementById('reg-password').value.trim();
    if (usernameVal === "" || passwordVal === "") {
        alert("Bhai, dono fields (Username aur Password) bharna zaroori hai!");
        return;
    }
    console.log("Registering user:", usernameVal);

    // Backend (server) ko data bhejna 
    if (typeof socket !== 'undefined') {
        socket.emit('register', { username: usernameVal, password: passwordVal });
    } else {
        console.error("Socket connect nahi hua hai!");
    }
};

// Camera Access
window.startVideoCallTest = async () => {
    document.getElementById('video-call-modal').classList.remove('hidden'); 
    try {
        window.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = window.localStream;
        console.log("Camera access success!");
    } catch (error) {
        console.error("Camera Hardware Locked by Tab 1:", error);
        window.localStream = new MediaStream();
        console.log("Camera nahi mila, par connection chalu hai!");
    }
};

    window.login = () => {
        const u = document.getElementById('login-username').value.trim();
        const p = document.getElementById('login-password').value.trim();
        const msg = document.getElementById('auth-error-msg');
        if(!u || !p) { msg.innerText = "Please enter both fields."; return; }
        msg.innerText = "Processing...";
        socket.emit('login', { username: u, password: p });
    };

    window.logout = () => {
        localStorage.clear();
        socket.disconnect();
        window.location.reload();
    };

    socket.on('auth error', (msg) => { document.getElementById('auth-error-msg').innerText = msg; });
    
    socket.on('register success', () => {
        alert("Registration successful! You can now log in.");
        toggleAuth();
    });

    socket.on('login success', (data) => {
    currentUser = data.username;
    
    // THE ANTI-PRAVATAR SHIELD
    let incomingDp = data.dp || "";
    if (incomingDp.includes('pravatar')) {
        incomingDp = 'default-avatar.png';
    }
    
    userDisplayPicture = incomingDp;
    localStorage.setItem('vibefy_username', currentUser);
    localStorage.setItem('vibefy_dp', userDisplayPicture);
    updateHeaderUI(currentUser, userDisplayPicture);
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    window.goHome();
    window.loadRecentChats();
});

    // UI NAVIGATION & MESSAGING
    window.goHome = () => {
        currentChatPartner = "";
        document.getElementById('chat-header-name').innerText = "Select a user to chat privately";
        document.getElementById('chat-header-avatar').classList.add('hidden');
        document.getElementById('typing-indicator').classList.add('hidden'); 
        
        document.getElementById('messages-container').innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); text-align:center;">
                <i class="fas fa-paper-plane" style="font-size: 60px; margin-bottom: 20px; opacity: 0.3;"></i>
                <h2>Welcome to Vibefy</h2>
                <p>Select a chat from the sidebar or start a new conversation.</p>
            </div>
        `;
        document.getElementById('input-area').classList.add('disabled-area');
        document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    };

    window.sendPrivateMessage = () => {
        const chatInput = document.getElementById('chat-input');
        const text = chatInput.value.trim();
        if (!text || !currentChatPartner) return;
        const msgData = { 
            sender: currentUser, recipient: currentChatPartner, 
            text: text, img: null, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'sent' 
        };
        socket.emit('private message', msgData);
        chatInput.value = '';
        document.getElementById('emoji-picker').classList.add('hidden'); 
        socket.emit('typing', { sender: currentUser, recipient: currentChatPartner, isTyping: false });
    };
    document.getElementById('send-btn').addEventListener('click', window.sendPrivateMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') window.sendPrivateMessage(); });
    window.triggerMediaUpload = () => {
        if(!currentChatPartner) return alert("Select a user to chat first!");
        document.getElementById('media-upload').click();
    };

    document.getElementById('media-upload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file && currentChatPartner) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const imgData = event.target.result;
                const msgData = { 
                    sender: currentUser, recipient: currentChatPartner,
                    text: "", img: imgData, 
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    status: 'sent'
                };
                socket.emit('private message', msgData); 
            };
            reader.readAsDataURL(file);
        }
    });

    window.toggleEmojiPicker = () => { document.getElementById('emoji-picker').classList.toggle('hidden'); };
    window.addEmoji = (emoji) => {
        const input = document.getElementById('chat-input');
        input.value += emoji;
        input.focus(); 
    };

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.input-wrapper')) {
            const picker = document.getElementById('emoji-picker');
            if (picker && !picker.classList.contains('hidden')) picker.classList.add('hidden');
        }
    });

    window.appendMessageToDom = (data, type) => {
        const div = document.createElement('div');
        div.className = "message " + type;
        div.id = `msg-${data.id}`; 
        const isDeleted = data.deleted_everyone ? true : false;
        const bubbleClass = isDeleted ? 'bubble deleted-bubble' : 'bubble';
        let content = `<div class="${bubbleClass}">`;
        if (isDeleted) {
            content += '<span class="msg-text deleted-msg">↩️ < System: Message retracted by sender ></span>';
        } else {
            if (data.text) content += `<span class="msg-text">${data.text}</span>`;
            if (data.img) content += `<img src="${data.img}" class="shared-image" alt="Shared Media">`;
        }
        content += '</div>';
        let statusHtml = '';
        if (type === 'sent') {
            const isRead = (data.status && data.status.toLowerCase() === 'read');
            const statusClass = isRead ? 'status-read' : 'status-sent';
            const statusText = isRead ? 'Read' : 'Sent';
            statusHtml = `<span class="msg-status-text ${statusClass}">${statusText}</span>`;
        }
        const isSender = (type === 'sent');
        const trashIcon = `<i class="fas fa-ellipsis-v msg-options" onclick="showDeleteMenu(event, ${data.id}, ${isSender}, ${isDeleted})"></i>`;
        content += `<div class="msg-info"><span class="sender-name">${data.time}</span>${statusHtml}${trashIcon}</div>`;
        div.innerHTML = content;
        const msgContainer = document.getElementById('messages-container');
        msgContainer.appendChild(div);
        msgContainer.scrollTop = msgContainer.scrollHeight;
    };

    // REAL-TIME SOCKET EVENTS
    socket.on('message_sent_success', (data) => {
        if (data.recipient === currentChatPartner) {
            window.appendMessageToDom(data, 'sent');
        }
        const msgSnippet = data.text ? data.text : "📷 Photo";
        window.updateSidebarList(data.recipient, "You: " + msgSnippet, false); 
    });

    socket.on('private message', (data) => {
        if (data.sender === currentChatPartner) {
            window.appendMessageToDom(data, 'received');
            socket.emit('mark_read', { sender: data.sender, recipient: currentUser });
            window.updateSidebarList(data.sender, data.text || "📷 Photo", false);
        } else {
            unreadChats.add(data.sender);
            window.updateSidebarList(data.sender, data.text || "📷 Photo", true); // Unread Badge Trigger!
        }
    });

    socket.on('messages_read_by_recipient', (data) => {
        if (data.reader === currentChatPartner) {
            document.querySelectorAll('.msg-status-text.status-sent').forEach(el => {
                el.className = 'msg-status-text status-read';
                el.innerHTML = 'Read'; 
            });
        }
    });

    // TYPING INDICATOR NAME 
    let typingTimer;
    document.getElementById('chat-input').addEventListener('input', () => {
        if (!currentChatPartner) return;
        socket.emit('typing', { sender: currentUser, recipient: currentChatPartner, isTyping: true });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            socket.emit('typing', { sender: currentUser, recipient: currentChatPartner, isTyping: false });
        }, 1000);
    });

    socket.on('typing', (data) => {
        const typingIndicator = document.getElementById('typing-indicator');
        if (data.sender === currentChatPartner) { 
            if (data.isTyping) {
                typingIndicator.innerText = `${currentChatPartner} is typing...`;
                typingIndicator.classList.remove('hidden');
            } else {
                typingIndicator.classList.add('hidden');
            }
        }
    });

    // Asli Online Status Check
socket.on('user list update', (onlineUsersData) => {
    const userListDiv = document.getElementById('dynamic-user-list');
    if (!userListDiv) return;
    const allDots = userListDiv.querySelectorAll('.status-dot');
    allDots.forEach(dot => {
        dot.classList.remove('online');
        dot.style.background = "#656570";
    });

    // Jo sach mein server list mein hain unko Online(Green) krne ke liye
    onlineUsersData.forEach(userData => {
        if (userData.username === currentUser) return; 
        let existingItem = Array.from(userListDiv.children).find(item => 
            item.querySelector('.name') && item.querySelector('.name').innerText === userData.username
        );
        if (!existingItem) {

            window.updateSidebarList(userData.username, "Online", false);
            setTimeout(() => {
                let newItem = Array.from(userListDiv.children).find(item => item.querySelector('.name').innerText === userData.username);
                if (newItem && newItem.querySelector('.status-dot')) {
                    newItem.querySelector('.status-dot').classList.add('online');
                    newItem.querySelector('.status-dot').style.background = "#22c55e"; // Green dot
                }
            }, 50); // DOM update hone ka chota sa wait
        } else {
            const dot = existingItem.querySelector('.status-dot');
            if (dot) {
                dot.classList.add('online');
                dot.style.background = "#22c55e"; 
            }
        }
    });
});

    // DELETION LOGIC (MESSAGES, CHAT, ACC)
    window.showDeleteMenu = (event, id, isSender, isAlreadyDeleted) => {
        document.querySelectorAll('.msg-actions').forEach(el => el.remove());
        const menu = document.createElement('div');
        menu.className = 'msg-actions';
        menu.style.left = (event.pageX - 130) + 'px'; 
        menu.style.top = (event.pageY - 5) + 'px';
        let html = `<button onclick="deleteMessage(${id}, 'me')"><i class="fas fa-trash"></i> Delete for Me</button>`;
        if (isSender && !isAlreadyDeleted) {
            html += `<button onclick="deleteMessage(${id}, 'everyone')" class="text-danger"><i class="fas fa-ban"></i> Delete for Everyone</button>`;
        }
        menu.innerHTML = html;
        document.body.appendChild(menu);
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                if(menu) menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 100);
    };

    window.deleteMessage = (id, type) => {
        socket.emit('delete_message', { id, type, user: currentUser });
        if (type === 'me') {
            const msgEl = document.getElementById(`msg-${id}`);
            if (msgEl) msgEl.remove();
        }
    };

    socket.on('message_deleted_everyone', (data) => {
        const msgEl = document.getElementById(`msg-${data.id}`);
        if (msgEl) {
            const bubble = msgEl.querySelector('.bubble');
            if (bubble) {
                bubble.className = 'bubble deleted-bubble';
                bubble.innerHTML = '<span class="msg-text deleted-msg">↩️ < System: Message retracted by sender ></span>';
            }
            const trashIcon = msgEl.querySelector('.msg-options');
            if (trashIcon) {
                const isSender = msgEl.classList.contains('sent');
                trashIcon.setAttribute('onclick', `showDeleteMenu(event, ${data.id}, ${isSender}, true)`);
            }
        }
    });

    window.deleteConversation = (partner, event) => {
        event.stopPropagation(); 
        if (confirm(`Are you sure you want to clear your entire chat with ${partner}?`)) {
            socket.emit('delete_conversation', { user: currentUser, partner: partner });
        }
    };

    socket.on('conversation_deleted_success', (partner) => {
        const items = document.querySelectorAll('.contact-item');
        items.forEach(item => {
            if (item.querySelector('.name').innerText === partner) item.remove();
        });
        delete chatPreviews[partner];
        if (currentChatPartner === partner) window.goHome(); 
    });

    window.deleteMyAccount = () => {
        if (confirm("Are you 100% sure you want to delete your account? All your chats and profile will be permanently wiped!")) {
            socket.emit('delete_account', currentUser);
        }
    };

    socket.on('account_deleted_success', () => {
        alert("Your account and all data have been completely deleted.");
        window.logout();
    });

    // PROFILE, SETTINGS & SEARCH
    window.toggleTheme = () => {
        document.body.classList.toggle('dark-theme');
        document.body.classList.toggle('light-theme');
        document.getElementById('settings-menu').classList.add('hidden');
    };

    window.toggleProfileModal = () => {
    document.getElementById('profile-modal').classList.toggle('hidden');
    document.getElementById('settings-menu').classList.add('hidden'); 
    document.getElementById('profile-view-section').classList.remove('hidden');
    document.getElementById('profile-edit-section').classList.add('hidden');
    fetch('/api/profile/' + currentUser)
        .then(res => res.json())
        .then(data => {
            document.getElementById('profile-username-display').innerText = data.username;
            document.getElementById('profile-bio-display').innerText = data.bio || 'Sharing vibes on Vibefy!';
            let fetchedDp = data.dp_path;
            if (!fetchedDp || fetchedDp === "" || fetchedDp.includes('pravatar')) {
                fetchedDp = 'default-avatar.png';
            }
            document.getElementById('profile-dp-display').src = fetchedDp;
        });
};

    window.toggleEditProfileSection = () => {
        const view = document.getElementById('profile-view-section');
        const edit = document.getElementById('profile-edit-section');
        view.classList.toggle('hidden');
        edit.classList.toggle('hidden');
        if (!edit.classList.contains('hidden')) {
            document.getElementById('profile-dp-edit-preview').src = document.getElementById('profile-dp-display').src;
            document.getElementById('profile-bio-edit').value = document.getElementById('profile-bio-display').innerText;
        }
    };

    document.getElementById('dp-upload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => { document.getElementById('profile-dp-edit-preview').src = event.target.result; };
            reader.readAsDataURL(file);
        }
    });

    window.saveProfileChanges = () => {
        const bio = document.getElementById('profile-bio-edit').value.trim();
        const dpFile = document.getElementById('dp-upload').files[0];
        const saveBtn = document.querySelector('#profile-edit-section .auth-btn');
        saveBtn.innerText = "Saving...";
        saveBtn.disabled = true;
        const formData = new FormData();
        formData.append('username', currentUser);
        formData.append('bio', bio);
        if (dpFile) formData.append('dp_image', dpFile);
        fetch('/api/profile/save', { method: 'POST', body: formData })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    alert('Profile updated successfully!');
                    if (data.dp_path) {
                        userDisplayPicture = data.dp_path;
                        localStorage.setItem('vibefy_dp', userDisplayPicture);
                        document.getElementById('profile-dp-display').src = userDisplayPicture;
                        document.getElementById('header-mini-dp').src = userDisplayPicture;
                    }
                    document.getElementById('profile-bio-display').innerText = bio;
                    window.toggleEditProfileSection(); 
                } else { alert('Error saving profile.'); }
            })
            .catch(err => { console.error('Save Profile Error:', err); alert('Error occurred.'); })
            .finally(() => { saveBtn.innerText = "Save Changes"; saveBtn.disabled = false; });
    };

    window.removeProfilePicture = () => {
        if (confirm("Remove your profile picture?")) {
            fetch('/api/profile/remove-dp', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: currentUser })
            }).then(res => res.json()).then(data => {
                if (data.success) {
                    localStorage.setItem('vibefy_dp', '');
                    alert("Picture removed! Reloading...");
                    window.location.reload(); 
                }
            });
        }
    };

    // Chat Background Upload
    const chatArea = document.getElementById('chat-window-area');
    const savedBg = localStorage.getItem('vibefy_chat_bg');
    if (savedBg) {
        chatArea.style.backgroundImage = `url(${savedBg})`;
        chatArea.classList.add('has-background'); 
    }

    document.getElementById('bg-upload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                const bgUrl = evt.target.result;
                chatArea.style.backgroundImage = `url(${bgUrl})`;
                chatArea.classList.add('has-background'); 
                localStorage.setItem('vibefy_chat_bg', bgUrl); 
                document.getElementById('settings-menu').classList.add('hidden'); 
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('settings-toggle').addEventListener('click', (e) => {
        e.stopPropagation(); 
        document.getElementById('settings-menu').classList.toggle('hidden');
    });
    
    document.addEventListener('click', (e) => { 
        if(!e.target.closest('.settings-nav')) {
            document.getElementById('settings-menu').classList.add('hidden'); 
        }
    });

    const searchInput = document.getElementById('global-search-input');
    const searchDropdown = document.getElementById('search-results-dropdown');

    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (query.length === 0) { searchDropdown.classList.add('hidden'); return; }
        if (allUsersForSearch.length === 0) {
            try {
                const res = await fetch('/api/users');
                allUsersForSearch = await res.json();
            } catch(error) { console.error("Search fetch error:", error); }
        }

        searchDropdown.innerHTML = '';
        const filteredUsers = allUsersForSearch.filter(u => 
            u.username.toLowerCase().includes(query) && u.username.toLowerCase() !== currentUser.toLowerCase()
        );
        if (filteredUsers.length > 0) {
            filteredUsers.forEach(u => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                const dp = u.dp_path || 'default-avatar.png';
                item.innerHTML = `<img src="${dp}"> <span>${u.username}</span>`;
                item.onclick = () => {
                    window.startPrivateChat(u.username);
                    searchDropdown.classList.add('hidden');
                    searchInput.value = ''; 
                };
                searchDropdown.appendChild(item);
            });
            searchDropdown.classList.remove('hidden');
        } else {
            searchDropdown.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:13px;">No friends found</div>';
            searchDropdown.classList.remove('hidden');
        }
    });

    window.toggleNewChatModal = () => {
        const modal = document.getElementById('new-chat-modal');
        const userListDiv = document.getElementById('all-users-list');
        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            fetch('/api/users').then(response => response.json()).then(usersData => {
                userListDiv.innerHTML = ""; 
                allUsersForSearch = usersData; 
                usersData.forEach(userData => {
                    if (userData.username.toLowerCase() !== currentUser.toLowerCase()) {
                        const userItem = document.createElement('div');
                        userItem.className = 'contact-item'; 
                        const dpPath = userData.dp_path ? userData.dp_path : 'default-avatar.png';
                        userItem.innerHTML = '<img src="' + dpPath + '" class="squircle" style="width:35px; height:35px; object-fit:cover; margin-right:10px;"> ' + userData.username;
                        userItem.onclick = () => {
                            window.startPrivateChat(userData.username);
                            window.toggleNewChatModal(); 
                        };
                        userListDiv.appendChild(userItem);
                    }
                });
            }).catch(err => console.error('Error fetching users:', err));
        } else {
            modal.classList.add('hidden');
        }
    };

//UI button for triggering call 
window.triggerCall = (type) => { //type= audio or video
    const recipientNameEl = document.getElementById('chat-header-name');
    if (!recipientNameEl) return;
    const recipientName = recipientNameEl.innerText.trim();
    if (recipientName === "Select a user to Chat" || recipientName === "") {
        alert("Bhai, call lagane ke liye pehle sidebar se kisi dost ki chat open karo!");
        return;
    }
    window.startCall(recipientName, type); // Call type pass kar diya
};

// MUTE / UNMUTE Button
window.isMuted = false;

window.toggleMute = () => {
    if (window.localStream) {
        const audioTrack = window.localStream.getAudioTracks()[0];
        if (audioTrack) {
            window.isMuted = !window.isMuted;
            audioTrack.enabled = !window.isMuted; // true = unmuted, false = muted
            
            // UI Button
            const muteBtn = document.getElementById('mute-audio-btn');
            const muteIcon = document.getElementById('mute-icon');
            
            if (window.isMuted) {
                // Muted ho gaya
                muteBtn.classList.add('muted');
                muteBtn.style.background = '#f97316'; 
                muteIcon.classList.remove('fa-microphone');
                muteIcon.classList.add('fa-microphone-slash');
            } else {
                // Wapas Unmute ho gaya
                muteBtn.classList.remove('muted');
                muteBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                muteIcon.classList.remove('fa-microphone-slash');
                muteIcon.classList.add('fa-microphone');
            }
        }
    }
};

// CALL HISTORY LOGIC
// Button dabane par server se history lene ke liye
window.fetchCallHistory = () => {
    document.getElementById('call-history-modal').classList.remove('hidden');
    document.getElementById('call-history-list').innerHTML = '<p style="text-align: center; color: #888;">Fetching records...</p>';
    socket.emit('get_call_history');
};

// DELETE CALL RECORD 
window.deleteCallRecord = (id) => {
    // popup ke liye
    const isConfirmed = confirm("Are you sure you want to delete this call record?");
    if (isConfirmed) {
        console.log("🚀 Sending Delete Signal to the server... ID:", id);
        document.getElementById('call-history-list').innerHTML = '<p style="text-align: center; color: #888;">Deleting record...</p>';
        socket.emit('delete_call_record', id);
    }
};

// Server jab history bheje, toh use list mein dikhane ke liye
socket.on('call_history_data', (data) => {
    const historyContainer = document.getElementById('call-history-list');
    historyContainer.innerHTML = '';
    if (data.history.length === 0) {
        historyContainer.innerHTML = '<p style="text-align: center; color: #888;">No recent calls.</p>';
        return;
    }

    data.history.forEach(call => {
        // Date aur Time format
        const dateObj = new Date(call.call_time);
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = dateObj.toLocaleDateString('en-GB');

        //check krne ke liye ki call aayi thi ya gayi thi
        const isOutgoing = call.caller === data.me;
        const otherPerson = isOutgoing ? call.receiver : call.caller;
        
        // UI Icons set karna
        const callTypeIcon = call.call_type === 'video' ? '<i class="fas fa-video"></i>' : '<i class="fas fa-phone-alt"></i>';
        const arrowIcon = isOutgoing 
            ? '<i class="fas fa-arrow-up" style="color: #4ade80;"></i>' // green- outgoing
            : '<i class="fas fa-arrow-down" style="color: #ef4444;"></i>'; // Red- incoming

        const callItem = document.createElement('div');
        callItem.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.05); margin-bottom: 8px; border-radius: 12px;";
       callItem.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px;">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: #222; display: flex; justify-content: center; align-items: center; font-size: 16px; color: #00d2ff;">
                    ${callTypeIcon}
                </div>
                <div>
                    <h4 style="margin: 0; font-size: 16px; color: white;">${otherPerson}</h4>
                    <span style="font-size: 12px; color: #aaa; display: flex; align-items: center; gap: 5px; margin-top: 4px;">
                        ${arrowIcon} ${dateStr} at ${timeStr}
                    </span>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px;">
                <button onclick="window.startCall('${otherPerson}', '${call.call_type}')" style="background: transparent; border: 1px solid rgba(255,255,255,0.2); color: white; width: 35px; height: 35px; border-radius: 50%; cursor: pointer;">
                    ${callTypeIcon}
                </button>
                <button onclick="window.deleteCallRecord('${call.id}')" style="background: transparent; border: 1px solid rgba(239,68,68,0.5); color: #ef4444; width: 35px; height: 35px; border-radius: 50%; cursor: pointer;">
                <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        historyContainer.appendChild(callItem);
    });
});
});