const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;
let audioCtx = null; // Lazy instantiated browser audio architecture track runtime references

// 🎹 Arcade Video Game Synth Sound Engine Block 
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSynthTone(freq, type, duration, delay = 0) {
    if (!audioCtx) return;
    setTimeout(() => {
        try {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            
            gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
            
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch(e) { console.log("Audio node dropped play", e); }
    }, delay);
}

function playSoundEffect(type) {
    initAudio();
    if (!audioCtx) return;
    
    if (type === 'chat') {
        playSynthTone(600, 'sine', 0.08);
    } else if (type === 'draw') {
        playSynthTone(350, 'triangle', 0.1);
        playSynthTone(450, 'triangle', 0.12, 60);
    } else if (type === 'success') {
        playSynthTone(523.25, 'square', 0.1); // C5
        playSynthTone(659.25, 'square', 0.1, 80); // E5
        playSynthTone(783.99, 'square', 0.15, 160); // G5
    } else if (type === 'fish') {
        playSynthTone(220, 'sawtooth', 0.2);
        playSynthTone(180, 'sawtooth', 0.25, 100);
    } else if (type === 'fold') {
        playSynthTone(440, 'sine', 0.08);
        playSynthTone(880, 'sine', 0.08, 50);
        playSynthTone(1760, 'sine', 0.15, 100);
    }
}

// Socket Processing Interfaces
socket.on('state_update', (state) => {
    myId = socket.id;
    
    if(!state.gameStarted) {
        document.getElementById('lobby-view').style.display = 'block';
        document.getElementById('game-view').style.display = 'none';
        return;
    }

    document.getElementById('lobby-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'block';

    // Verify if player received new cards to flash a layout render pop sound
    if (state.yourHand && state.yourHand.length !== currentHand.length) {
        playSoundEffect('draw');
    }

    currentHand = state.yourHand || [];
    
    const rankCounts = {};
    currentHand.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });

    const handDiv = document.getElementById('your-hand');
    handDiv.innerHTML = currentHand.map((c, idx) => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        const isQuad = rankCounts[c.rank] === 4;
        // Injected staggered CSS delay mechanics to create systematic cascade fan animation layout effects
        return `<div class="card ${isRed ? 'red' : ''} ${isQuad ? 'quad-highlight' : ''}" style="animation-delay: ${idx * 0.05}s">${c.rank}<br>${c.suit}</div>`;
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
                <div class="opponent-card ${p.isCurrentTurn ? 'active-turn' : ''}" style="${isMe ? 'border-style: dashed; background:#1e293b;' : ''}">
                    <strong>${p.name} ${isMe ? '(You)' : ''}</strong><br>
                    <span style="font-size:0.85rem; color:#94a3b8;">Cards: ${p.cardCount}</span><br>
                    <span style="font-size:0.85rem; color:#10b981;">Sets: ${p.folds || 0}</span>
                    <div style="margin-top: 5px; min-height:20px;">
                        ${foldBadgesHTML || '<span style="font-size:0.7rem; color:#475569;">No sets folded</span>'}
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

socket.on('update_chat', (history) => {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = history.map(m => 
        `<div class="chat-msg"><strong style="color:#3b82f6;">${m.name}:</strong> <span style="color:#f1f5f9;">${m.text}</span></div>`
    ).join('');
    chatBox.scrollTop = chatBox.scrollHeight;
    playSoundEffect('chat');
});

socket.on('sound_trigger', (soundType) => {
    playSoundEffect(soundType);
});

socket.on('global_logout_forced', () => {
    alert("Match terminated. Returned to lobby state pool parameters.");
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

// Action Processing Module Functions
function joinLobby() {
    initAudio(); // Unblocks browser sound security policies safely on user interaction
    const name = document.getElementById('username-input').value;
    if(name.trim()) { socket.emit('join_game', name.trim()); } else { alert("Please enter a nickname!"); }
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (input.value.trim()) {
        socket.emit('send_chat', input.value.trim());
        input.value = '';
    }
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