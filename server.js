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

// Global Game State
let gameState = {
    players: [],        
    deck: [],           
    currentTurnIndex: 0,
    gameStarted: false,
    log: [],
    chatHistory: [],
    awaitingFishDraw: false // Tracks if active player must draw to end their turn
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

function addToLog(text) {
    gameState.log.push({ id: Date.now(), text });
    if (gameState.log.length > 45) gameState.log.shift();
}

function broadcastState() {
    gameState.players.forEach((player) => {
        io.to(player.id).emit('state_update', {
            gameStarted: gameState.gameStarted,
            deckCount: gameState.deck.length,
            currentTurnIndex: gameState.currentTurnIndex,
            // Disable normal actions if player needs to execute a fish draw sequence
            isYourTurn: gameState.players[gameState.currentTurnIndex]?.id === player.id && !gameState.awaitingFishDraw,
            // Alerts frontend that player is locked into drawing a card
            awaitingFishDraw: gameState.awaitingFishDraw && gameState.players[gameState.currentTurnIndex]?.id === player.id,
            yourHand: player.hand,
            log: gameState.log,
            players: gameState.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand.length,
                foldedRanks: p.foldedRanks || [],
                isCurrentTurn: gameState.players[gameState.currentTurnIndex]?.id === p.id
            }))
        });
    });
}

io.on('connection', (socket) => {

    socket.on('join_game', (name) => {
        if (gameState.gameStarted) {
            socket.emit('error_message', "The game has already started!");
            return;
        }
        if (gameState.players.length >= 6) {
            socket.emit('error_message', "Game lobby is full! (Max 6 players)");
            return;
        }

        gameState.players.push({
            id: socket.id,
            name: name,
            hand: [],
            folds: 0,
            foldedRanks: []
        });

        socket.emit('update_chat', gameState.chatHistory);
        
        // Update lobby view user strings
        const names = gameState.players.map(p => p.name);
        io.emit('room_update', names);
        broadcastState();
    });

    socket.on('start_game', () => {
        if (gameState.players.length < 2) {
            socket.emit('error_message', "Need at least 2 players to start.");
            return;
        }

        gameState.deck = createAndShuffleDeck();
        gameState.gameStarted = true;
        gameState.currentTurnIndex = 0;
        gameState.awaitingFishDraw = false;
        gameState.log = [];

        for (let player of gameState.players) {
            player.hand = [];
            player.folds = 0;
            player.foldedRanks = [];
            for (let i = 0; i < 5; i++) {
                if (gameState.deck.length > 0) player.hand.push(gameState.deck.pop());
            }
        }

        addToLog("⚔️ Arena match has begun! Good luck.");
        broadcastState();
    });

    socket.on('ask_card', (data) => {
        const activePlayer = gameState.players[gameState.currentTurnIndex];
        if (!activePlayer || activePlayer.id !== socket.id) return;
        if (gameState.awaitingFishDraw) {
            socket.emit('error_message', "You must draw from the deck first!");
            return;
        }

        const targetPlayer = gameState.players.find(p => p.id === data.targetId);
        if (!targetPlayer) return;

        // --- RULE 2: Show every card request openly to everyone in the live game log ---
        addToLog(`📢 ${activePlayer.name} asked ${targetPlayer.name} for a [ ${data.rank} ]`);

        io.to(targetPlayer.id).emit('card_requested', {
            askerId: socket.id,
            askerName: activePlayer.name,
            rank: data.rank,
            targetId: targetPlayer.id
        });
        broadcastState();
    });

    socket.on('resolve_request', (data) => {
        const targetPlayer = gameState.players.find(p => p.id === data.targetId);
        const askerPlayer = gameState.players.find(p => p.id === data.askerId);
        if (!targetPlayer || !askerPlayer) return;

        if (data.action === 'give') {
            const cardIndex = targetPlayer.hand.findIndex(c => c.rank === data.rank);
            if (cardIndex !== -1) {
                const card = targetPlayer.hand.splice(cardIndex, 1)[0];
                askerPlayer.hand.push(card);
                addToLog(`✅ Success! ${targetPlayer.name} handed a [ ${data.rank} ] to ${askerPlayer.name}.`);
                io.emit('sound_trigger', 'success');
            }
        } else if (data.action === 'fish') {
            // --- RULE 1: Player2 doesn't have it and says "Go Fish" ---
            addToLog(`🌊 "Go Fish!" — ${targetPlayer.name} does not have a [ ${data.rank} ].`);
            io.emit('sound_trigger', 'fish');
            
            // Set safety lock flag: active player is forced to click and draw from the deck next
            gameState.awaitingFishDraw = true;
        }
        broadcastState();
    });

    socket.on('draw_from_deck', () => {
        const activePlayer = gameState.players[gameState.currentTurnIndex];
        if (!activePlayer || activePlayer.id !== socket.id) return;

        if (gameState.deck.length > 0) {
            const card = gameState.deck.pop();
            activePlayer.hand.push(card);
            addToLog(`🎴 ${activePlayer.name} drew a card from the deck pile.`);
            
            // --- RULE 1 & 3: Turn finishes instantly upon picking up the card ---
            if (gameState.awaitingFishDraw) {
                gameState.awaitingFishDraw = false;
                gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
                addToLog(`⏱️ Turn finished. Next player's turn.`);
            }
            broadcastState();
        } else {
            // Safe fallback if deck runs dry mid-turn execution
            if (gameState.awaitingFishDraw) {
                gameState.awaitingFishDraw = false;
                gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
                broadcastState();
            }
        }
    });

    socket.on('manual_fold_check', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;

        const counts = {};
        player.hand.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
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

    socket.on('restart_game', () => {
        gameState.deck = [];
        gameState.gameStarted = false;
        gameState.awaitingFishDraw = false;
        gameState.log = [];
        broadcastState();
    });

    socket.on('send_chat', (msg) => {
        const player = gameState.players.find(p => p.id === socket.id);
        const name = player ? player.name : "System";
        const chatObj = { name, text: msg };
        gameState.chatHistory.push(chatObj);
        if (gameState.chatHistory.length > 30) gameState.chatHistory.shift();
        io.emit('update_chat', gameState.chatHistory);
    });

    socket.on('leave_game', () => {
        gameState.players = [];
        gameState.deck = [];
        gameState.gameStarted = false;
        gameState.awaitingFishDraw = false;
        gameState.chatHistory = [];
        gameState.log = [];
        io.emit('global_logout_forced');
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        if (gameState.players.length === 0) {
            gameState.gameStarted = false;
            gameState.awaitingFishDraw = false;
        } else {
            gameState.currentTurnIndex = gameState.currentTurnIndex % gameState.players.length;
        }
        io.emit('global_logout_forced');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Core Engine server running on port ${PORT}`));