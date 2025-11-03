import { PLAYER_DATA_SLOT, WORLD_DATA_SLOT } from './shared.js';
const COLLECTION_NAME = 'retroverse_state_v1';

export async function getGameStateRecord(room) {
    return new Promise(resolve => {
        let resolved = false;
        
        const unsubscribe = room.collection(COLLECTION_NAME).subscribe((records) => {
            if (resolved) return;
            
            if (records && records.length > 0) {
                resolved = true;
                unsubscribe();
                const recordToUse = records.slice().reverse()[0];
                resolve(recordToUse);
            }
        });

        // Timeout fallback
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                unsubscribe();
                const records = room.collection(COLLECTION_NAME).getList().slice().reverse();
                resolve(records.length > 0 ? records[0] : null);
            }
        }, 3000);
    });
}

export function initializeDatabase(room) {
    return new Promise(async (resolve) => {
        console.log("Host is initializing database with enhanced safety checks...");

        // FAILSAFE 1: Immediate check
        let records = room.collection(COLLECTION_NAME).getList();
        if (records.length > 0) {
            const oldestRecord = records.slice().reverse()[0];
            console.log("Game state found immediately. Using existing record:", oldestRecord.id);
            resolve(oldestRecord);
            return;
        }

        // FAILSAFE 2: Subscribe and wait for network-propagated records
        const record = await new Promise(resolveCheck => {
            let resolved = false;
            const timeout = 3000; // 3 seconds
            
            const unsubscribe = room.collection(COLLECTION_NAME).subscribe((recs) => {
                if (resolved || !recs || recs.length === 0) return;
                
                resolved = true;
                unsubscribe();
                const oldestRecord = recs.slice().reverse()[0];
                console.log("Game state found via subscription. Using existing record:", oldestRecord.id);
                resolveCheck(oldestRecord);
            });

            setTimeout(() => {
                if (resolved) return;
                
                unsubscribe();
                const finalCheckRecords = room.collection(COLLECTION_NAME).getList();
                if (finalCheckRecords.length > 0) {
                    const oldestRecord = finalCheckRecords.slice().reverse()[0];
                    console.log("Game state found on final check. Using existing record:", oldestRecord.id);
                    resolveCheck(oldestRecord);
                } else {
                    resolveCheck(null);
                }
            }, timeout);
        });

        if (record) {
            resolve(record);
            return;
        }

        // --- Creation Phase ---
        console.log("No game state found. Attempting to create the single master record.");
        const initialState = {};
        for (let i = 0; i < 10; i++) {
            initialState[`slot_${i}`] = {};
        }

        let newRecord;
        try {
            newRecord = await room.collection(COLLECTION_NAME).create(initialState);
            console.log("Record created successfully:", newRecord.id);
        } catch (e) {
            console.error("Failed to create game state, likely because another host just did. Re-fetching.", e);
            const finalRecord = await getGameStateRecord(room);
            resolve(finalRecord);
            return;
        }

        // --- FAILSAFE 3: Post-Creation Verification ---
        console.log("Verifying record to prevent duplicates...");
        await new Promise(r => setTimeout(r, 500)); // Allow time for DB to become consistent

        const allRecords = room.collection(COLLECTION_NAME).getList();

        if (allRecords.length === 1) {
            console.log("Verification successful. Single record confirmed.");
            resolve(newRecord);
            return;
        }

        if (allRecords.length > 1) {
            console.warn(`[RACE CONDITION DETECTED] Found ${allRecords.length} records. Self-correcting...`);
            
            // Sort by creation time to find the absolute oldest (the "canonical" record).
            const sortedRecords = [...allRecords].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            const canonicalRecord = sortedRecords[0];
            
            console.log("The canonical record (oldest) is:", canonicalRecord.id);

            if (canonicalRecord.id === newRecord.id) {
                // Our record is the oldest. This is unusual but we are the winner of the race.
                console.log("Our created record is the oldest. Using it. Other hosts will delete their duplicates.");
                resolve(canonicalRecord);
            } else {
                // Our record is NOT the oldest. We lost the race.
                console.log("Our record is not the oldest. Deleting our duplicate and using the canonical one.");
                try {
                    await room.collection(COLLECTION_NAME).delete(newRecord.id);
                    console.log("Successfully deleted our duplicate record:", newRecord.id);
                } catch (e) {
                    console.error("Failed to delete our own duplicate record. This is not critical if another process cleans it up.", e);
                }
                resolve(canonicalRecord);
            }
        } else {
            console.error("Verification anomaly: No records found after creation. Using the one we created as a fallback.");
            resolve(newRecord);
        }
    });
}

export async function updateSlot(room, recordId, slotIndex, data) {
    if (slotIndex < 0 || slotIndex >= 10) {
        console.error(`Invalid slot index: ${slotIndex}`);
        return;
    }
    const payload = {
        [`slot_${slotIndex}`]: data
    };
    try {
        await room.collection(COLLECTION_NAME).update(recordId, payload);
    } catch (e) {
        console.error(`Failed to update slot ${slotIndex}:`, e);
    }
}

export async function updatePlayersData(room, recordId, playersData) {
    await updateSlot(room, recordId, PLAYER_DATA_SLOT, playersData);
}

export async function updateWorldData(room, recordId, worldData) {
    await updateSlot(room, recordId, WORLD_DATA_SLOT, worldData);
}


export function subscribeToGameState(room, callback) {
    return room.collection(COLLECTION_NAME).subscribe(records => {
        if (records.length > 0) {
            callback(records[0]);
        } else {
            callback(null);
        }
    });
}