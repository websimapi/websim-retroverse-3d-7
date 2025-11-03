import { initializeDatabase, subscribeToGameState, updatePlayersData, updateWorldData } from './database.js';
import { getPlayer, setPlayerPosition } from './world.js';

const UPDATE_INTERVAL = 200; // 5 times per second
const POSITION_TOLERANCE = 5; // Max distance before auto-correct

export async function initHost(room, dataDisplayEl) {
    console.log("Initializing Host...");
    const gameStateRecord = await initializeDatabase(room);
    if (!gameStateRecord) {
        dataDisplayEl.textContent = "Error: Could not initialize or find game state record.";
        return;
    }

    const recordId = gameStateRecord.id;
    let playersData = gameStateRecord.slot_1 || {};
    
    // Initialize world data if it doesn't exist
    if (!gameStateRecord.slot_0 || gameStateRecord.slot_0.seed === undefined) {
        await updateWorldData(room, recordId, { seed: 0 });
    }

    const currentUser = await window.websim.getCurrentUser();
    const hostUserId = currentUser.id;

    // Load host's own position if it exists
    if (playersData[hostUserId]) {
        const savedPosition = playersData[hostUserId].position;
        if (savedPosition) {
            console.log('Host loading saved position:', savedPosition);
            setPlayerPosition(savedPosition);
        }
    }

    subscribeToGameState(room, (state) => {
        if (state) {
            dataDisplayEl.textContent = JSON.stringify(state, null, 2);
            // Ensure our in-memory state reflects the database, to prevent overwriting with stale data.
            // We merge instead of replace to handle local updates that haven't been persisted yet.
            if(state.slot_1) {
                Object.assign(playersData, state.slot_1);
            }
        } else {
            dataDisplayEl.textContent = "Waiting for game state...";
        }
    });

    // Main update loop for host
    setInterval(() => {
        // Update host's own data
        const hostPlayer = getPlayer();
        if (hostPlayer) {
            playersData[hostUserId] = {
                username: currentUser.username,
                position: {
                    x: hostPlayer.position.x,
                    y: hostPlayer.position.y,
                    z: hostPlayer.position.z,
                },
                timestamp: new Date().toISOString()
            };
        }

        // Persist the collected player data (this now includes disconnected players)
        updatePlayersData(room, recordId, playersData);

        // Broadcast the current state of CONNECTED players to all clients
        const connectedPlayers = {};
        const connectedUserIds = new Set();
        connectedUserIds.add(hostUserId);
        for(const clientId in room.peers) {
            const peer = room.peers[clientId];
            if(peer && peer.userId) {
                connectedUserIds.add(peer.userId);
            }
        }
        
        for(const userId of connectedUserIds) {
            if(playersData[userId]) {
                connectedPlayers[userId] = playersData[userId];
            }
        }

        room.send({
            type: 'players_state_update',
            players: connectedPlayers
        });

    }, UPDATE_INTERVAL);

    // Listen for player messages
    room.onmessage = (event) => {
        const { data, clientId } = event;
        const { type, position, userId } = data;

        if (clientId === room.clientId) return;

        if (type === 'player_position_update' && userId) {
            // Validate position against stored position
            const storedData = playersData[userId];
            if (storedData && storedData.position) {
                const dx = position.x - storedData.position.x;
                const dy = position.y - storedData.position.y;
                const dz = position.z - storedData.position.z;
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

                if (distance > POSITION_TOLERANCE) {
                    console.log(`Position mismatch for ${room.peers[clientId]?.username}. Distance: ${distance}. Auto-correcting...`);
                    // Send correction back to client
                    room.send({
                        type: 'position_correction',
                        position: storedData.position
                    }, clientId);
                    return; // Don't update with the incorrect position
                }
            }

            playersData[userId] = {
                username: room.peers[clientId]?.username,
                position,
                timestamp: new Date().toISOString()
            };
        }
    };
}