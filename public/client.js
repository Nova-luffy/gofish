const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;

// Synchronized with your exact backend 'state_update' event trigger
socket.on('state_update', (state) => {
    myId = socket.id;
    
    // Switch the interface screens instantly
    document.getElementById('lobby-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'block';

    currentHand = state.yourHand || [];
    
    // Render hand cards beautifully
    const handDiv = document.getElementById('your-hand');
    handDiv.innerHTML = currentHand.map(c => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        return `<div class="card ${isRed ? 'red' : ''}">${c.rank}<br>${c.suit}</div>`;
    }).join('');

    // Rebuild the target player selection menus
    const oppSelect = document.getElementById('target-player-select');
    oppSelect.innerHTML = state.players
        .filter(p => p.id !== myId)
        .map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    // Rebuild the full 13-rank menu list
    const rankSelect = document.getElementById('target-rank-select');
    const allRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    if (rankSelect.innerHTML === '') {
        rankSelect.innerHTML = allRanks.map(r => `<option value="${r}">${r}</option>`).join('');
    }

    // Toggle turn controls dynamically
    document.getElementById('ask-btn').disabled = !state.isYourTurn;

    // Render Opponents Section correctly mapped to your structure variables
    const oppList = document.getElementById('opponents-list');
    oppList.innerHTML = state.players
        .filter(p => p.id !== myId)
        .map(p => `
            <div class="opponent-card ${p.isCurrentTurn ? 'active-turn' : ''}">
                <strong>${p.name}</strong><br>
                Cards: ${p.cardCount}<br>
                Folds: ${p.folds || 0}
            </div>
        `).join('');
});

// Listener for temporary lobby room updates before match launch
socket.on('room_update', (namesArray) => {
    console.log("Current lobby squad waiting:", namesArray);
});

// Incoming card request listener (Triggers Pop-up Modal)
socket.on('card_requested', (data) => {
    if (data.targetId !== socket.id) return;
    
    activeRequest = data; 
    document.getElementById('request-message').innerText = `${data.askerName} is asking you for: ${data.rank}'s`;
    
    // Safety Validation Check: Does the player actually hold this rank?
    const holdsCard = currentHand.some(card => card.rank === data.rank);
    
    // Strict Guard: Disable "Go Fish" button if they are lying and hold the card rank
    document.getElementById('modal-fish-btn').disabled = holdsCard;
    document.getElementById('modal-give-btn').disabled = !holdsCard;
    
    document.getElementById('request-modal').style.display = 'flex';
});

// Input lobby processing functions
function joinLobby() {
    const name = document.getElementById('username-input').value;
    if(name) {
        socket.emit('join_game', name);
    } else {
        alert("Please enter a nickname!");
    }
}

function submitAsk() {
    const targetId = document.getElementById('target-player-select').value;
    const rank = document.getElementById('target-rank-select').value;
    if(!targetId || !rank) return alert("Select a valid player and rank!");
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