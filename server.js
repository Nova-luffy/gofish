const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

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

function checkForFolds(player) {
    const counts = {};
    player.hand.forEach(card => {
        counts[card.rank] = (counts[card.rank] || 0) + 1;
    });

    for (let rank in counts) {
        if (counts[rank] === 4) {
            player.hand = player.hand.filter(card => card.rank !== rank);
            player.folds += 1;
            addToLog(`${player.name} folded a set of ${rank}s!`);
        }
    }
}

function addToLog(message) {
    gameState.log.push(message);
    if (gameState.log.length > 10) gameState.log.shift();
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
        // Lowered from 4 to 2 players for easier testing!
        if (gameState.players.length < 2) {
            socket.emit('error_message', "Need at least 2 players to start.");
            return;
        }
        gameState.deck = createAndShuffleDeck();
        gameState.players.forEach(p => {
            p.hand = gameState.deck.splice(0, 4);
        });
        gameState.gameStarted = true;
        gameState.currentTurnIndex = 0;
        addToLog("The game has begun!");
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
            const cardsToMove = targetPlayer.hand.filter(c => c.rank === rank);
            targetPlayer.hand = targetPlayer.hand.filter(c => c.rank !== rank);
            currentPlayer.hand.push(...cardsToMove);

            addToLog(`${currentPlayer.name} asked ${targetPlayer.name} for ${rank}s and received ${cardsToMove.length} card(s).`);
            checkForFolds(currentPlayer);
        } else if (action === 'fish') {
            addToLog(`${currentPlayer.name} asked ${targetPlayer.name} for ${rank}s. Go Fish!`);
            if (gameState.deck.length > 0) {
                const drawnCard = gameState.deck.pop();
                currentPlayer.hand.push(drawnCard);
            }
            checkForFolds(currentPlayer);
            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
        }

        broadcastState();
    });

    socket.on('draw_card', () => {
        const currentPlayer = gameState.players[gameState.currentTurnIndex];
        if (socket.id !== currentPlayer.id) return;

        if (gameState.deck.length > 0) {
            const drawnCard = gameState.deck.pop();
            currentPlayer.hand.push(drawnCard);
            addToLog(`${currentPlayer.name} opted to draw a card from the deck.`);
        }
        checkForFolds(currentPlayer);
        gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
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