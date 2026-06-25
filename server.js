const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware for HTTPS redirect
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    players: [],        
    deck: [],           
    currentTurnIndex: 0,
    gameStarted: false,
    log: [],
    chatHistory: []
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
    const logId = Date.now() + Math.random();
    const logEntry = { id: logId, text: message };
    gameState.log.push(logEntry);
    broadcastState();
    setTimeout(() => {
        gameState.log = gameState.log.filter(entry => entry.id !== logId);
        broadcastState();
    }, 10000);
}

function resetGameStructure() {
    gameState.deck = createAndShuffleDeck();
    gameState.players.forEach(p => {
        p.hand = gameState.deck.splice(0, 4);
        p.folds = 0;
        p.foldedRanks = [];
    });
    gameState.currentTurnIndex = 0;
    gameState.log = [];
    addToLog("The match has begun! 🃏");
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
            log: gameState.log,
            isYourTurn: idx === gameState.currentTurnIndex,
            gameStarted: gameState.gameStarted
        });
    });
}

io.on('connection', (socket) => {
    socket.on('join_game', (name) => {
        if (gameState.gameStarted || gameState.players.length >= 6) {
            socket.emit('error_message', "Game full or already in progress.");
            return;
        }
        gameState.players.push({ 
            id: socket.id, 
            name: name || `Player ${gameState.players.length + 1}`, 
            hand: [], 
            folds: 0,
            foldedRanks: [] 
        });
        addToLog(`${name || socket.id} entered the lobby.`);
        io.emit('room_update', gameState.players.map(p => p.name));
    });

    socket.on('send_chat', (msg) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            const chatItem = { name: player.name, text: msg, id: Date.now() };
            gameState.chatHistory.push(chatItem);
            if (gameState.chatHistory.length > 25) gameState.chatHistory.shift();
            io.emit('update_chat', gameState.chatHistory);
        }
    });

    socket.on('start_game', () => {
        if (gameState.players.length < 2) {
            socket.emit('error_message', "Need at least 2 players to start.");
            return;
        }
        gameState.gameStarted = true;
        resetGameStructure();
        broadcastState();
    });

    socket.on('ask_card', ({ targetId, rank }) => {
        const currentPlayer = gameState.players[gameState.currentTurnIndex];
        if (!currentPlayer || socket.id !== currentPlayer.id) return;

        const targetPlayer = gameState.players.find(p => p.id === targetId);
        if (!targetPlayer) return;

        io.emit('card_requested', {
            targetId: targetId,
            rank: rank,
            askerId: currentPlayer.id,
            askerName: currentPlayer.name
        });
    });

    socket.on('resolve_request', ({ targetId, rank, askerId, action }) => {
        const currentPlayer = gameState.players.find(p => p.id === askerId);
        const targetPlayer = gameState.players.find(p => p.id === targetId);

        if (!currentPlayer || !targetPlayer) return;

        if (action === 'give') {
            const cardIndex = targetPlayer.hand.findIndex(c => c.rank === rank);
            if (cardIndex !== -1) {
                const [movedCard] = targetPlayer.hand.splice(cardIndex, 1);
                currentPlayer.hand.push(movedCard);
                addToLog(`🎯 ${currentPlayer.name} took ONE [${rank}] from ${targetPlayer.name}!`);
                io.emit('sound_trigger', 'success');
            }
        } else if (action === 'fish') {
            addToLog(`🐟 ${targetPlayer.name} said "Go Fish!" to ${currentPlayer.name}.`);
            io.emit('sound_trigger', 'fish');
            if (gameState.deck.length > 0) {
                const drawnCard = gameState.deck.pop();
                currentPlayer.hand.push(drawnCard);
                addToLog(`🃏 ${currentPlayer.name} drew a card from the deck.`);
            }
            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
        }
        broadcastState();
    });

    socket.on('draw_from_deck', () => {
        const currentPlayer = gameState.players[gameState.currentTurnIndex];
        if (!currentPlayer || socket.id !== currentPlayer.id || gameState.deck.length === 0) return;
        const drawnCard = gameState.deck.pop();
        currentPlayer.hand.push(drawnCard);
        addToLog(`🃏 ${currentPlayer.name} drew a card from the deck.`);
        gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
        io.emit('sound_trigger', 'draw');
        broadcastState();
    });

    socket.on('manual_fold_check', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        const counts = {};
        player.hand.forEach(card => counts[card.rank] = (counts[card.rank] || 0) + 1);
        let foldedAny = false;
        for (let rank in counts) {
            if (counts[rank] === 4) {
                player.hand = player.hand.filter(card => card.rank !== rank);
                player.folds += 1;
                if (!player.foldedRanks) player.foldedRanks = [];
                player.foldedRanks.push(rank);
                foldedAny = true;
            }
        }
        if (foldedAny) {
            addToLog(`🎁 ${player.name} completed and folded a set of 4-of-a-kind!`);
            io.emit('sound_trigger', 'fold');
        } else {
            socket.emit('error_message', "No 4-of-a-kind sets found to fold.");
        }
        broadcastState();
    });

    socket.on('leave_game', () => {
        gameState.players = [];
        gameState.deck = [];
        gameState.gameStarted = false;
        gameState.chatHistory = [];
        gameState.log = [];
        io.emit('global_logout_forced');
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        if (gameState.players.length === 0) gameState.gameStarted = false;
        else gameState.currentTurnIndex = gameState.currentTurnIndex % gameState.players.length;
        io.emit('room_update', gameState.players.map(p => p.name));
        broadcastState();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));