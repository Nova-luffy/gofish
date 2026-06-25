const socket = io(window.location.origin);
let myTurn = false;

function joinGame() {
    const name = document.getElementById('username').value;
    socket.emit('join_game', name);
}

function startGame() {
    socket.emit('start_game');
}

socket.on('room_update', (players) => {
    const list = document.getElementById('player-list');
    list.innerHTML = players.map(p => `<li>${p}</li>`).join('');
    if (players.length >= 4) {
        document.getElementById('start-btn').classList.remove('hidden');
    }
});

socket.on('error_message', (msg) => alert(msg));

socket.on('state_update', (data) => {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');

    myTurn = data.isYourTurn;
    document.getElementById('deck-count').innerText = data.deckCount;

    const logFeed = document.getElementById('log-feed');
    logFeed.innerHTML = data.log.map(line => `<div>${line}</div>`).join('');
    logFeed.scrollTop = logFeed.scrollHeight; 

    const oppList = document.getElementById('opponents-list');
    oppList.innerHTML = '';
    
    const selectTarget = document.getElementById('target-player-select');
    selectTarget.innerHTML = '';

    data.players.forEach(p => {
        if (p.id !== socket.id) {
            const div = document.createElement('div');
            div.className = `player-card ${p.isCurrentTurn ? 'active-turn' : ''}`;
            div.innerHTML = `<strong>${p.name}</strong><br>Cards: ${p.cardCount}<br>Folds: ${p.folds}`;
            oppList.appendChild(div);

            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = p.name;
            selectTarget.appendChild(opt);
        }
    });

    const handDiv = document.getElementById('my-hand');
    handDiv.innerHTML = data.yourHand.map(card => 
        `<div class="card" style="color: ${['♥','♦'].includes(card.suit) ? 'red' : 'black'}">
            ${card.rank}<br>${card.suit}
        </div>`
    ).join('');

const rankSelect = document.getElementById('target-rank-select');
    const allRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    
    // Only rebuild the dropdown if it's empty so it doesn't reset your selection mid-turn
    if (rankSelect.innerHTML === '') {
        rankSelect.innerHTML = allRanks.map(r => `<option value="${r}">${r}</option>`).join('');
    }

    const controls = document.getElementById('action-controls');
    controls.style.opacity = myTurn ? "1" : "0.4";
    controls.style.pointerEvents = myTurn ? "all" : "none";
});

function submitAsk() {
    if (!myTurn) return;
    const targetId = document.getElementById('target-player-select').value;
    const rank = document.getElementById('target-rank-select').value;
    
    if(!targetId || !rank) return alert("Select a player and rank!");
    
    // Fixed: Sending 'targetId' instead of 'targetPlayerId'
    socket.emit('ask_card', { targetId, rank });
}

function drawFromDeck() {
    if (!myTurn) return;
    socket.emit('draw_card');
}