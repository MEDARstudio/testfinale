importScripts('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');

const CACHE_NAME = 'imendi-trans-cache-v1';
const URLS_TO_CACHE = [
  './',
  'index.html',
  'index.css',
  'index.tsx',
  'https://cdn.tailwindcss.com/',
  'https://esm.sh/jspdf@2.5.1',
  'https://esm.sh/html2canvas@1.4.1',
  'https://esm.sh/@supabase/supabase-js@2'
];
const DB_NAME = 'imendi-trans-db';
const DB_VERSION = 1;
const SYNC_QUEUE_STORE = 'sync-queue';

// --- IndexedDB Helpers (needed for background sync) ---
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject("Error opening DB");
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
            db.createObjectStore(SYNC_QUEUE_STORE, { autoIncrement: true });
        }
    };
  });
}

async function getItemsFromSyncQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
        const store = transaction.objectStore(SYNC_QUEUE_STORE);
        const request = store.getAll();
        const keysRequest = store.getAllKeys();

        let items, keys;

        request.onsuccess = () => {
            items = request.result;
            if(keys) resolve({items, keys});
        };
        keysRequest.onsuccess = () => {
            keys = keysRequest.result;
            if(items) resolve({items, keys});
        }
        
        transaction.onerror = () => reject("Transaction error on get sync items");
    });
}

async function deleteFromSyncQueue(keys) {
    if (!keys || keys.length === 0) return;
    const db = await openDB();
    const transaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    keys.forEach(key => store.delete(key));
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject("Transaction error on delete sync items");
    });
}


function bonToSupabase(bon) {
  return {
    id: bon.id,
    created_at: bon.createdAt,
    user_id: bon.userId,
    sender_first_name: bon.sender.firstName,
    sender_last_name: bon.sender.lastName,
    sender_phone: bon.sender.phone,
    sender_cin: bon.sender.cin,
    recipient_first_name: bon.recipient.firstName,
    recipient_last_name: bon.recipient.lastName,
    recipient_phone: bon.recipient.phone,
    recipient_cin: bon.recipient.cin,
    origin: bon.origin,
    destination: bon.destination,
    luggage: bon.luggage,
    total: bon.total,
    paid: bon.paid,
  };
}

// --- Sync Logic ---
async function syncBons() {
    console.log('[Service Worker] Starting synchronization...');
    try {
        const { items, keys } = await getItemsFromSyncQueue();
        if (!items || items.length === 0) {
            console.log('[Service Worker] Sync queue is empty. Nothing to sync.');
            return;
        }
        
        const supabaseUrl = 'https://cxjftikjoskdeakoxhgr.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amZ0aWtqb3NrZGVha294aGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDA1OTgsImV4cCI6MjA3NTA3NjU5OH0.CS2iXOABcX4QPY472eXW8MkxoQJXDiC_WzKWPhFtISY';
        const { createClient } = supabase;
        const supabaseClient = createClient(supabaseUrl, supabaseKey);

        const bonsToUpsert = items.map(bonToSupabase);
        
        const { error } = await supabaseClient.from('bons').upsert(bonsToUpsert);


        if (!error) {
            console.log('[Service Worker] Sync successful. Clearing queue.', items);
            await deleteFromSyncQueue(keys);
        } else {
            console.error('[Service Worker] Sync failed. Supabase responded with:', error);
            throw new Error('Supabase error');
        }
    } catch (error) {
        console.error('[Service Worker] Sync failed due to network error or DB issue.', error);
        throw error;
    }
}


// --- Service Worker Lifecycle ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache');
      return cache.addAll(URLS_TO_CACHE);
    }).catch(err => console.error("Cache addAll failed:", err))
  );
});

self.addEventListener('fetch', (event) => {
    // For navigation requests, use a network-first strategy to get the latest HTML
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => caches.match('index.html'))
        );
        return;
    }
    
    // For other requests, use a cache-first strategy
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).then(fetchResponse => {
                // Optionally, cache new requests dynamically
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, fetchResponse.clone());
                    return fetchResponse;
                })
            });
        })
    );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// --- Background Sync Event ---
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-bons') {
        console.log('[Service Worker] Background sync event received for "sync-bons".');
        event.waitUntil(syncBons());
    }
});