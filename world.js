import * as THREE from 'three';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

let camera, scene, renderer, composer;
let player, targetPosition, groundPlane, raycaster;
const clock = new THREE.Clock();
const mouse = new THREE.Vector2();
const peers = new Map();

const CHUNK_SIZE = 32;
const RENDER_DISTANCE = 3; // Render distance in chunks (e.g., 3 = 7x7 grid)
const loadedChunks = new Map();
let worldSeed = 0; // Hardcoded seed for now

const grassMaterial = new THREE.MeshBasicMaterial({ color: 0x006400 }); // Dark green for grass
const sandMaterial = new THREE.MeshBasicMaterial({ color: 0xc2b280 }); // Sandy color
const peerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red for peers

export function getPlayer() {
    return player;
}

export function setPlayerPosition(position) {
    if (player) {
        player.position.set(position.x, position.y, position.z);
        targetPosition.copy(player.position);
    }
}

export function updatePeers(playersData, localUserId) {
    const receivedPeerIds = new Set();

    for (const userId in playersData) {
        if (userId === localUserId) continue; // Skip self

        receivedPeerIds.add(userId);
        const playerData = playersData[userId];
        const { position } = playerData;

        if (!position) continue;

        let peerMesh = peers.get(userId);

        if (peerMesh) {
            // Update existing peer's target position for smoothing
            peerMesh.userData.targetPosition.set(position.x, position.y, position.z);
        } else {
            // Create new peer
            console.log(`Creating mesh for new peer: ${playerData.username || userId}`);
            const peerGeo = new THREE.BoxGeometry(1, 1, 1);
            peerMesh = new THREE.Mesh(peerGeo, peerMaterial);
            peerMesh.position.set(position.x, position.y, position.z);
            // Initialize userData for smoothing
            peerMesh.userData.targetPosition = new THREE.Vector3(position.x, position.y, position.z);
            scene.add(peerMesh);
            peers.set(userId, peerMesh);
        }
    }

    // Remove peers that are no longer in the data
    for (const [userId, peerMesh] of peers.entries()) {
        if (!receivedPeerIds.has(userId)) {
            console.log(`Removing disconnected peer: ${userId}`);
            scene.remove(peerMesh);
            peerMesh.geometry.dispose();
            peers.delete(userId);
        }
    }
}

const RetroShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'scanlineIntensity': { value: 0.04 },
        'vignetteFalloff': { value: 0.9 }
    },

    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,

    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float scanlineIntensity;
        uniform float vignetteFalloff;
        varying vec2 vUv;

        void main() {
            vec4 color = texture2D( tDiffuse, vUv );

            // Scanlines
            float scanline = sin( vUv.y * 800.0 ) * scanlineIntensity;
            color.rgb -= scanline;

            // Vignette
            float vignette = length(vUv - vec2(0.5));
            color.rgb *= 1.0 - pow(vignette, vignetteFalloff);

            gl_FragColor = color;
        }`
};

function generateChunk(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    if (loadedChunks.has(key)) return;

    const chunkGeometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    
    // Simple deterministic pattern for terrain type using the seed
    const isGrass = (chunkX + chunkZ + worldSeed) % 2 === 0;
    const material = isGrass ? grassMaterial : sandMaterial;

    const chunk = new THREE.Mesh(chunkGeometry, material);
    chunk.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE);
    chunk.rotation.x = -Math.PI / 2;
    chunk.name = key;

    scene.add(chunk);
    loadedChunks.set(key, chunk);
}

function updateChunks() {
    if (!player) return;

    const playerChunkX = Math.round(player.position.x / CHUNK_SIZE);
    const playerChunkZ = Math.round(player.position.z / CHUNK_SIZE);
    const chunksToKeep = new Set();

    // Load chunks in render distance
    for (let x = playerChunkX - RENDER_DISTANCE; x <= playerChunkX + RENDER_DISTANCE; x++) {
        for (let z = playerChunkZ - RENDER_DISTANCE; z <= playerChunkZ + RENDER_DISTANCE; z++) {
            generateChunk(x, z);
            chunksToKeep.add(`${x},${z}`);
        }
    }

    // Unload chunks outside render distance
    for (const [key, chunk] of loadedChunks.entries()) {
        if (!chunksToKeep.has(key)) {
            scene.remove(chunk);
            chunk.geometry.dispose();
            // material is shared, no need to dispose
            loadedChunks.delete(key);
        }
    }
}


function onDocumentMouseDown(event) {
    event.preventDefault();

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(groundPlane);

    if (intersects.length > 0) {
        targetPosition.copy(intersects[0].point);
        targetPosition.y = 0.5; // Keep target y-position same as player height
    }
}

export function initWorld(canvas) {
    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 1, 150);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 50, 0);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000);

    // Controls removed for fixed camera

    // Player Character
    const playerGeo = new THREE.BoxGeometry(1, 1, 1);
    const playerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    player = new THREE.Mesh(playerGeo, playerMat);
    player.position.y = 0.5;
    scene.add(player);
    targetPosition = player.position.clone();

    // Raycasting for movement
    raycaster = new THREE.Raycaster();
    const planeGeo = new THREE.PlaneGeometry(2000, 2000);
    planeGeo.rotateX(- Math.PI / 2);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false });
    groundPlane = new THREE.Mesh(planeGeo, planeMat);
    scene.add(groundPlane);

    renderer.domElement.addEventListener('mousemove', onDocumentMouseDown, false);


    // Post-processing
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const retroPass = new ShaderPass(RetroShader);
    composer.addPass(retroPass);

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);
    
    updateChunks(); // Initial chunk load
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    const moveSpeed = 10 * delta;

    // Move player towards target
    if (player.position.distanceTo(targetPosition) > 0.1) {
        const direction = targetPosition.clone().sub(player.position).normalize();
        player.position.add(direction.multiplyScalar(moveSpeed));
        
        // Check if chunks need updating after moving
        updateChunks();
    }
    
    // Smoothly move peers towards their target positions
    for (const peer of peers.values()) {
        if (peer.userData.targetPosition) {
            if (peer.position.distanceTo(peer.userData.targetPosition) > 0.01) {
                // Use lerp for smooth movement. The '5 * delta' factor makes it frame-rate independent.
                peer.position.lerp(peer.userData.targetPosition, 5 * delta);
            } else {
                // Snap to final position to avoid tiny movements
                peer.position.copy(peer.userData.targetPosition);
            }
        }
    }
    
    // Update camera to follow player from a fixed top-down perspective
    const cameraOffset = new THREE.Vector3(0, 30, 0.1); // Slight z-offset to ensure lookAt works correctly
    camera.position.copy(player.position).add(cameraOffset);
    camera.lookAt(player.position);

    composer.render();
}