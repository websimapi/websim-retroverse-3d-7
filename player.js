import { getPlayer, setPlayerPosition, updatePeers } from './world.js';
import { getGameStateRecord } from './database.js';

const POSITION_UPDATE_INTERVAL = 100; // 10 times per second

export async function initPlayer(room, hostUsername) {
    console.log(`Initializing Player, host is ${hostUsername}...`);

    const currentUser = await window.websim.getCurrentUser();
    const userId = currentUser.id;

    // Wait for database to load and check for existing position
    const gameState = await getGameStateRecord(room);
    if (gameState && gameState.slot_1 && gameState.slot_1[userId]) {
        const savedPosition = gameState.slot_1[userId].position;
        if (savedPosition) {
            console.log('Found saved position, setting player to:', savedPosition);
            setPlayerPosition(savedPosition);
        }
    }

    // Listen for position corrections from host
    room.onmessage = (event) => {
        const { data } = event;
        if (data.type === 'position_correction') {
            console.log('Received position correction from host:', data.position);
            setPlayerPosition(data.position);
        } else if (data.type === 'players_state_update') {
            updatePeers(data.players, userId);
        }
    };

    // Send position updates periodically
    setInterval(() => {
        const player = getPlayer();
        if (player) {
            room.send({
                type: 'player_position_update',
                userId: userId,
                position: {
                    x: player.position.x,
                    y: player.position.y,
                    z: player.position.z,
                }
            });
        }
    }, POSITION_UPDATE_INTERVAL);
}