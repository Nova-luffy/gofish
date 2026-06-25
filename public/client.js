const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;
let audioCtx = null;

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
            
            gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
            
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch(e) {}
    }, delay);
}

function playSoundEffect(type) {
    initAudio();
    if (!audioCtx) return;
    
    if (type === 'chat') {
        playSynthTone(587.33, 'sine', 0.08);
    } else if (type === 'draw') {
        playSynthTone(293.66, 'triangle', 0.08);
        playSynthTone(392.00, 'triangle', 0.1, 50);
    } else if (type === 'success') {
        playSynthTone(523.25, 'square', 0.08);
        playSynthTone(659.25, 'square', 0.08, 60);
        playSynthTone(783.99, 'square', 0.12, 120);
    } else if (type === 'fish') {
        playSynthTone(220, 'sawtooth', 0.18);
        playSynthTone(174.61, 'sawtooth', 0.22, 80);
    } else if (type === 'fold') {
        playSynthTone(440, 'sine', 0.06);
        playSynthTone(659.25, 'sine', 0.06, 40);
        playSynthTone(880, 'sine', 0.12, 80);
    }
}

socket.on('state_update', (state) => {
    myId = socket.id;
    
    if(!state.gameStarted) {
        document.getElementById('lobby-view').style.display = 'block';
        document.getElementById('game-view').style.display = 'none';
        return;
    }

    document.getElementById('lobby-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'block';

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
        return `
            <div class="playing-card ${isRed ? 'red' : ''} ${isQuad ? 'quad-highlight' : ''}" style="animation-delay: ${idx * 0.08}s">
                <div class="card-corner top-left">
                    <span class="rank">${c.rank}</span>
                    <span class="suit">${c.suit}</span>
                </div>
                <div class="card-center-suit">${c.suit}</div>
                <div class="card-corner bottom-right">
                    <span class="rank">${c.rank}</span>
                    <span class="suit">${c.suit}</span>
                </div>
            </div>
        `;
    }).join('');

    const deckCount = state.deckCount || 0;
    document.getElementById('deck-count-text').innerText = `${deckCount} Cards`;
    const visualDeckStack = document.getElementById('deck-visual-stack-target');
    visualDeckStack.innerHTML = '';
    
    if (deckCount > 0) {
        let layeredShadows = '';
        const structuralLayersCount = Math.min(Math.ceil(deckCount / 4), 10);
        for(let i = 1; i <= structuralLayersCount; i++) {
            layeredShadows += `${i}px ${i}px 0px #7f1d1d, `;
        }
        layeredShadows += `${structuralLayersCount+2}px ${structuralLayersCount+2}px 8px rgba(0,0,0,0.6)`;
        
        visualDeckStack.innerHTML = `<div class="deck-stack-card" style="box-shadow: ${layeredShadows}">🐟</div>`;
    } else {
        visualDeckStack.innerHTML = `<div class="deck-stack-card" style="background:#1e293b; border:2px dashed #475569; box-shadow:none; color:#475569;">EMPTY</div>`;
    }

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
            const foldBadgesHTML = (p.foldedRanks || []).map(r => `<span class="fold-badge">🎁 Set ${r}</span>`).join(' ');

            return `
                <div class="opponent-card ${p.isCurrentTurn ? 'active-turn' : ''}" style="${isMe ? 'border-style: dashed; background:#131e31;' : ''}">
                    <strong style="font-size:0.9rem;">${p.name} ${isMe ? '(You)' : ''}</strong><br>
                    <span style="font-size:0.8rem; opacity:0.85;">Cards: ${p.cardCount}</span><br>
                    <div style="margin-top: 4px; min-height:18px;">
                        ${foldBadgesHTML || '<span style="font-size:0.68rem; color:#475569;">No folds</span>'}
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
        `<div class="chat-msg"><strong style="color:#60a5fa;">${m.name}:</strong> <span style="color:#f8fafc;">${m.text}</span></div>`
    ).join('');
    chatBox.scrollTop = chatBox.scrollHeight;
    playSoundEffect('chat');
});

socket.on('sound_trigger', (soundType) => { playSoundEffect(soundType); });
socket.on('global_logout_forced', () => { location.reload(); });

socket.on('card_requested', (data) => {
    if (data.targetId !== socket.id) return;
    
    activeRequest = data; 
    document.getElementById('request-message').innerText = `${data.askerName} is demanding ONE of your [ ${data.rank} ] cards!`;
    
    const holdsCard = currentHand.some(card => card.rank === data.rank);
    document.getElementById('modal-fish-btn').disabled = holdsCard;
    document.getElementById('modal-give-btn').disabled = !holdsCard;
    
    document.getElementById('request-modal').style.display = 'flex';
});

socket.on('error_message', (msg) => { alert(msg); });

function joinLobby() {
    initAudio();
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
    if(!targetId || !rank) return alert("Select player node & rank!");
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