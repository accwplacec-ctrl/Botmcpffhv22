// firebase.js
const admin = require('firebase-admin');
const config = require('./config');

let database = null;
let isInitialized = false;

function initFirebase() {
    if (isInitialized) return;
    try {
        let serviceAccount;
        if (config.FIREBASE_SERVICE_ACCOUNT_JSON) {
            serviceAccount = JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON);
        } else {
            console.error('[Firebase] No service account');
            return;
        }
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: config.FIREBASE_DATABASE_URL
            });
        }
        database = admin.database();
        isInitialized = true;
        console.log('[Firebase] Initialized');
    } catch (e) {
        console.error('[Firebase] Init error:', e);
    }
}

async function loadMemory() {
    if (!isInitialized) initFirebase();
    if (!database) return null;
    try {
        const snapshot = await database.ref('bot_memory').once('value');
        const data = snapshot.val();
        if (data) {
            console.log('[Firebase] Memory loaded');
            return data;
        }
        console.log('[Firebase] No memory found');
        return null;
    } catch (e) {
        console.error('[Firebase] Load memory error:', e);
        return null;
    }
}

async function saveMemory(memory) {
    if (!isInitialized) initFirebase();
    if (!database) return false;
    try {
        await database.ref('bot_memory').set(memory);
        console.log('[Firebase] Memory saved');
        return true;
    } catch (e) {
        console.error('[Firebase] Save memory error:', e);
        return false;
    }
}

async function getRelayUrl() {
    if (!isInitialized) initFirebase();
    if (!database) return null;
    try {
        const snapshot = await database.ref('relay_url').once('value');
        const url = snapshot.val();
        if (url) console.log('[Firebase] Relay URL fetched');
        return url;
    } catch (e) {
        console.error('[Firebase] Get relay URL error:', e);
        return null;
    }
}

// ===== NEW METHODS FOR REASONER B =====
async function saveStrategyNotes(notes) {
    if (!isInitialized) initFirebase();
    if (!database) return false;
    try {
        await database.ref('strategy_notes').set(notes);
        console.log('[Firebase] Strategy notes saved');
        return true;
    } catch (e) {
        console.error('[Firebase] Save strategy notes error:', e);
        return false;
    }
}

async function loadStrategyNotes() {
    if (!isInitialized) initFirebase();
    if (!database) return null;
    try {
        const snapshot = await database.ref('strategy_notes').once('value');
        const data = snapshot.val();
        if (data) {
            console.log('[Firebase] Strategy notes loaded');
            return data;
        }
        return null;
    } catch (e) {
        console.error('[Firebase] Load strategy notes error:', e);
        return null;
    }
}

async function loadFullDataForReasoner() {
    if (!isInitialized) initFirebase();
    if (!database) return null;
    try {
        const [memorySnapshot, strategySnapshot] = await Promise.all([
            database.ref('bot_memory').once('value'),
            database.ref('strategy_notes').once('value')
        ]);
        return {
            memory: memorySnapshot.val() || null,
            strategy: strategySnapshot.val() || null
        };
    } catch (e) {
        console.error('[Firebase] Load full data error:', e);
        return null;
    }
}

module.exports = {
    loadMemory,
    saveMemory,
    getRelayUrl,
    saveStrategyNotes,
    loadStrategyNotes,
    loadFullDataForReasoner
};
