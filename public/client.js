const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;

// Voice Chat Infrastructure Variables
let localStream = null;
let peerConnections = {}; 
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19002' }] };

socket.on('state_update', (state) => {
    myId = socket.id;
    
    if(!state.gameStarted) {
        document.getElementById('lobby-view').style.display = 'block';
        document.getElementById('game-view').style.display = 'none';
        return;
    }

    document.getElementById('lobby-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'block';

    currentHand = state.yourHand || [];
    
    const rankCounts = {};
    currentHand.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });

    const handDiv = document.getElementById('your-hand');
    handDiv.innerHTML = currentHand.map(c => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        const isQuad = rankCounts[c.rank] === 4;
        return `<div class="card ${isRed ? 'red' : ''} ${isQuad ? 'quad-highlight' : ''}">${c.rank}<br>${c.suit}</div>`;
    }).join('');

    const oppSelect = document.getElementById('target-player-select');
    oppSelect.innerHTML = state.players
        .filter(p => p.id !== myId)
        .map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    const rankSelect = document.getElementById('target-rank-select');
    const allRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    if (rankSelect.innerHTML === '') {
        rankSelect.innerHTML = allRanks.map(r => `<option value="${r}">${r}</option>`).join('');
    }

    document.getElementById('ask-btn').disabled = !state.isYourTurn;

    const historyBox = document.getElementById('history-log-box');
    historyBox.innerHTML = (state.log || []).map(line => `<div class="log-line">${line}</div>`).join('');
    historyBox.scrollTop = historyBox.scrollHeight;

    const oppList = document.getElementById('opponents-list');
    oppList.innerHTML = state.players
        .map(p => {
            const isMe = p.id === myId;
            const foldBadgesHTML = (p.foldedRanks || []).map(r => `<span class="fold-badge">🎁 ${r}</span>`).join(' ');

            return `
                <div class="opponent-card ${p.isCurrentTurn ? 'active-turn' : ''}" style="${isMe ? 'border-style: dashed; background:#334155;' : ''}">
                    <strong>${p.name} ${isMe ? '(You)' : ''}</strong><br>
                    Cards: ${p.cardCount}<br>
                    Folds Count: ${p.folds || 0}
                    <div style="margin-top: 5px; min-height:20px;">
                        ${foldBadgesHTML || '<span style="font-size:0.75rem; color:#94a3b8;">No folds yet</span>'}
                    </div>
                </div>
            `;
        }).join('');
});

socket.on('room_update', (namesArray) => {
    const lobbyList = document.getElementById('lobby-players-list');
    if (namesArray.length === 0) {
        lobbyList.innerHTML = `<li>Waiting for players to connect...</li>`;
    } else {
        lobbyList.innerHTML = namesArray.map(name => `<li>🟢 ${name}</li>`).join('');
    }
});

// 🚪 GLOBAL LOGOUT BROADCAST ROUTING HANDLE
socket.on('global_logout_forced', () => {
    // Shutdown local audio hardware tracks safely
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    alert("An active member hit Exit! The session has been wiped and returned to Lobby.");
    location.reload(); 
});

socket.on('card_requested', (data) => {
    if (data.targetId !== socket.id) return;
    
    activeRequest = data; 
    document.getElementById('request-message').innerText = `${data.askerName} is asking you for: ${data.rank}'s`;
    
    const holdsCard = currentHand.some(card => card.rank === data.rank);
    document.getElementById('modal-fish-btn').disabled = holdsCard;
    document.getElementById('modal-give-btn').disabled = !holdsCard;
    
    document.getElementById('request-modal').style.display = 'flex';
});

socket.on('error_message', (msg) => { alert(msg); });

// 🎙️ WebRTC Voice Processing Infrastructure Mechanics Engine Handles
async function initiateVoiceChat() {
    if (localStream) return; // Prevent double connection instances

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const btn = document.getElementById('voice-toggle-btn');
        btn.innerText = "🎙️ Voice Chat Connected Live";
        btn.classList.add('connected');

        // Request signaling handshakes with all connected session nodes
        socket.emit('voice_ready_handshake');
    } catch (err) {
        alert("Audio Mic permission initialization blocked or unsupported over non-HTTPS!");
    }
}

socket.on('voice_user_joined', async (userId) => {
    if (!localStream) return;
    createPeerConnection(userId, true);
});

socket.on('voice_signal_received', async ({ senderId, signal }) => {
    if (!localStream) return;
    if (!peerConnections[senderId]) {
        createPeerConnection(senderId, false);
    }
    await peerConnections[senderId].setRemoteDescription(new RTCSessionDescription(signal));
    if (signal.type === 'offer') {
        const answer = await peerConnections[senderId].createAnswer();
        await peerConnections[senderId].setLocalDescription(answer);
        socket.emit('voice_signal', { targetId: senderId, signal: answer });
    }
});

function createPeerConnection(targetId, isOffer) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            // Wait for gathering to stabilize or transfer via offer parameters natively
        }
    };

    pc.ontrack = (event) => {
        let audioEl = document.getElementById(`audio-${targetId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${targetId}`;
            audioEl.autoplay = true;
            document.getElementById('remote-audio-streams-container').appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    if (isOffer) {
        pc.onnegotiationneeded = async () => {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('voice_signal', { targetId, signal: offer });
        };
    }
}

function joinLobby() {
    const name = document.getElementById('username-input').value;
    if(name) { socket.emit('join_game', name); } else { alert("Please enter a nickname!"); }
}

function submitAsk() {
    const targetId = document.getElementById('target-player-select').value;
    const rank = document.getElementById('target-rank-select').value;
    if(!targetId || !rank) return alert("Select a player and rank!");
    socket.emit('ask_card', { targetId, rank });
}

function drawFromDeck() { socket.emit('draw_from_deck'); }
function triggerManualFold() { socket.emit('manual_fold_check'); }
function triggerRestart() { socket.emit('restart_match'); }
function triggerExit() { socket.emit('leave_game'); }

function respondGive() {
    socket.emit('resolve_request', { ...activeRequest, action: 'give' });
    document.getElementById('request-modal').style.display = 'none';
}

function respondFish() {
    socket.emit('resolve_request', { ...activeRequest, action: 'fish' });
    document.getElementById('request-modal').style.display = 'none';
}