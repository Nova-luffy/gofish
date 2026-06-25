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
            
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
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
    if (type === 'chat') playSynthTone(587.33, 'sine', 0.08);
    else if (type === 'draw') {
        playSynthTone(293.66, 'triangle', 0.08);
        playSynthTone(392.00, 'triangle', 0.1, 50);
    } else if (type === 'success') {
        playSynthTone(523.25, 'square', 0.08);
        playSynthTone(659.25, 'square', 0.08, 60);
    } else if (type === 'fish') {
        playSynthTone(220, 'sawtooth', 0.15);
    } else if (type === 'fold') {
        playSynthTone(440, 'sine', 0.06);
        playSynthTone(880, 'sine', 0.12, 60);
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
    const totalCards = currentHand.length;

    handDiv.innerHTML = currentHand.map((c, idx) => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        const isQuad = rankCounts[c.rank] === 4;
        
        // --- CASINO CARD FAN MATHEMATICS ---
        const midIndex = (totalCards - 1) / 2;
        const cardAngle = (idx - midIndex) * 6; 
        const archTranslateY = Math.pow(Math.abs(idx - midIndex), 1.4) * 3.5; 
        const spreadTranslateX = (idx - midIndex) * -2;

        return `
            <div class="playing-card ${isRed ? 'red' : ''} ${isQuad ? 'quad-highlight' : ''}" 
                 style="animation-delay: ${idx * 0.03}s; transform: translateX(${spreadTranslateX}px) translateY(${archTranslateY}px) rotate(${cardAngle}deg);">
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
    
    if (deckCount > 0) {
        let layeredShadows = '';
        const structuralLayersCount = Math.min(Math.ceil(deckCount / 4), 8);
        for(let i = 1; i <= structuralLayersCount; i++) {
            layeredShadows += `${i}px ${i}px 0px #7f1d1d, `;
        }
        layeredShadows += `${structuralLayersCount+1}px ${structuralLayersCount+1}px 5px rgba(0,0,0,0.5)`;
        visualDeckStack.innerHTML = `<div class="deck-stack-card" style="box-shadow: ${layeredShadows}">🎴</div>`;
    } else {
        visualDeckStack.innerHTML = `<div class="deck-stack-card" style="background:#1e293b; border:2px dashed #475569; box-shadow:none; color:#475569;">EMPTY</div>`;
    }

    const oppSelect = document.getElementById('target-player-select');
    oppSelect.innerHTML = state.players
        .filter(p => p.id !== myId)
        .map(p => `<option value="${p.id}">Ask: ${p.name}</option>`).join('');

    const rankSelect = document.getElementById('target-rank-select');
    const allRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    if (rankSelect.innerHTML === '') {
        rankSelect.innerHTML = allRanks.map(r => `<option value="${r}">Rank: ${r}</option>`).join('');
    }

    // --- TURN CONTROL ENGINE ---
    document.getElementById('ask-btn').disabled = !state.isYourTurn;
    
    // Allow clicking the deck pile if it is your standard turn, OR if the server demands a fish draw
    const canClickDeck = state.isYourTurn || state.awaitingFishDraw;
    document.getElementById('deck-draw-click-trigger').style.pointerEvents = canClickDeck ? 'auto' : 'none';
    
    // Add visual glowing indicators to the deck layout when a draw is forced
    const deckWrapperElement = document.getElementById('deck-draw-click-trigger');
    if (state.awaitingFishDraw) {
        deckWrapperElement.style.outline = "3px solid #10b981";
        deckWrapperElement.style.borderRadius = "12px";
    } else {
        deckWrapperElement.style.outline = "none";
    }

    const historyBox = document.getElementById('history-log-box');
    const logsHTML = (state.log || []).map(entry => `<div class="log-line" data-id="${entry.id}">${entry.text}</div>`).join('');
    if (historyBox.innerHTML !== logsHTML) {
        historyBox.innerHTML = logsHTML;
        historyBox.scrollTop = historyBox.scrollHeight;
    }

    const oppList = document.getElementById('opponents-list');
    oppList.innerHTML = state.players
        .map(p => {
            const isMe = p.id === myId;
            const foldBadgesHTML = (p.foldedRanks || []).map(r => `<span class="fold-badge">🎖️ ${r}</span>`).join(' ');
            return `
                <div class="opponent-card ${p.isCurrentTurn ? 'active-turn' : ''}" style="${isMe ? 'border-style: dashed; background:#131e31;' : ''}">
                    <strong style="font-size:0.8rem; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name} ${isMe ? '(You)' : ''}</strong>
                    <span style="font-size:0.75rem; opacity:0.85;">Cards: ${p.cardCount}</span>
                    <div style="margin-top: 2px; min-height:14px;">${foldBadgesHTML || '<span style="font-size:0.6rem; color:#475569;">0 Folds</span>'}</div>
                </div>
            `;
        }).join('');
});

socket.on('room_update', (namesArray) => {
    const lobbyList = document.getElementById('lobby-players-list');
    lobbyList.innerHTML = namesArray.length === 0 ? `<li>Empty...</li>` : namesArray.map(name => `<li>👥 ${name}</li>`).join('');
});

socket.on('update_chat', (history) => {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = history.map(m => `<div class="chat-msg"><strong style="color:#60a5fa;">${m.name}:</strong> <span>${m.text}</span></div>`).join('');
    chatBox.scrollTop = chatBox.scrollHeight;
    playSoundEffect('chat');
});

socket.on('sound_trigger', (soundType) => { playSoundEffect(soundType); });
socket.on('global_logout_forced', () => { location.reload(); });

socket.on('card_requested', (data) => {
    if (data.targetId !== socket.id) return;
    activeRequest = data; 
    document.getElementById('request-message').innerText = `${data.askerName} is requesting ONE [ ${data.rank} ] card!`;
    const holdsCard = currentHand.some(card => card.rank === data.rank);
    document.getElementById('modal-fish-btn').disabled = holdsCard;
    document.getElementById('modal-give-btn').disabled = !holdsCard;
    document.getElementById('request-modal').style.display = 'flex';
});

socket.on('error_message', (msg) => { alert(msg); });

function joinLobby() {
    initAudio();
    const name = document.getElementById('username-input').value;
    if(name.trim()) socket.emit('join_game', name.trim());
}
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (input.value.trim()) { socket.emit('send_chat', input.value.trim()); input.value = ''; }
}
function submitAsk() {
    const targetId = document.getElementById('target-player-select').value;
    const rank = document.getElementById('target-rank-select').value;
    if(targetId && rank) socket.emit('ask_card', { targetId, rank });
}
function drawFromDeck() { socket.emit('draw_from_deck'); }
function triggerManualFold() { socket.emit('manual_fold_check'); }
function triggerExit() { socket.emit('leave_game'); }
function triggerRestart() {
    if (confirm("Are you sure you want to restart the match for everyone?")) {
        socket.emit('restart_game');
    }
}
function respondGive() { socket.emit('resolve_request', { ...activeRequest, action: 'give' }); document.getElementById('request-modal').style.display = 'none'; }
function respondFish() { socket.emit('resolve_request', { ...activeRequest, action: 'fish' }); document.getElementById('request-modal').style.display = 'none'; }