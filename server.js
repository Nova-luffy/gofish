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

// --- MULTI-ROOM MANAGEMENT SYSTEM ---
// Stores states for separate rooms dynamically (e.g., rooms["room1"] = { players: [], deck: [] })
let rooms = {};

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

// Generates a stripped-down version of the game state tailored specifically for an individual player
function getCleanStateForPlayer(roomName, socketId) {
    const room = rooms[roomName];
    if (!room) return {};

    const targetPlayer = room.players.find(p => p.id === socketId);
    return {
        gameStarted: room.gameStarted,
        deckCount: room.deck.length,
        currentTurnIndex: room.currentTurnIndex,
        isYourTurn: room.players[room.currentTurnIndex]?.id === socketId,
        yourHand: targetPlayer ? targetPlayer.hand : [],
        log: room.log,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.hand.length,
            foldedRanks: p.foldedRanks || [],
            isCurrentTurn: room.players[room.currentTurnIndex]?.id === p.id
        }))
    };
}

function broadcastRoomState(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    room.players.forEach(p => {
        io.to(p.id).emit('state_update', getCleanStateForPlayer(roomName, p.id));
    });
}

function updateLobbyNames(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    const names = room.players.map(p => p.name);
    io.to(roomName).emit('room_update', names);
}

io.on('connection', (socket) => {
    // Keep track of which room this specific connection belongs to
    let currentRoom = null;

    socket.on('join_game', (data) => {
        // Support either a string (just name) or an object containing room information
        let name = "";
        let roomName = "Default_Arena"; // Backwards compatible fallback

        if (typeof data === 'object' && data !== null) {
            name = data.name || "Anonymous";
            roomName = data.room ? data.room.trim().toLowerCase() : "default_arena";
        } else {
            name = String(data);
        }

        // Clean up empty strings
        if (!roomName) roomName = "default_arena";

        // Initialize the room entry if it doesn't exist yet
        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: [],
                deck: [],
                currentTurnIndex: 0,
                gameStarted: false,
                log: [],
                chatHistory: []
            };
        }

        const room = rooms[roomName];

        if (room.gameStarted) {
            socket.emit('error_message', "This arena match has already begun.");
            return;
        }
        if (room.players.length >= 6) {
            socket.emit('error_message', "This room is full (Max 6 players). Try another room name!");
            return;
        }

        currentRoom = roomName;
        socket.join(roomName);

        room.players.push({
            id: socket.id,
            name: name,
            hand: [],
            folds: 0,
            foldedRanks: []
        });

        // Sync fresh user with existing chat history of that specific room
        socket.emit('update_chat', room.chatHistory);
        
        updateLobbyNames(roomName);
        broadcastRoomState(roomName);
    });

    socket.on('start_game', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        if (room.players.length < 2) {
            socket.emit('error_message', "Need at least 2 players in this room to start.");
            return;
        }

        room.deck = createAndShuffleDeck();
        room.gameStarted = true;
        room.currentTurnIndex = 0;
        room.log = [];

        for (let player of room.players) {
            player.hand = [];
            player.folds = 0;
            player.foldedRanks = [];
            for (let i = 0; i < 5; i++) {
                if (room.deck.length > 0) player.hand.push(room.deck.pop());
            }
        }

        room.log.push({ id: Date.now(), text: "⚔️ Arena match has begun! Good luck." });
        broadcastRoomState(currentRoom);
    });

    socket.on('ask_card', (data) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        const activePlayer = room.players[room.currentTurnIndex];
        if (!activePlayer || activePlayer.id !== socket.id) return;

        const targetPlayer = room.players.find(p => p.id === data.targetId);
        if (!targetPlayer) return;

        io.to(targetPlayer.id).emit('card_requested', {
            askerId: socket.id,
            askerName: activePlayer.name,
            rank: data.rank,
            targetId: targetPlayer.id
        });
    });

    socket.on('resolve_request', (data) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        const targetPlayer = room.players.find(p => p.id === data.targetId);
        const askerPlayer = room.players.find(p => p.id === data.askerId);
        if (!targetPlayer || !askerPlayer) return;

        if (data.action === 'give') {
            const cardIndex = targetPlayer.hand.findIndex(c => c.rank === data.rank);
            if (cardIndex !== -1) {
                const card = targetPlayer.hand.splice(cardIndex, 1)[0];
                askerPlayer.hand.push(card);
                room.log.push({ id: Date.now(), text: ` card given! ${targetPlayer.name} handed a [ ${data.rank} ] to ${askerPlayer.name}.` });
                io.to(currentRoom).emit('sound_trigger', 'success');
            }
        } else if (data.action === 'fish') {
            room.log.push({ id: Date.now(), text: ` Go Fish! ${targetPlayer.name} told ${askerPlayer.name} to go fish.` });
            io.to(currentRoom).emit('sound_trigger', 'fish');
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        }

        broadcastRoomState(currentRoom);
    });

    socket.on('draw_from_deck', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        const activePlayer = room.players[room.currentTurnIndex];
        if (!activePlayer || activePlayer.id !== socket.id) return;

        if (room.deck.length > 0) {
            const card = room.deck.pop();
            activePlayer.hand.push(card);
            room.log.push({ id: Date.now(), text: `🎴 ${activePlayer.name} drew a card from the deck pile.` });
            broadcastRoomState(currentRoom);
        }
    });

    socket.on('manual_fold_check', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        const player = room.players.find(p => p.id === socket.id);
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
            room.log.push({ id: Date.now(), text: `🎁 ${player.name} completed and folded a set of 4-of-a-kind!` });
            io.to(currentRoom).emit('sound_trigger', 'fold');
        } else {
            socket.emit('error_message', "No 4-of-a-kind sets found to fold.");
        }
        broadcastRoomState(currentRoom);
    });

    socket.on('restart_game', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        room.deck = [];
        room.gameStarted = false;
        room.log = [];
        broadcastRoomState(currentRoom);
    });

    socket.on('send_chat', (msg) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const player = room.players.find(p => p.id === socket.id);
        const name = player ? player.name : "System";

        const chatObj = { name, text: msg };
        room.chatHistory.push(chatObj);
        if (room.chatHistory.length > 30) room.chatHistory.shift();

        io.to(currentRoom).emit('update_chat', room.chatHistory);
    });

    socket.on('leave_game', () => {
        if (currentRoom && rooms[currentRoom]) {
            socket.leave(currentRoom);
            rooms[currentRoom].players = rooms[currentRoom].players.filter(p => p.id !== socket.id);
            
            if (rooms[currentRoom].players.length === 0) {
                delete rooms[currentRoom]; // Wipe memory if room is empty
            } else {
                rooms[currentRoom].currentTurnIndex = rooms[currentRoom].currentTurnIndex % rooms[currentRoom].players.length;
                updateLobbyNames(currentRoom);
                broadcastRoomState(currentRoom);
            }
        }
        socket.emit('global_logout_forced');
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].players = rooms[currentRoom].players.filter(p => p.id !== socket.id);
            if (rooms[currentRoom].players.length === 0) {
                delete rooms[currentRoom];
            } else {
                rooms[currentRoom].currentTurnIndex = rooms[currentRoom].currentTurnIndex % rooms[currentRoom].players.length;
                updateLobbyNames(currentRoom);
                broadcastRoomState(currentRoom);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Rooms Arena server running on port ${PORT}`));