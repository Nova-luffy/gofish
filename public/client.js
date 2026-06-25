const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;

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

    // Grouping hand items into arrays mapped by their rank
    const groupedHand = {};
    currentHand.forEach(c => {
        if (!groupedHand[c.rank]) {
            groupedHand[c.rank] = [];
        }
        groupedHand[c.rank].push(c);
    });

    // Stacking cards of the same rank/number into the same visual column
    const handDiv = document.getElementById('your-hand');
    handDiv.innerHTML = Object.keys(groupedHand).map(rank => {
        const cardsHTML = groupedHand[rank].map(c => {
            const isRed = c.suit === '♥' || c.suit === '♦';
            const isQuad = rankCounts[c.rank] === 4;
            return `<div class="card ${isRed ? 'red' : ''} ${isQuad ? 'quad-highlight' : ''}">${c.rank}<br>${c.suit}</div>`;
        }).join('');
        
        return `<div class="card-column">${cardsHTML}</div>`;
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

    // Renders Chat messages seamlessly inside the chatbox element
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = (state.chat || []).map(msg => `<div class="log-line">💬 ${msg}</div>`).join('');
    chatBox.scrollTop = chatBox.scrollHeight;

    const oppList = document.getElementById('opponents-list');
    oppList.innerHTML = state.players
        .map(p => {
            const isMe = p.id === myId;
            // Mask the folded card details on opponent cards so they appear anonymous
            const foldBadgesHTML = (p.foldedRanks || []).map(r => `<span class="fold-badge">🎁 ${isMe ? r : 'Hidden'}</span>`).join(' ');

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

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit('send_chat', msg);
        chatInput.value = '';
    }
}

// Add enter key handler directly to chat box input element
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }
});