const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;

// Voice Chat Infrastructure Variables
let localStream = null;
let peerConnections = {}; 
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19002' }] };
let voiceMode = 'mute'; // Options: 'open', 'ptt', 'mute'

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

socket.on('global_logout_forced', () => {
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

// ==========================================
// 🎙️ WebRTC Voice Modes & Control Systems
// ==========================================

async function ensureAudioStream() {
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            // Default initialization sets mic to muted state
            setLocalAudioTrackState(false);
            socket.emit('voice_ready_handshake');
        } catch (err) {
            alert("Audio Microphone permission blocked or unsupported over unsecure connections!");
            return false;
        }
    }
    return true;
}

function setLocalAudioTrackState(enabled) {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = enabled;
        });
    }
}

async function setVoiceMode(mode) {
    const streamActive = await ensureAudioStream();
    if (!streamActive) return;

    voiceMode = mode;
    updateVoiceUI();

    if (voiceMode === 'open') {
        setLocalAudioTrackState(true);
    } else {
        // Both 'ptt' and 'mute' turn the audio track off until explicitly activated
        setLocalAudioTrackState(false);
    }
}

// Push To Talk Event Triggers
async function startPTT() {
    if (voiceMode !== 'ptt') return;
    const streamActive = await ensureAudioStream();
    if (streamActive) {
        setLocalAudioTrackState(true);
        document.getElementById('voice-status-indicator').innerText = "🎙️ PTT Broad Casting... (TALKING)";
    }
}

function stopPTT() {
    if (voiceMode !== 'ptt') return;
    setLocalAudioTrackState(false);
    document.getElementById('voice-status-indicator').innerText = "🎙️ PTT Engaged (Hold Space/Button to talk)";
}

function updateVoiceUI() {
    const statusBox = document.getElementById('voice-status-indicator');
    if (!statusBox) return;

    if (voiceMode === 'open') {
        statusBox.innerText = "🔊 Open Mic: Live Speaking Room";
        statusBox.style.color = "#22c55e";
    } else if (voiceMode === 'ptt') {
        statusBox.innerText = "🎙️ PTT Engaged (Hold Space/Button to talk)";
        statusBox.style.color = "#eab308";
    } else {
        statusBox.innerText = "🔇 Voice Muted / Closed";
        statusBox.style.color = "#ef4444";
    }
}

// Global Keybind listeners for Push-To-Talk via Spacebar
window.addEventListener('keydown', (e) => {
    // Prevent activation if typing in an input field
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
    if (e.code === 'Space') {
        e.preventDefault(); 
        startPTT();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        stopPTT();
    }
});

// ==========================================
// ⚡ WebRTC Mesh Signaling Mechanics
// ==========================================

socket.on('voice_user_joined', async (userId) => {
    await ensureAudioStream();
    createPeerConnection(userId, true);
});

socket.on('voice_signal_received', async ({ senderId, signal }) => {
    await ensureAudioStream();
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

socket.on('voice_ice_candidate', async ({ senderId, candidate }) => {
    if (peerConnections[senderId] && candidate) {
        try {
            await peerConnections[senderId].addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("Error adding received ICE candidate", e);
        }
    }
});

function createPeerConnection(targetId, isOffer) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('voice_ice_candidate', { targetId, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        let audioEl = document.getElementById(`audio-${targetId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${targetId}`;
            audioEl.autoplay = true;
            const container = document.getElementById('remote-audio-streams-container');
            if (container) container.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    if (isOffer) {
        pc.onnegotiationneeded = async () => {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('voice_signal', { targetId, signal: offer });
            } catch (err) {
                console.error(err);
            }
        };
    }
}

// Socket Room Hooks
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