import { initHost } from './host.js';
import { initPlayer } from './player.js';
import { initWorld } from './world.js';

const statusEl = document.getElementById('status');
const roleEl = document.getElementById('role');
const hostViewEl = document.getElementById('host-view');
const playerViewEl = document.getElementById('player-view');
const dataDisplayEl = document.getElementById('data-display');
const uiContainerEl = document.getElementById('ui-container');

async function main() {
    initWorld(document.getElementById('bg'));

    try {
        const room = new WebsimSocket();
        await room.initialize();
        statusEl.textContent = 'Connected to Retroverse.';

        const [creator, currentUser] = await Promise.all([
            window.websim.getCreatedBy(),
            window.websim.getCurrentUser()
        ]);

        const isHost = creator.username === currentUser.username;

        if (isHost) {
            roleEl.textContent = `Role: HOST (${currentUser.username})`;
            uiContainerEl.style.display = 'block'; // Show for host
            hostViewEl.style.display = 'block';
            playerViewEl.style.display = 'none'; // Hide player view for host
            initHost(room, dataDisplayEl);

            window.addEventListener('keydown', (event) => {
                if (event.key === '`' || event.key === '~') {
                    if (uiContainerEl.style.display === 'block') {
                        uiContainerEl.style.display = 'none';
                    } else {
                        uiContainerEl.style.display = 'block';
                    }
                }
            });
        } else {
            roleEl.textContent = `Role: PLAYER (${currentUser.username})`;
            hostViewEl.style.display = 'none'; // Hide host view for player
            playerViewEl.style.display = 'block';
            initPlayer(room, creator.username);
        }

    } catch (error) {
        console.error("Initialization failed:", error);
        statusEl.textContent = 'Error connecting to Retroverse.';
    }
}

main();