const socket = io(window.location.origin);
let myId = null;
let currentHand = [];
let activeRequest = null;

socket.on('state_update', (state) => {
    myId = socket.id;
    
    document.getElementById('lobby-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'block';

    currentHand = state.yourHand || [];
    
    // Render hand cards
    const handDiv = document.getElementById('your-hand');
    handDiv.innerHTML = currentHand.map(c => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        return `<div class="card ${isRed ? 'red' : ''}">${c.rank}<br>${c.suit}</div>`;
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

    // ⏱️ UPDATED: Render the log lines and set up individual 10-second self-destruct timers
    const historyBox = document.getElementById('history-log-box');
    historyBox.innerHTML = ''; // Clear box first to handle incoming updates safely

    (state.log || []).forEach((line, index) => {
        // Create a unique container for this specific log line
        const logLineElement = document.createElement('div');
        logLineElement.className = 'log-line';
        logLineElement.innerText = line;
        historyBox.appendChild(logLineElement);

        // Start a 10-second (10000ms) countdown to fade out and delete this specific line
        setTimeout(() => {
            logLineElement.style.transition = 'opacity 0.5s ease';
            logLineElement.style.opacity = '0';
            setTimeout(() => {
                if (logLineElement.parentNode === historyBox) {
                    historyBox.removeChild(logLineElement);
                }
            }, 500); // Wait for fade-out animation to complete before removing from DOM
        }, 10000);
    });
    
    historyBox.scrollTop = historyBox.scrollHeight;

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

socket.on('room_update', (namesArray) => {
    const lobbyList = document.getElementById('lobby-players-list');
    if (namesArray.length === 0) {
        lobbyList.innerHTML = `<li>Waiting for players to connect...</li>`;
    } else {
        lobbyList.innerHTML = namesArray.map(name => `<li>🟢 ${name}</li>`).join('');
    }
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

socket.on('error_message', (msg) => {
    alert(msg);
});

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
    if(!targetId || !rank) return alert("Select a player and rank!");
    socket.emit('ask_card', { targetId, rank });
}

function drawFromDeck() {
    socket.emit('draw_from_deck');
}

function triggerManualFold() {
    socket.emit('manual_fold_check');
}

function respondGive() {
    socket.emit('resolve_request', { ...activeRequest, action: 'give' });
    document.getElementById('request-modal').style.display = 'none';
}

function respondFish() {
    socket.emit('resolve_request', { ...activeRequest, action: 'fish' });
    document.getElementById('request-modal').style.display = 'none';
}