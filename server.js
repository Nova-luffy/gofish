const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // Absolute path calculation utility module

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Fixed path flaw using absolute directory mapping variables
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
    gameState.log.push(message);
    if (gameState.log.length > 8) gameState.log.shift();
}

function broadcastState() {
    gameState.players.forEach((p, idx) => {
        const maskedPlayers = gameState.players.map((otherPlayer, oIdx) => ({
            id: otherPlayer.id,
            name: otherPlayer.name,
            cardCount: otherPlayer.hand.length,
            folds: otherPlayer.folds,
            isCurrentTurn: oIdx === gameState.currentTurnIndex
        }));

        io.to(p.id).emit('state_update', {
            yourHand: p.hand,
            players: maskedPlayers,
            deckCount: gameState.deck.length,
            log: gameState.log,
            isYourTurn: idx === gameState.currentTurnIndex
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
        gameState.players.push({ id: socket.id, name: actualName || `Player ${gameState.players.length + 1}`, hand: [], folds: 0 });
        addToLog(`${actualName || socket.id} joined the room.`);
        io.emit('room_update', gameState.players.map(p => p.name));
    });

    socket.on('start_game', () => {
        if (gameState.players.length < 2) {
            socket.emit('error_message', "Need at least 2 players to start.");
            return;
        }
        gameState.deck = createAndShuffleDeck();
        gameState.players.forEach(p => {
            p.hand = gameState.deck.splice(0, 5); 
        });
        gameState.gameStarted = true;
        gameState.currentTurnIndex = 0;
        gameState.log = ["The game has begun!"];
        broadcastState();
    });

    socket.on('ask_card', ({ targetId, rank }) => {
        const currentPlayer = gameState.players[gameState.currentTurnIndex];
        if (socket.id !== currentPlayer.id) return;

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
                const [transferredCard] = targetPlayer.hand.splice(cardIndex, 1);
                currentPlayer.hand.push(transferredCard);
                addToLog(`🎯 ${currentPlayer.name} asked ${targetPlayer.name} for a ${rank} and took ONE.`);
            }
        } else if (action === 'fish') {
            addToLog(`🐟 ${currentPlayer.name} asked ${targetPlayer.name} for ${rank}s. Go Fish!`);
        }

        broadcastState();
    });

    // Enforced Rule: Drawing a card from the deck pile ALWAYS switches the turn instantly
    socket.on('draw_from_deck', () => {
        const currentPlayer = gameState.players[gameState.currentTurnIndex];
        
        if (!currentPlayer || socket.id !== currentPlayer.id || gameState.deck.length === 0) return;

        const drawnCard = gameState.deck.pop();
        currentPlayer.hand.push(drawnCard);
        addToLog(`🃏 ${currentPlayer.name} drew a card from the deck.`);

        // Pass active turn state down immediately
        gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;

        broadcastState();
    });

    // Quiet Mode: Evaluates sets of 4 matching cards without writing log notifications
    socket.on('manual_fold_check', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;

        const counts = {};
        player.hand.forEach(card => {
            counts[card.rank] = (counts[card.rank] || 0) + 1;
        });

        let foldedAny = false;
        for (let rank in counts) {
            if (counts[rank] === 4) {
                player.hand = player.hand.filter(card => card.rank !== rank);
                player.folds += 1; 
                foldedAny = true;
            }
        }

        if (!foldedAny) {
            socket.emit('error_message', "No 4-of-a-kind sets found in your hand to fold!");
        }

        broadcastState();
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        if(gameState.players.length === 0) gameState.gameStarted = false;
        io.emit('room_update', gameState.players.map(p => p.name));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));