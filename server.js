const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

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

function getCleanStateForPlayer(roomName, socketId) {
    const room = rooms[roomName];
    if (!room) return {};

    const targetPlayer = room.players.find(p => p.id === socketId);
    return {
        gameStarted: room.gameStarted,
        deckCount: room.deck.length,
        currentTurnIndex: room.currentTurnIndex,
        isYourTurn: room.players[room.currentTurnIndex]?.id === socketId && !room.awaitingFishDraw,
        awaitingFishDraw: room.awaitingFishDraw && room.players[room.currentTurnIndex]?.id === socketId,
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
    let currentRoom = null;

    socket.on('join_game', (data) => {
        let name = "";
        let roomName = "default_arena";

        if (typeof data === 'object' && data !== null) {
            name = data.name || "Anonymous";
            roomName = data.room ? data.room.trim().toLowerCase() : "default_arena";
        } else {
            name = String(data);
        }

        if (!roomName) roomName = "default_arena";

        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: [],
                deck: [],
                currentTurnIndex: 0,
                gameStarted: false,
                log: [],
                chatHistory: [],
                awaitingFishDraw: false 
            };
        }

        const room = rooms[roomName];

        if (room.gameStarted) {
            socket.emit('error_message', "This arena match has already begun.");
            return;
        }
        if (room.players.length >= 6) {
            socket.emit('error_message', "This room is full.");
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

        socket.emit('update_chat', room.chatHistory);
        updateLobbyNames(roomName);
        broadcastRoomState(roomName);
    });

    socket.on('start_game', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

        if (room.players.length < 2) {
            socket.emit('error_message', "Need at least 2 players to start.");
            return;
        }

        room.deck = createAndShuffleDeck();
        room.gameStarted = true;
        room.currentTurnIndex = 0;
        room.awaitingFishDraw = false;
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
        if (room.awaitingFishDraw) {
            socket.emit('error_message', "You must draw your card from the deck pile first!");
            return;
        }

        const targetPlayer = room.players.find(p => p.id === data.targetId);
        if (!targetPlayer) return;

        // RULE 2: Shown openly to everyone in the live server log
        room.log.push({ 
            id: Date.now(), 
            text: `📢 ${activePlayer.name} asked ${targetPlayer.name} for a [ ${data.rank} ]` 
        });

        io.to(targetPlayer.id).emit('card_requested', {
            askerId: socket.id,
            askerName: activePlayer.name,
            rank: data.rank,
            targetId: targetPlayer.id
        });
        
        broadcastRoomState(currentRoom);
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
                room.log.push({ id: Date.now(), text: `✅ Success! ${targetPlayer.name} handed a [ ${data.rank} ] to ${askerPlayer.name}.` });
                io.to(currentRoom).emit('sound_trigger', 'success');
            }
        } else if (data.action === 'fish') {
            // RULE 1: Player says Go Fish!
            room.log.push({ id: Date.now(), text: `🌊 "Go Fish!" — ${targetPlayer.name} does not hold that rank.` });
            io.to(currentRoom).emit('sound_trigger', 'fish');
            
            // Set flag: locks asking abilities, player MUST click deck
            room.awaitingFishDraw = true;
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
            
            // RULE 1 & 3: Turn finishes instantly upon picking up the card
            if (room.awaitingFishDraw) {
                room.awaitingFishDraw = false;
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
                room.log.push({ id: Date.now(), text: `⏱️ Turn finishes. Next player's turn.` });
            }
            broadcastRoomState(currentRoom);
        } else {
            // Edge case: if deck is empty, skip turn anyway
            if (room.awaitingFishDraw) {
                room.awaitingFishDraw = false;
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
                broadcastRoomState(currentRoom);
            }
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
            room.log.push({ id: Date.now(), text: `🎁 ${player.name} folded a completed set of 4-of-a-kind!` });
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
        room.awaitingFishDraw = false;
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
                delete rooms[currentRoom];
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
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));