// ===== SOCKET.IO CLIENT FÜR NICHT LACHEN CHALLENGE =====

class MultiplayerClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.currentLobby = null;
        this.isHost = false;
        this.playerName = '';
        this.connectionAttempts = 0;
        this.maxRetries = 3;
        
        this.initializeConnection();
    }
    
    // === VERBINDUNG INITIALISIEREN ===
    initializeConnection() {
        try {
            console.log('🔌 Verbinde mit Server...');
            
            this.socket = io({
                transports: ['websocket', 'polling'],
                upgrade: true,
                rememberUpgrade: true
            });
            
            this.setupEventListeners();
            
        } catch (error) {
            console.error('❌ Fehler beim Initialisieren der Verbindung:', error);
            this.showError('Verbindung zum Server fehlgeschlagen');
        }
    }
    
    // === EVENT LISTENERS EINRICHTEN ===
    setupEventListeners() {
        // === VERBINDUNGS-EVENTS ===
        this.socket.on('connect', () => {
            console.log('✅ Mit Server verbunden:', this.socket.id);
            this.isConnected = true;
            this.connectionAttempts = 0;
            this.updateConnectionStatus('Verbunden');
        });
        
        this.socket.on('disconnect', (reason) => {
            console.log('🔌 Verbindung getrennt:', reason);
            this.isConnected = false;
            this.updateConnectionStatus('Getrennt');
            
            if (reason === 'io server disconnect') {
                // Server hat Verbindung beendet
                this.socket.connect();
            }
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('❌ Verbindungsfehler:', error);
            this.connectionAttempts++;
            
            if (this.connectionAttempts >= this.maxRetries) {
                this.showError('Kann keine Verbindung zum Server herstellen. Überprüfe deine Internetverbindung.');
            } else {
                this.updateConnectionStatus(`Verbindung wird wiederhergestellt... (${this.connectionAttempts}/${this.maxRetries})`);
            }
        });
        
        // === LOBBY-EVENTS ===
        this.socket.on('lobbyCreated', (data) => {
            console.log('🏠 Lobby erstellt:', data);
            this.currentLobby = data.lobby;
            this.isHost = data.isHost;
            this.onLobbyJoined(data.lobbyCode, data.lobby, data.isHost);
        });
        
        this.socket.on('lobbyJoined', (data) => {
            console.log('👥 Lobby beigetreten:', data);
            this.currentLobby = data.lobby;
            this.isHost = data.isHost;
            this.onLobbyJoined(data.lobbyCode, data.lobby, data.isHost);
        });
        
        this.socket.on('lobbyUpdated', (lobby) => {
            console.log('🔄 Lobby aktualisiert:', lobby);
            this.currentLobby = lobby;
            this.onLobbyUpdated(lobby);
        });
        
        this.socket.on('lobbyClosed', (data) => {
            console.log('🚪 Lobby geschlossen:', data);
            this.currentLobby = null;
            this.isHost = false;
            this.onLobbyClosed(data.reason);
        });
        
        this.socket.on('lobbyLeft', () => {
            console.log('🚪 Lobby verlassen');
            this.currentLobby = null;
            this.isHost = false;
            this.onLobbyLeft();
        });
        
        this.socket.on('kicked', (data) => {
            console.log('🚫 Aus Lobby entfernt:', data);
            this.currentLobby = null;
            this.isHost = false;
            this.onKicked(data.reason);
        });
        
        // === CHAT-EVENTS ===
        this.socket.on('chatUpdated', (data) => {
            console.log('💬 Chat aktualisiert:', data);
            this.onChatUpdated(data.message, data.fullChat);
        });
        
        // === SPIEL-EVENTS ===
        this.socket.on('gameStarted', (data) => {
            console.log('🎮 Spiel gestartet:', data);
            this.onGameStarted(data);
        });
        
        // === STATISTIK-EVENTS ===
        this.socket.on('lobbyStats', (stats) => {
            this.onStatsUpdated(stats);
        });
        
        this.socket.on('lobbyList', (lobbies) => {
            this.onLobbyListReceived(lobbies);
        });
        
        // === FEHLER-EVENTS ===
        this.socket.on('error', (message) => {
            console.error('🚨 Server-Fehler:', message);
            this.showError(message);
        });
    }
    
    // === LOBBY ERSTELLEN ===
    createLobby(playerName) {
        if (!this.isConnected) {
            this.showError('Keine Verbindung zum Server');
            return false;
        }
        
        if (!playerName || playerName.trim().length === 0) {
            this.showError('Spielername ist erforderlich');
            return false;
        }
        
        this.playerName = playerName.trim();
        
        console.log('🏠 Erstelle Lobby für:', this.playerName);
        this.socket.emit('createLobby', {
            playerName: this.playerName
        });
        
        return true;
    }
    
    // === LOBBY BEITRETEN ===
    joinLobby(lobbyCode, playerName) {
        if (!this.isConnected) {
            this.showError('Keine Verbindung zum Server');
            return false;
        }
        
        if (!lobbyCode || lobbyCode.trim().length === 0) {
            this.showError('Lobby-Code ist erforderlich');
            return false;
        }
        
        if (!playerName || playerName.trim().length === 0) {
            this.showError('Spielername ist erforderlich');
            return false;
        }
        
        this.playerName = playerName.trim();
        
        console.log('👥 Trete Lobby bei:', lobbyCode, 'als', this.playerName);
        this.socket.emit('joinLobby', {
            lobbyCode: lobbyCode.toUpperCase(),
            playerName: this.playerName
        });
        
        return true;
    }
    
    // === CHAT NACHRICHT SENDEN ===
    sendChatMessage(message) {
        if (!this.isConnected || !this.currentLobby) {
            this.showError('Du bist nicht in einer Lobby');
            return false;
        }
        
        if (!message || message.trim().length === 0) {
            return false;
        }
        
        console.log('💬 Sende Chat-Nachricht:', message);
        this.socket.emit('chatMessage', {
            message: message.trim()
        });
        
        return true;
    }
    
    // === SPIEL STARTEN ===
    startGame(gameSettings = {}) {
        if (!this.isConnected || !this.currentLobby) {
            this.showError('Du bist nicht in einer Lobby');
            return false;
        }
        
        if (!this.isHost) {
            this.showError('Nur der Host kann das Spiel starten');
            return false;
        }
        
        console.log('🎮 Starte Spiel mit Einstellungen:', gameSettings);
        this.socket.emit('startGame', {
            gameSettings: gameSettings
        });
        
        return true;
    }
    
    // === SPIELER ENTFERNEN ===
    kickPlayer(playerId) {
        if (!this.isConnected || !this.currentLobby) {
            this.showError('Du bist nicht in einer Lobby');
            return false;
        }
        
        if (!this.isHost) {
            this.showError('Nur der Host kann Spieler entfernen');
            return false;
        }
        
        console.log('🚫 Entferne Spieler:', playerId);
        this.socket.emit('kickPlayer', {
            playerId: playerId
        });
        
        return true;
    }
    
    // === LOBBY VERLASSEN ===
    leaveLobby() {
        if (!this.isConnected) {
            return false;
        }
        
        console.log('🚪 Verlasse Lobby');
        this.socket.emit('leaveLobby');
        
        return true;
    }
    
    // === LOBBY-LISTE ANFORDERN ===
    requestLobbyList() {
        if (!this.isConnected) {
            this.showError('Keine Verbindung zum Server');
            return false;
        }
        
        console.log('📋 Fordere Lobby-Liste an');
        this.socket.emit('requestLobbyList');
        
        return true;
    }
    
    // === VERBINDUNGSSTATUS AKTUALISIEREN ===
    updateConnectionStatus(status) {
        const statusElement = document.querySelector('.connection-status');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = `connection-status ${this.isConnected ? 'connected' : 'disconnected'}`;
        }
        
        console.log('📡 Verbindungsstatus:', status);
    }
    
    // === FEHLER ANZEIGEN ===
    showError(message) {
        console.error('🚨 Fehler:', message);
        
        // Zeige Fehler in der UI
        const errorContainer = document.querySelector('.error-message');
        if (errorContainer) {
            errorContainer.textContent = message;
            errorContainer.style.display = 'block';
            
            // Fehler nach 5 Sekunden ausblenden
            setTimeout(() => {
                errorContainer.style.display = 'none';
            }, 5000);
        } else {
            // Fallback: Alert verwenden
            alert('🚨 Fehler: ' + message);
        }
    }
    
    // === CALLBACK-FUNKTIONEN (können überschrieben werden) ===
    onLobbyJoined(lobbyCode, lobby, isHost) {
        console.log('🎉 Lobby-Beitritt erfolgreich:', { lobbyCode, lobby, isHost });
        
        // Zeige Lobby-Interface
        if (typeof showLobbyRoom === 'function') {
            showLobbyRoom();
        }
        
        // Aktualisiere UI
        if (typeof updateMultiplayerLobbyDisplay === 'function') {
            updateMultiplayerLobbyDisplay(lobby, isHost);
        }
    }
    
    onLobbyUpdated(lobby) {
        console.log('🔄 Lobby wurde aktualisiert');
        
        // Aktualisiere UI
        if (typeof updateMultiplayerLobbyDisplay === 'function') {
            updateMultiplayerLobbyDisplay(lobby, this.isHost);
        }
    }
    
    onLobbyClosed(reason) {
        console.log('🚪 Lobby wurde geschlossen:', reason);
        
        // Zeige Nachricht
        this.showError('Lobby wurde geschlossen: ' + reason);
        
        // Zurück zum Hauptmenü
        if (typeof closeOnlineLobby === 'function') {
            closeOnlineLobby();
        }
    }
    
    onLobbyLeft() {
        console.log('🚪 Lobby erfolgreich verlassen');
        
        // Zurück zum Hauptmenü
        if (typeof closeOnlineLobby === 'function') {
            closeOnlineLobby();
        }
    }
    
    onKicked(reason) {
        console.log('🚫 Aus Lobby entfernt:', reason);
        
        // Zeige Nachricht
        this.showError('Du wurdest aus der Lobby entfernt: ' + reason);
        
        // Zurück zum Hauptmenü
        if (typeof closeOnlineLobby === 'function') {
            closeOnlineLobby();
        }
    }
    
    onChatUpdated(newMessage, fullChat) {
        console.log('💬 Chat aktualisiert:', newMessage);
        
        // Aktualisiere Chat-Display
        if (typeof updateMultiplayerChatDisplay === 'function') {
            updateMultiplayerChatDisplay(fullChat);
        }
    }
    
    onGameStarted(gameData) {
        console.log('🎮 Spiel gestartet:', gameData);
        
        // Schließe Lobby-Modal
        if (typeof closeOnlineLobby === 'function') {
            closeOnlineLobby();
        }
        
        // Starte lokales Spiel mit Multiplayer-Daten
        if (typeof startMultiplayerGame === 'function') {
            startMultiplayerGame(gameData);
        }
    }
    
    onStatsUpdated(stats) {
        console.log('📊 Statistiken aktualisiert:', stats);
        
        // Aktualisiere Statistik-Display
        if (typeof updateMultiplayerStats === 'function') {
            updateMultiplayerStats(stats);
        }
    }
    
    onLobbyListReceived(lobbies) {
        console.log('📋 Lobby-Liste erhalten:', lobbies);
        
        // Aktualisiere Lobby-Liste
        if (typeof updateLobbyList === 'function') {
            updateLobbyList(lobbies);
        }
    }
    
    // === GETTER-FUNKTIONEN ===
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            socketId: this.socket?.id,
            playerName: this.playerName,
            currentLobby: this.currentLobby,
            isHost: this.isHost
        };
    }
    
    getCurrentLobby() {
        return this.currentLobby;
    }
    
    isInLobby() {
        return this.currentLobby !== null;
    }
    
    isLobbyHost() {
        return this.isHost;
    }
}

// === GLOBALE MULTIPLAYER CLIENT INSTANZ ===
let multiplayerClient = null;

// === INITIALISIERUNG ===
function initializeMultiplayerClient() {
    if (!multiplayerClient) {
        console.log('🚀 Initialisiere Multiplayer Client...');
        multiplayerClient = new MultiplayerClient();
    }
    return multiplayerClient;
}

// === EXPORT FÜR MODULARE VERWENDUNG ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MultiplayerClient, initializeMultiplayerClient };
}
