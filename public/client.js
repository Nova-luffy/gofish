const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;

// Handle layout visibility based on game state updates from server
socket.on('game_state', (state) => {
    myId = socket.id;
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    document.getElementById('lobby-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'block';

    currentHand = me.hand || [];
    
    // Render hand cards beautifully
    const handDiv = document.getElementById('your-hand');
    handDiv.innerHTML = currentHand.map(c => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        return `<div class="card ${isRed ? 'red' : ''}">${c.rank}<br>${c.suit}</div>`;
    }).join('');

    // Rebuild the target selection drop-down menus
    const oppSelect = document.getElementById('target-player-select');
    oppSelect.innerHTML = state.players
        .filter(p => p.id !== myId)
        .map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    const rankSelect = document.getElementById('target-rank-select');
    const allRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    if (rankSelect.innerHTML === '') {
        rankSelect.innerHTML = allRanks.map(r => `<option value="${r}">${r}</option>`).join('');
    }

    // Lock/Unlock the asking interface depending on turn control
    const isMyTurn = state.turnTracker === myId;
    document.getElementById('ask-btn').disabled = !isMyTurn;

    // Render Opponents Section
    const oppList = document.getElementById('opponents-list');
    oppList.innerHTML = state.players
        .filter(p => p.id !== myId)
        .map(p => `
            <div class="opponent-card ${state.turnTracker === p.id ? 'active-turn' : ''}">
                <strong>${p.name}</strong><br>
                Cards: ${p.hand.length}<br>
                Folds: ${p.folds || 0}
            </div>
        `).join('');
});

// Incoming card request listener (Triggers Pop-up)
socket.on('card_requested', (data) => {
    if (data.targetId !== socket.id) return;
    
    activeRequest = data; // Cache the incoming payload globally
    document.getElementById('request-message').innerText = `${data.askerName} is asking you for: ${data.rank}'s`;
    
    // Safety Validation Check: Does the player have this rank?
    const holdsCard = currentHand.some(card => card.rank === data.rank);
    
    // Strict Guard: Disable "Go Fish" if they hold the target card rank
    document.getElementById('modal-fish-btn').disabled = holdsCard;
    document.getElementById('modal-give-btn').disabled = !holdsCard;
    
    document.getElementById('request-modal').style.display = 'flex';
});

function joinLobby() {
    const name = document.getElementById('username-input').value;
    if(name) socket.emit('join_game', { name });
}

function submitAsk() {
    const targetId = document.getElementById('target-player-select').value;
    const rank = document.getElementById('target-rank-select').value;
    if(!targetId || !rank) return;
    socket.emit('ask_card', { targetId, rank });
}

function respondGive() {
    socket.emit('resolve_request', { ...activeRequest, action: 'give' });
    document.getElementById('request-modal').style.display = 'none';
}

function respondFish() {
    socket.emit('resolve_request', { ...activeRequest, action: 'fish' });
    document.getElementById('request-modal').style.display = 'none';
}