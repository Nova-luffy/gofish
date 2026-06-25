const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    players: [],
    deck: [],
    currentTurnIndex: 0,
    gameStarted: false,
    log: []
};

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];

function createAndShuffleDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let rank of RANKS) {
            deck.push({ rank, suit });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function addToLog(message) {
    const logEntry = { id: Date.now() + Math.random(), text: message };
    gameState.log.push(logEntry);
    setTimeout(() => {
        gameState.log = gameState.log.filter(entry => entry.id !== logEntry.id);
        broadcastState();
    }, 10000);
}

function resetGameStructure() {
    gameState.deck = createAndShuffleDeck();
    gameState.players.forEach(p => {
        p.hand = gameState.deck.splice(0, 4); // Changed to 4 cards per player
        p.folds = 0;
        p.foldedRanks = [];
    });
    gameState.currentTurnIndex = 0;
}

function broadcastState() {
    gameState.players.forEach((p, idx) => {
        const maskedPlayers = gameState.players.map((otherPlayer, oIdx) => ({
            id: otherPlayer.id,
            name: otherPlayer.name,
            cardCount: otherPlayer.hand.length,
            folds: otherPlayer.folds,
            foldedRanks: otherPlayer.foldedRanks || [],
            isCurrentTurn: oIdx === gameState.currentTurnIndex
        }));

        io.to(p.id).emit('state_update', {
            yourHand: p.hand,
            players: maskedPlayers,
            deckCount: gameState.deck.length,
            log: gameState.log.map(entry => entry.text),
            isYourTurn: idx === gameState.currentTurnIndex,
            gameStarted: gameState.gameStarted
        });
    });
}

io.on('connection', (socket) => {
    socket.on('join_game', (name) => {
        const actualName = (typeof name === 'object' && name !== null) ? name.name : name;
        if (gameState.gameStarted || gameState.players.length >= 6) {
            socket.emit('error_message', "Game full or already started.");
            return;
        }
        gameState.players.push({ id: socket.id, name: actualName || `Player ${gameState.players.length + 1}`, hand: [], folds: 0, foldedRanks: [] });
        addToLog(`${actualName || socket.id} joined the room.`);
        io.emit('room_update', gameState.players.map(p => p.name));
    });

    socket.on('start_game', () => {
        if (gameState.players.length < 2) {
            socket.emit('error_message', "Need at least 2 players to start.");
            return;
        }
        gameState.gameStarted = true;
        resetGameStructure();
        addToLog("The game has begun!");
        broadcastState();
    });

    socket.on('restart_match', () => {
        if (!gameState.gameStarted) return;
        resetGameStructure();
        addToLog("🔄 The match was restarted!");
        broadcastState();
    });

    socket.on('leave_game', () => {
        // Reset the game for everyone and return to lobby
        gameState.players = [];
        gameState.deck = [];
        gameState.gameStarted = false;
        gameState.log = [];
        io.emit('global_logout_forced');
        io.emit('room_update', []);
    });

    socket.on('ask_card', ({ targetId, rank }) => {
        const currentPlayer = gameState.players[gameState.currentTurnIndex];
        if (!currentPlayer || socket.id !== currentPlayer.id) return;
        io.emit('card_requested', { targetId, rank, askerId: currentPlayer.id, askerName: currentPlayer.name });
    });

    socket.on('resolve_request', ({ targetId, rank, askerId, action }) => {
        const currentPlayer = gameState.players.find(p => p.id === askerId);
        const targetPlayer = gameState.players.find(p => p.id === targetId);
        if (!currentPlayer || !targetPlayer) return;

        if (action === 'give') {
            const cardIndex = targetPlayer.hand.findIndex(c => c.rank === rank);
            if (cardIndex !== -1) {
                const [transferredCard] = targetPlayer.hand.splice(cardIndex, 1);
                currentPlayer.hand.push(transferredCard);
                addToLog(`🎯 ${currentPlayer.name} took a ${rank} from ${targetPlayer.name}.`);
            }
        } else {
            addToLog(`🐟 ${currentPlayer.name} asked ${targetPlayer.name} for ${rank}s. Go Fish!`);
        }
        broadcastState();
    });

    socket.on('draw_from_deck', () => {
        const currentPlayer = gameState.players[gameState.currentTurnIndex];
        if (!currentPlayer || socket.id !== currentPlayer.id || gameState.deck.length === 0) return;
        currentPlayer.hand.push(gameState.deck.pop());
        gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
        broadcastState();
    });

    socket.on('manual_fold_check', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        const counts = {};
        player.hand.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
        for (let rank in counts) {
            if (counts[rank] === 4) {
                player.hand = player.hand.filter(c => c.rank !== rank);
                player.folds += 1;
                player.foldedRanks.push(rank);
                addToLog(`✅ ${player.name} folded a set of ${rank}s!`);
            }
        }
        broadcastState();
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        if(gameState.players.length === 0) gameState.gameStarted = false;
        io.emit('room_update', gameState.players.map(p => p.name));
        broadcastState();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));