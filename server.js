const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Statische Dateien servieren
app.use(express.static(path.join(__dirname)));

// Lobby-Management
const lobbies = new Map();
const playerLobbies = new Map(); // Mapping: socketId -> lobbyCode

// Hilfsfunktionen
function generateLobbyCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createLobbyObject(code, hostId, hostName) {
    return {
        code: code,
        host: hostName,
        hostId: hostId,
        players: [{
            id: hostId,
            name: hostName,
            isHost: true,
            joinedAt: Date.now()
        }],
        created: Date.now(),
        lastActivity: Date.now(),
        gameState: 'waiting', // waiting, playing, finished
        chat: [{
            message: `🎉 Lobby "${code}" wurde erstellt!`,
            sender: 'system',
            timestamp: Date.now()
        }],
        settings: {
            maxPlayers: 8,
            gameMode: 'standard'
        }
    };
}

function updateLobbyActivity(lobbyCode) {
    const lobby = lobbies.get(lobbyCode);
    if (lobby) {
        lobby.lastActivity = Date.now();
    }
}

function cleanupOldLobbies() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 Stunden
    
    for (const [code, lobby] of lobbies.entries()) {
        if (now - lobby.lastActivity > maxAge) {
            console.log(`🧹 Bereinige alte Lobby: ${code}`);
            lobbies.delete(code);
        }
    }
}

// Lobby-Bereinigung alle 10 Minuten
setInterval(cleanupOldLobbies, 10 * 60 * 1000);

console.log('🎭 Nicht Lachen Challenge Server gestartet!');
console.log('📊 Lobby-System bereit...');

io.on('connection', (socket) => {
    console.log(`🔌 Spieler verbunden: ${socket.id}`);
    
    // === LOBBY ERSTELLEN ===
    socket.on('createLobby', (data) => {
        try {
            const { playerName } = data;
            
            if (!playerName || playerName.trim().length === 0) {
                socket.emit('error', 'Spielername ist erforderlich');
                return;
            }
            
            // Bestehende Lobby verlassen falls vorhanden
            const existingLobby = playerLobbies.get(socket.id);
            if (existingLobby) {
                socket.emit('leaveLobby', { lobbyCode: existingLobby });
            }
            
            const lobbyCode = generateLobbyCode();
            const lobby = createLobbyObject(lobbyCode, socket.id, playerName.trim());
            
            lobbies.set(lobbyCode, lobby);
            playerLobbies.set(socket.id, lobbyCode);
            socket.join(lobbyCode);
            
            console.log(`🏠 Lobby erstellt: ${lobbyCode} von ${playerName}`);
            
            socket.emit('lobbyCreated', {
                lobbyCode: lobbyCode,
                lobby: lobby,
                isHost: true
            });
            
            // Lobby-Statistiken aktualisieren
            io.emit('lobbyStats', {
                totalLobbies: lobbies.size,
                totalPlayers: Array.from(lobbies.values()).reduce((sum, l) => sum + l.players.length, 0)
            });
            
        } catch (error) {
            console.error('❌ Fehler beim Erstellen der Lobby:', error);
            socket.emit('error', 'Fehler beim Erstellen der Lobby');
        }
    });
    
    // === LOBBY BEITRETEN ===
    socket.on('joinLobby', (data) => {
        try {
            const { lobbyCode, playerName } = data;
            
            if (!lobbyCode || !playerName) {
                socket.emit('error', 'Lobby-Code und Spielername sind erforderlich');
                return;
            }
            
            const lobby = lobbies.get(lobbyCode.toUpperCase());
            
            if (!lobby) {
                socket.emit('error', `Lobby "${lobbyCode}" nicht gefunden`);
                return;
            }
            
            // Prüfen ob Spieler bereits in der Lobby ist
            if (lobby.players.some(p => p.name === playerName.trim())) {
                socket.emit('error', `Spieler "${playerName}" ist bereits in der Lobby`);
                return;
            }
            
            // Prüfen ob Lobby voll ist
            if (lobby.players.length >= lobby.settings.maxPlayers) {
                socket.emit('error', 'Lobby ist voll');
                return;
            }
            
            // Bestehende Lobby verlassen falls vorhanden
            const existingLobby = playerLobbies.get(socket.id);
            if (existingLobby && existingLobby !== lobbyCode) {
                socket.leave(existingLobby);
            }
            
            // Spieler zur Lobby hinzufügen
            const player = {
                id: socket.id,
                name: playerName.trim(),
                isHost: false,
                joinedAt: Date.now()
            };
            
            lobby.players.push(player);
            lobby.chat.push({
                message: `🎉 ${playerName} ist der Lobby beigetreten!`,
                sender: 'system',
                timestamp: Date.now()
            });
            
            updateLobbyActivity(lobbyCode);
            playerLobbies.set(socket.id, lobbyCode);
            socket.join(lobbyCode);
            
            console.log(`👥 ${playerName} ist Lobby ${lobbyCode} beigetreten`);
            
            // Bestätigung an beitretenden Spieler
            socket.emit('lobbyJoined', {
                lobbyCode: lobbyCode,
                lobby: lobby,
                isHost: false
            });
            
            // Update an alle Lobby-Mitglieder
            io.to(lobbyCode).emit('lobbyUpdated', lobby);
            
            // Statistiken aktualisieren
            io.emit('lobbyStats', {
                totalLobbies: lobbies.size,
                totalPlayers: Array.from(lobbies.values()).reduce((sum, l) => sum + l.players.length, 0)
            });
            
        } catch (error) {
            console.error('❌ Fehler beim Beitreten der Lobby:', error);
            socket.emit('error', 'Fehler beim Beitreten der Lobby');
        }
    });
    
    // === CHAT NACHRICHT ===
    socket.on('chatMessage', (data) => {
        try {
            const { message } = data;
            const lobbyCode = playerLobbies.get(socket.id);
            
            if (!lobbyCode) {
                socket.emit('error', 'Du bist in keiner Lobby');
                return;
            }
            
            const lobby = lobbies.get(lobbyCode);
            if (!lobby) {
                socket.emit('error', 'Lobby nicht gefunden');
                return;
            }
            
            const player = lobby.players.find(p => p.id === socket.id);
            if (!player) {
                socket.emit('error', 'Du bist nicht in dieser Lobby');
                return;
            }
            
            const chatMessage = {
                message: message.trim(),
                sender: player.name,
                timestamp: Date.now()
            };
            
            lobby.chat.push(chatMessage);
            
            // Nur die letzten 50 Nachrichten behalten
            if (lobby.chat.length > 50) {
                lobby.chat = lobby.chat.slice(-50);
            }
            
            updateLobbyActivity(lobbyCode);
            
            // Chat-Update an alle Lobby-Mitglieder
            io.to(lobbyCode).emit('chatUpdated', {
                message: chatMessage,
                fullChat: lobby.chat
            });
            
        } catch (error) {
            console.error('❌ Fehler bei Chat-Nachricht:', error);
            socket.emit('error', 'Fehler beim Senden der Nachricht');
        }
    });
    
    // === SPIEL STARTEN ===
    socket.on('startGame', (data) => {
        try {
            const lobbyCode = playerLobbies.get(socket.id);
            
            if (!lobbyCode) {
                socket.emit('error', 'Du bist in keiner Lobby');
                return;
            }
            
            const lobby = lobbies.get(lobbyCode);
            if (!lobby) {
                socket.emit('error', 'Lobby nicht gefunden');
                return;
            }
            
            const player = lobby.players.find(p => p.id === socket.id);
            if (!player || !player.isHost) {
                socket.emit('error', 'Nur der Host kann das Spiel starten');
                return;
            }
            
            if (lobby.players.length < 2) {
                socket.emit('error', 'Mindestens 2 Spieler werden benötigt');
                return;
            }
            
            lobby.gameState = 'playing';
            lobby.chat.push({
                message: `🚀 Das Spiel wurde gestartet! Alle ${lobby.players.length} Spieler nehmen teil.`,
                sender: 'system',
                timestamp: Date.now()
            });
            
            updateLobbyActivity(lobbyCode);
            
            console.log(`🎮 Spiel gestartet in Lobby ${lobbyCode} mit ${lobby.players.length} Spielern`);
            
            // Spiel-Start an alle Lobby-Mitglieder
            io.to(lobbyCode).emit('gameStarted', {
                lobby: lobby,
                players: lobby.players,
                gameSettings: data.gameSettings || {}
            });
            
        } catch (error) {
            console.error('❌ Fehler beim Starten des Spiels:', error);
            socket.emit('error', 'Fehler beim Starten des Spiels');
        }
    });
    
    // === SPIELER ENTFERNEN (nur Host) ===
    socket.on('kickPlayer', (data) => {
        try {
            const { playerId } = data;
            const lobbyCode = playerLobbies.get(socket.id);
            
            if (!lobbyCode) {
                socket.emit('error', 'Du bist in keiner Lobby');
                return;
            }
            
            const lobby = lobbies.get(lobbyCode);
            if (!lobby) {
                socket.emit('error', 'Lobby nicht gefunden');
                return;
            }
            
            const hostPlayer = lobby.players.find(p => p.id === socket.id);
            if (!hostPlayer || !hostPlayer.isHost) {
                socket.emit('error', 'Nur der Host kann Spieler entfernen');
                return;
            }
            
            const targetPlayer = lobby.players.find(p => p.id === playerId);
            if (!targetPlayer) {
                socket.emit('error', 'Spieler nicht gefunden');
                return;
            }
            
            if (targetPlayer.isHost) {
                socket.emit('error', 'Der Host kann sich nicht selbst entfernen');
                return;
            }
            
            // Spieler aus Lobby entfernen
            lobby.players = lobby.players.filter(p => p.id !== playerId);
            lobby.chat.push({
                message: `🚫 ${targetPlayer.name} wurde aus der Lobby entfernt.`,
                sender: 'system',
                timestamp: Date.now()
            });
            
            updateLobbyActivity(lobbyCode);
            playerLobbies.delete(playerId);
            
            // Entfernten Spieler informieren
            io.to(playerId).emit('kicked', {
                reason: 'Du wurdest vom Host aus der Lobby entfernt.'
            });
            
            // Socket aus Lobby-Raum entfernen
            io.sockets.sockets.get(playerId)?.leave(lobbyCode);
            
            // Update an alle verbleibenden Lobby-Mitglieder
            io.to(lobbyCode).emit('lobbyUpdated', lobby);
            
            console.log(`🚫 ${targetPlayer.name} wurde aus Lobby ${lobbyCode} entfernt`);
            
        } catch (error) {
            console.error('❌ Fehler beim Entfernen des Spielers:', error);
            socket.emit('error', 'Fehler beim Entfernen des Spielers');
        }
    });
    
    // === LOBBY VERLASSEN ===
    socket.on('leaveLobby', () => {
        try {
            const lobbyCode = playerLobbies.get(socket.id);
            
            if (!lobbyCode) {
                return; // Spieler ist in keiner Lobby
            }
            
            const lobby = lobbies.get(lobbyCode);
            if (!lobby) {
                playerLobbies.delete(socket.id);
                return;
            }
            
            const player = lobby.players.find(p => p.id === socket.id);
            if (!player) {
                playerLobbies.delete(socket.id);
                return;
            }
            
            if (player.isHost) {
                // Host verlässt - Lobby schließen
                lobby.chat.push({
                    message: `🚪 Host ${player.name} hat die Lobby geschlossen.`,
                    sender: 'system',
                    timestamp: Date.now()
                });
                
                // Alle Spieler informieren
                io.to(lobbyCode).emit('lobbyClosed', {
                    reason: 'Der Host hat die Lobby verlassen.'
                });
                
                // Alle Spieler aus playerLobbies entfernen
                lobby.players.forEach(p => playerLobbies.delete(p.id));
                
                // Lobby löschen
                lobbies.delete(lobbyCode);
                
                console.log(`🏠 Lobby ${lobbyCode} wurde geschlossen (Host verlassen)`);
            } else {
                // Normaler Spieler verlässt
                lobby.players = lobby.players.filter(p => p.id !== socket.id);
                lobby.chat.push({
                    message: `🚪 ${player.name} hat die Lobby verlassen.`,
                    sender: 'system',
                    timestamp: Date.now()
                });
                
                updateLobbyActivity(lobbyCode);
                
                // Update an verbleibende Lobby-Mitglieder
                io.to(lobbyCode).emit('lobbyUpdated', lobby);
                
                console.log(`🚪 ${player.name} hat Lobby ${lobbyCode} verlassen`);
            }
            
            playerLobbies.delete(socket.id);
            socket.leave(lobbyCode);
            
            // Bestätigung an verlassenden Spieler
            socket.emit('lobbyLeft');
            
            // Statistiken aktualisieren
            io.emit('lobbyStats', {
                totalLobbies: lobbies.size,
                totalPlayers: Array.from(lobbies.values()).reduce((sum, l) => sum + l.players.length, 0)
            });
            
        } catch (error) {
            console.error('❌ Fehler beim Verlassen der Lobby:', error);
        }
    });
    
    // === LOBBY-LISTE ANFORDERN ===
    socket.on('requestLobbyList', () => {
        try {
            const publicLobbies = Array.from(lobbies.values())
                .filter(lobby => lobby.gameState === 'waiting')
                .map(lobby => ({
                    code: lobby.code,
                    host: lobby.host,
                    playerCount: lobby.players.length,
                    maxPlayers: lobby.settings.maxPlayers,
                    created: lobby.created
                }));
            
            socket.emit('lobbyList', publicLobbies);
        } catch (error) {
            console.error('❌ Fehler bei Lobby-Liste:', error);
            socket.emit('error', 'Fehler beim Laden der Lobby-Liste');
        }
    });
    
    // === VERBINDUNG GETRENNT ===
    socket.on('disconnect', () => {
        try {
            console.log(`🔌 Spieler getrennt: ${socket.id}`);
            
            const lobbyCode = playerLobbies.get(socket.id);
            if (lobbyCode) {
                // Automatisch Lobby verlassen
                socket.emit('leaveLobby');
            }
            
        } catch (error) {
            console.error('❌ Fehler bei Disconnect:', error);
        }
    });
});

// Route für die Hauptseite
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API-Endpunkt für Lobby-Statistiken
app.get('/api/stats', (req, res) => {
    res.json({
        totalLobbies: lobbies.size,
        totalPlayers: Array.from(lobbies.values()).reduce((sum, l) => sum + l.players.length, 0),
        activeLobbies: Array.from(lobbies.values()).map(lobby => ({
            code: lobby.code,
            playerCount: lobby.players.length,
            gameState: lobby.gameState,
            created: lobby.created
        }))
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
    console.log(`🎭 Nicht Lachen Challenge - Multiplayer Server bereit!`);
});
