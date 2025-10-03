import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { createClient, User } from '@supabase/supabase-js'

// --- SUPABASE SETUP ---
const supabaseUrl = 'https://cxjftikjoskdeakoxhgr.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amZ0aWtqb3NrZGVha294aGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDA1OTgsImV4cCI6MjA3NTA3NjU5OH0.CS2iXOABcX4QPY472eXW8MkxoQJXDiC_WzKWPhFtISY'
const supabase = createClient(supabaseUrl, supabaseKey)

// --- TYPE DEFINITIONS ---
interface LuggageItem {
  type: string;
  quantity: number;
}

interface Bon {
  id: string;
  createdAt: string;
  userId?: string;
  sender: {
    firstName: string;
    lastName: string;
    phone: string;
    cin: string;
  };
  recipient: {
    firstName: string;
    lastName: string;
    phone: string;
    cin: string;
  };
  origin: string;
  destination: string;
  luggage: LuggageItem[];
  total: number;
  paid: boolean;
}

interface AppSettings {
    bonStartNumber: number;
}

// --- STATE MANAGEMENT ---
let appState: {
  bons: Bon[];
  isLoggedIn: boolean;
  user: User | null;
  currentPage: string;
  luggageItems: Partial<LuggageItem>[];
  editingBonId: string | null;
  settings: AppSettings;
} = {
  bons: [],
  isLoggedIn: false,
  user: null,
  currentPage: 'dashboard',
  luggageItems: [{}],
  editingBonId: null,
  settings: {
    bonStartNumber: 1,
  },
};

// --- DOM ELEMENTS ---
const header = document.querySelector<HTMLElement>('.header')!;
const appRoot = document.getElementById('app-root')!;
const authContainer = document.getElementById('auth-container')!;
const loginPage = document.getElementById('login-page')!;
const registerPage = document.getElementById('register-page')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const registerForm = document.getElementById('register-form') as HTMLFormElement;
const pages = document.querySelectorAll<HTMLElement>('.page');
const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
const bonForm = document.getElementById('bon-form') as HTMLFormElement;
const luggageItemsContainer = document.getElementById('luggage-items')!;
const addLuggageItemButton = document.getElementById('add-luggage-item')!;
const historyTableBody = document.getElementById('history-table-body')!;
const searchInput = document.getElementById('search-history') as HTMLInputElement;
const recentBonsList = document.getElementById('recent-bons-list')!;
const noResultsDiv = document.getElementById('history-no-results')!;
const mobileMenuButton = document.getElementById('mobile-menu-button') as HTMLButtonElement;
const offlineIndicator = document.getElementById('offline-indicator')!;
const settingsForm = document.getElementById('settings-form') as HTMLFormElement;


// --- DATA PERSISTENCE (INDEXEDDB for OFFLINE QUEUE) ---
const DB_NAME = 'imendi-trans-db';
const DB_VERSION = 1;

const localDb = {
    _db: null as IDBDatabase | null,
    
    async init() {
        return new Promise<void>((resolve, reject) => {
            if (this._db) return resolve();
            
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => reject("Error opening DB");
            request.onsuccess = () => {
                this._db = request.result;
                resolve();
            };
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains('sync-queue')) {
                    db.createObjectStore('sync-queue', { autoIncrement: true });
                }
            };
        });
    },

    async _getStore(storeName: string, mode: IDBTransactionMode) {
        if (!this._db) await this.init();
        return this._db!.transaction(storeName, mode).objectStore(storeName);
    },
    
    async addToSyncQueue(bon: Bon): Promise<void> {
        const store = await this._getStore('sync-queue', 'readwrite');
        store.add(bon);
    },
};

// --- ERROR HANDLING ---
const handleSupabaseError = (error: any, context: string) => {
    console.error(`Supabase error (${context}):`, JSON.stringify(error, null, 2));
    const userMessage = `Une erreur est survenue lors de: ${context}.\nMessage: ${error.message}.\n\nCela peut être dû à un problème de configuration de la base de données (comme une règle de sécurité RLS récursive). Veuillez vérifier la console du navigateur pour le message d'erreur complet.`;
    alert(userMessage);
};

// --- SUPABASE DATA HELPERS ---
const bonToSupabase = (bon: Bon) => ({
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
});

const supabaseToBon = (data: any): Bon => ({
    id: data.id,
    createdAt: data.created_at,
    userId: data.user_id,
    sender: {
        firstName: data.sender_first_name,
        lastName: data.sender_last_name,
        phone: data.sender_phone,
        cin: data.sender_cin,
    },
    recipient: {
        firstName: data.recipient_first_name,
        lastName: data.recipient_last_name,
        phone: data.recipient_phone,
        cin: data.recipient_cin,
    },
    origin: data.origin,
    destination: data.destination,
    luggage: data.luggage,
    total: data.total,
    paid: data.paid,
});


// --- AUTHENTICATION ---
const showAuthError = (form: 'login' | 'register', message: string) => {
    const errorEl = document.getElementById(`${form}-error`)!;
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

const showAuthSuccess = (form: 'register', message: string) => {
    const successEl = document.getElementById(`${form}-success`)!;
    successEl.textContent = message;
    successEl.classList.remove('hidden');
}

const clearAuthMessages = () => {
    document.querySelectorAll('.auth-error, .auth-success').forEach(el => el.classList.add('hidden'));
}

const showApp = () => {
    authContainer.classList.add('hidden');
    header.classList.remove('hidden');
    appRoot.classList.remove('hidden');
    const welcomeEl = document.getElementById('dashboard-welcome');
    if (welcomeEl && appState.user) {
        welcomeEl.textContent = `Bienvenue, ${appState.user.email}. Voici un résumé de vos activités récentes.`;
    }
}

const showAuth = () => {
    header.classList.add('hidden');
    appRoot.classList.add('hidden');
    authContainer.classList.remove('hidden');
    loginPage.classList.add('active');
    registerPage.classList.remove('active');
    clearAuthMessages();
}

const handleLogin = async (e: SubmitEvent) => {
    e.preventDefault();
    clearAuthMessages();
    const email = (document.getElementById('login-email') as HTMLInputElement).value;
    const password = (document.getElementById('login-password') as HTMLInputElement).value;
    const submitButton = (e.target as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    
    submitButton.disabled = true;
    submitButton.textContent = 'Connexion...';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        showAuthError('login', error.message);
    } else if (data.user) {
        appState.isLoggedIn = true;
        appState.user = data.user;
        await initializeAppContent();
    }
    
    submitButton.disabled = false;
    submitButton.textContent = 'Se connecter';
}

const handleSignup = async (e: SubmitEvent) => {
    e.preventDefault();
    clearAuthMessages();
    const email = (document.getElementById('register-email') as HTMLInputElement).value;
    const password = (document.getElementById('register-password') as HTMLInputElement).value;
    const submitButton = (e.target as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;

    submitButton.disabled = true;
    submitButton.textContent = 'Inscription...';

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
        showAuthError('register', error.message);
    } else {
        showAuthSuccess('register', "Inscription réussie ! Vous pouvez maintenant vous connecter. Un email de confirmation a été envoyé (si activé).");
        registerForm.reset();
    }

    submitButton.disabled = false;
    submitButton.textContent = "S'inscrire";
};

const handleLogout = async () => {
    await supabase.auth.signOut();
    appState.isLoggedIn = false;
    appState.user = null;
    appState.bons = [];
    showAuth();
}

// --- SETTINGS ---
const SETTINGS_KEY = 'imendi-trans-settings';

const loadSettings = () => {
    try {
        const storedSettings = localStorage.getItem(SETTINGS_KEY);
        if (storedSettings) {
            const parsedSettings = JSON.parse(storedSettings);
            appState.settings = { ...appState.settings, ...parsedSettings };
        }
    } catch (e) {
        console.error("Failed to load settings from localStorage", e);
    }
};

const saveSettings = () => {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(appState.settings));
        alert('Paramètres enregistrés !');
    } catch (e) {
        console.error("Failed to save settings to localStorage", e);
        alert('Erreur lors de la sauvegarde des paramètres.');
    }
};

const handleSettingsSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    const startNumberInput = document.getElementById('setting-bon-start-number') as HTMLInputElement;
    const newStartNumber = parseInt(startNumberInput.value, 10);

    if (!isNaN(newStartNumber) && newStartNumber > 0) {
        appState.settings.bonStartNumber = newStartNumber;
        saveSettings();
    } else {
        alert("Veuillez entrer un numéro de départ valide.");
    }
};


// --- NAVIGATION ---
const navigateTo = async (pageId: string) => {
  appState.currentPage = pageId;
  pages.forEach((page) => {
    page.classList.toggle('active', page.id === `${pageId}-page`);
  });
  navLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.page === pageId);
  });
  window.location.hash = pageId;

  // Refresh page-specific content
  if (pageId === 'history') renderHistoryTable();
  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'stats') renderStatsPage();
  if (pageId === 'settings') renderSettingsPage();
  if (pageId === 'new' && !appState.editingBonId) await prepareNewBonForm();
};

// --- RENDERING ---
const renderLuggageItems = () => {
  luggageItemsContainer.innerHTML = '';
  appState.luggageItems.forEach((item, index) => {
    const itemRow = document.createElement('div');
    itemRow.className = 'luggage-item-row';
    itemRow.innerHTML = `
      <input type="text" placeholder="Type d'article" value="${item.type || ''}" data-index="${index}" data-field="type" required />
      <input type="number" placeholder="Qté" value="${item.quantity || 1}" min="1" data-index="${index}" data-field="quantity" required />
      <button type="button" class="btn btn-danger remove-luggage-item" data-index="${index}" aria-label="Remove item">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>
    `;
    luggageItemsContainer.appendChild(itemRow);
  });
};

const renderHistoryTable = (bonsToRender: Bon[] = appState.bons) => {
    historyTableBody.innerHTML = '';
    noResultsDiv.classList.toggle('hidden', bonsToRender.length > 0);

    bonsToRender.sort((a, b) => b.id.localeCompare(a.id)).forEach(bon => {
        const row = document.createElement('tr');
        const paymentStatus = bon.paid 
            ? `<span class="status-paid">Payé</span>` 
            : `<span class="status-unpaid">Non Payé</span>`;

        row.innerHTML = `
            <td>${bon.id}</td>
            <td>${new Date(bon.createdAt).toLocaleDateString('fr-FR')}</td>
            <td>${bon.sender.firstName} ${bon.sender.lastName}</td>
            <td>${bon.recipient.firstName} ${bon.recipient.lastName}</td>
            <td>${bon.destination}</td>
            <td>${bon.total.toFixed(2)} €</td>
            <td>${paymentStatus}</td>
            <td class="actions-cell">
                <button class="btn btn-secondary btn-sm edit-bon" data-id="${bon.id}">Modifier</button>
                <button class="btn btn-success btn-sm share-bon" data-id="${bon.id}">Partager</button>
                <button class="btn btn-primary btn-sm export-pdf" data-id="${bon.id}">Exporter PDF</button>
            </td>
        `;
        historyTableBody.appendChild(row);
    });
};

const renderDashboard = () => {
    recentBonsList.innerHTML = '';
    const recent = [...appState.bons].sort((a,b) => b.id.localeCompare(a.id)).slice(0, 3);

    if (recent.length === 0) {
        recentBonsList.innerHTML = `<p class="text-gray-500">Aucun bon n'a encore été créé.</p>`;
        return;
    }
    
    recent.forEach(bon => {
        const item = document.createElement('div');
        item.className = 'recent-bon-item';
        item.innerHTML = `
            <div class="recent-bon-info">
                <p class="recent-bon-id">${bon.id}</p>
                <p class="recent-bon-dest">${bon.origin} → ${bon.destination}</p>
            </div>
            <p class="recent-bon-total">${bon.total.toFixed(2)} €</p>
        `;
        recentBonsList.appendChild(item);
    });
}

const renderStatsPage = () => {
    const startDateInput = document.getElementById('stats-start-date') as HTMLInputElement;
    const endDateInput = document.getElementById('stats-end-date') as HTMLInputElement;

    const startDate = startDateInput.value ? new Date(startDateInput.value) : null;
    const endDate = endDateInput.value ? new Date(endDateInput.value) : null;

    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    const filteredBons = appState.bons.filter(bon => {
        const bonDate = new Date(bon.createdAt);
        
        const afterStart = startDate ? bonDate >= startDate : true;
        const beforeEnd = endDate ? bonDate <= endDate : true;
        return afterStart && beforeEnd;
    });

    const totalRevenue = filteredBons.reduce((sum, bon) => sum + bon.total, 0);
    const paidBons = filteredBons.filter(b => b.paid);
    const totalPaid = paidBons.reduce((sum, bon) => sum + bon.total, 0);
    const totalUnpaid = totalRevenue - totalPaid;
    const numberOfBons = filteredBons.length;
    const numberPaid = paidBons.length;
    const numberUnpaid = numberOfBons - numberPaid;

    (document.getElementById('stats-total-revenue')!).textContent = `${totalRevenue.toFixed(2)} €`;
    (document.getElementById('stats-total-bons')!).textContent = `${numberOfBons} bons`;
    (document.getElementById('stats-paid-amount')!).textContent = `${totalPaid.toFixed(2)} €`;
    (document.getElementById('stats-unpaid-amount')!).textContent = `${totalUnpaid.toFixed(2)} €`;
    (document.getElementById('stats-paid-count')!).textContent = `${numberPaid} bons`;
    (document.getElementById('stats-unpaid-count')!).textContent = `${numberUnpaid} bons`;
};

const renderSettingsPage = () => {
    (document.getElementById('setting-bon-start-number') as HTMLInputElement).value = String(appState.settings.bonStartNumber);
};

// --- LOGIC ---
const generateBonId = async (): Promise<string> => {
    const year = new Date().getFullYear();
    const { data, error } = await supabase.from('bons').select('id').like('id', `BON-${year}-%`).order('id', { ascending: false }).limit(1);

    if (error) {
        handleSupabaseError(error, "Récupération du dernier ID de bon");
        // Fallback with settings start number
        return `BON-${year}-${String(appState.settings.bonStartNumber).padStart(4, '0')}`;
    }

    const lastBon = data?.[0];
    let nextNum = appState.settings.bonStartNumber;

    if (lastBon) {
        const lastNum = parseInt(lastBon.id.split('-')[2], 10);
        if (lastNum >= nextNum) {
            nextNum = lastNum + 1;
        }
    }
    
    return `BON-${year}-${String(nextNum).padStart(4, '0')}`;
};

const prepareNewBonForm = async () => {
  appState.editingBonId = null;
  bonForm.reset();
  appState.luggageItems = [{}];
  renderLuggageItems();
  (document.getElementById('bon-id') as HTMLInputElement).value = await generateBonId();
  (document.getElementById('bon-date') as HTMLInputElement).value = new Date().toLocaleDateString('fr-FR');
  (document.getElementById('new-page-title') as HTMLElement).textContent = "Créer un nouveau bon d'expédition";
  (document.getElementById('new-page-subtitle') as HTMLElement).textContent = "Remplissez les informations ci-dessous pour générer un reçu digital.";
  (document.getElementById('form-submit-button') as HTMLElement).textContent = "Enregistrer le Bon";
};

const handleFormSubmit = async (e: Event) => {
  e.preventDefault();
  const formData = new FormData(bonForm);
  
  const sender = {
    firstName: formData.get('sender.firstName') as string,
    lastName: formData.get('sender.lastName') as string,
    phone: formData.get('sender.phone') as string,
    cin: formData.get('sender.cin') as string,
  };
   const recipient = {
    firstName: formData.get('recipient.firstName') as string,
    lastName: formData.get('recipient.lastName') as string,
    phone: formData.get('recipient.phone') as string,
    cin: formData.get('recipient.cin') as string,
  };

  const luggage = appState.luggageItems.filter(item => item.type && item.quantity) as LuggageItem[];
  const total = parseFloat((document.getElementById('bon-total') as HTMLInputElement).value);
  const paid = (document.getElementById('bon-paid') as HTMLInputElement).checked;

  let bonToSave: Bon;

  if (appState.editingBonId) {
    const bonIndex = appState.bons.findIndex(b => b.id === appState.editingBonId);
    if (bonIndex > -1) {
      const existingBon = appState.bons[bonIndex];
      bonToSave = {
        ...existingBon,
        sender,
        recipient,
        origin: formData.get('origin') as string,
        destination: formData.get('destination') as string,
        luggage,
        total,
        paid,
      };
      appState.bons[bonIndex] = bonToSave;
    } else {
        return;
    }
  } else {
    bonToSave = {
      id: (document.getElementById('bon-id') as HTMLInputElement).value,
      createdAt: new Date().toISOString(),
      userId: appState.user?.id,
      sender,
      recipient,
      origin: formData.get('origin') as string,
      destination: formData.get('destination') as string,
      luggage,
      total,
      paid,
    };
    appState.bons.push(bonToSave);
  }

  if (navigator.onLine) {
    const { error } = await supabase.from('bons').upsert(bonToSupabase(bonToSave));
    if (error) {
        handleSupabaseError(error, "sauvegarde du bon");
        alert("La sauvegarde en ligne a échoué. Le bon a été enregistré localement et sera synchronisé plus tard.");
        await localDb.addToSyncQueue(bonToSave);
        requestSync();
    } else {
        alert(appState.editingBonId ? 'Bon mis à jour avec succès !' : 'Bon enregistré avec succès !');
    }
  } else {
      await localDb.addToSyncQueue(bonToSave);
      requestSync();
      alert(appState.editingBonId ? 'Bon mis à jour localement ! Il sera synchronisé plus tard.' : 'Bon enregistré localement ! Il sera synchronisé plus tard.');
  }


  appState.editingBonId = null;
  navigateTo('history');
};

const handleEditBon = (bonId: string) => {
    const bon = appState.bons.find(b => b.id === bonId);
    if (!bon) return;

    appState.editingBonId = bon.id;
    bonForm.reset();

    (document.getElementById('bon-id') as HTMLInputElement).value = bon.id;
    (document.getElementById('bon-date') as HTMLInputElement).value = new Date(bon.createdAt).toLocaleDateString('fr-FR');
    (document.getElementById('sender-firstName') as HTMLInputElement).value = bon.sender.firstName;
    (document.getElementById('sender-lastName') as HTMLInputElement).value = bon.sender.lastName;
    (document.getElementById('sender-phone') as HTMLInputElement).value = bon.sender.phone;
    (document.getElementById('sender-cin') as HTMLInputElement).value = bon.sender.cin;
    (document.getElementById('recipient-firstName') as HTMLInputElement).value = bon.recipient.firstName;
    (document.getElementById('recipient-lastName') as HTMLInputElement).value = bon.recipient.lastName;
    (document.getElementById('recipient-phone') as HTMLInputElement).value = bon.recipient.phone;
    (document.getElementById('recipient-cin') as HTMLInputElement).value = bon.recipient.cin;
    (document.getElementById('origin') as HTMLInputElement).value = bon.origin;
    (document.getElementById('destination') as HTMLInputElement).value = bon.destination;
    (document.getElementById('bon-total') as HTMLInputElement).value = bon.total.toString();
    (document.getElementById('bon-paid') as HTMLInputElement).checked = bon.paid;

    appState.luggageItems = bon.luggage.length > 0 ? JSON.parse(JSON.stringify(bon.luggage)) : [{}];
    renderLuggageItems();

    (document.getElementById('new-page-title') as HTMLElement).textContent = `Modifier le Bon ${bon.id}`;
    (document.getElementById('new-page-subtitle') as HTMLElement).textContent = "Mettez à jour les informations ci-dessous.";
    (document.getElementById('form-submit-button') as HTMLElement).textContent = "Mettre à jour le Bon";

    navigateTo('new');
};

const handleSearch = (e: Event) => {
    const term = (e.target as HTMLInputElement).value.toLowerCase();
    const filteredBons = appState.bons.filter(bon => 
        bon.id.toLowerCase().includes(term) ||
        `${bon.sender.firstName} ${bon.sender.lastName}`.toLowerCase().includes(term) ||
        `${bon.recipient.firstName} ${bon.recipient.lastName}`.toLowerCase().includes(term) ||
        bon.sender.phone.includes(term) ||
        bon.recipient.phone.includes(term) ||
        bon.destination.toLowerCase().includes(term)
    );
    renderHistoryTable(filteredBons);
}

const generateBonHTML = (bon: Bon): string => `
    <style>
      .pdf-body { font-size: 12px; color: #333; }
      .pdf-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1E3A8A; padding-bottom: 10px; margin-bottom: 20px;}
      .pdf-logo { font-size: 28px; font-weight: bold; color: #1E3A8A; }
      .pdf-bon-info { text-align: right; }
      .pdf-bon-id { font-size: 20px; font-weight: bold; }
      .pdf-section { display: flex; justify-content: space-between; margin-bottom: 20px; }
      .pdf-box { border: 1px solid #ccc; padding: 10px; border-radius: 5px; width: 48%; }
      .pdf-box h3 { margin: 0 0 10px; font-size: 14px; color: #1E3A8A; border-bottom: 1px solid #eee; padding-bottom: 5px;}
      .pdf-box p { margin: 2px 0; }
      .pdf-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      .pdf-table th, .pdf-table td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      .pdf-table th { background-color: #f3f4f6; }
      .pdf-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; }
      .pdf-total { text-align: right; font-size: 16px; font-weight: bold; }
      .pdf-status { font-size: 16px; font-weight: bold; }
    </style>
    <div class="pdf-body">
        <div class="pdf-header">
            <div class="pdf-logo">IMENDI TRANS</div>
            <div class="pdf-bon-info">
                <div class="pdf-bon-id">${bon.id}</div>
                <div>Date: ${new Date(bon.createdAt).toLocaleDateString('fr-FR')}</div>
            </div>
        </div>
        <div class="pdf-section">
            <div class="pdf-box">
                <h3>Expéditeur</h3>
                <p><strong>Nom:</strong> ${bon.sender.firstName} ${bon.sender.lastName}</p>
                <p><strong>Téléphone:</strong> ${bon.sender.phone}</p>
                <p><strong>CIN:</strong> ${bon.sender.cin}</p>
            </div>
            <div class="pdf-box">
                <h3>Destinataire</h3>
                <p><strong>Nom:</strong> ${bon.recipient.firstName} ${bon.recipient.lastName}</p>
                <p><strong>Téléphone:</strong> ${bon.recipient.phone}</p>
                <p><strong>CIN:</strong> ${bon.recipient.cin}</p>
            </div>
        </div>
        <div><strong>Trajet:</strong> ${bon.origin} → ${bon.destination}</div>
        
        <h3 style="margin-top: 20px; color: #1E3A8A;">Détails des Bagages</h3>
        <table class="pdf-table">
            <thead>
                <tr><th>Article</th><th>Quantité</th></tr>
            </thead>
            <tbody>
                ${bon.luggage.length > 0 ? bon.luggage.map(item => `
                    <tr>
                        <td>${item.type}</td>
                        <td>${item.quantity}</td>
                    </tr>
                `).join('') : `<tr><td colspan="2" style="text-align: center; color: #666;">Aucun article détaillé.</td></tr>`}
            </tbody>
        </table>
        <div class="pdf-footer">
            <div class="pdf-status">Statut: <span style="color: ${bon.paid ? '#16A34A' : '#EF4444'};">${bon.paid ? 'Payé' : 'Non Payé'}</span></div>
            <div class="pdf-total">Total: ${bon.total.toFixed(2)} €</div>
        </div>
    </div>
`;

const generatePDF = async (bonId: string) => {
  const bon = appState.bons.find(b => b.id === bonId);
  if (!bon) return;

  const container = document.getElementById('pdf-template-container')!;
  container.innerHTML = generateBonHTML(bon);

  const canvas = await html2canvas(container, { scale: 2 });
  const imgData = canvas.toDataURL('image/png');

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  pdf.save(`IMENDI_TRANS_${bon.id}.pdf`);

  container.innerHTML = '';
}

const handleShareBon = async (bonId: string) => {
    if (!navigator.share) {
        alert("La fonction de partage n'est pas supportée sur votre navigateur.");
        return;
    }

    const bon = appState.bons.find(b => b.id === bonId);
    if (!bon) return;

    const container = document.getElementById('pdf-template-container')!;
    container.innerHTML = generateBonHTML(bon);

    try {
        const canvas = await html2canvas(container, { scale: 2 });
        canvas.toBlob(async (blob) => {
            if (blob) {
                const file = new File([blob], `IMENDI_TRANS_${bon.id}.png`, { type: 'image/png' });
                await navigator.share({
                    title: `Bon d'expédition ${bon.id}`,
                    text: `Voici le reçu pour l'expédition de ${bon.origin} à ${bon.destination}.`,
                    files: [file],
                });
            }
        }, 'image/png');
    } catch (error) {
        console.error('Error sharing:', error);
    } finally {
        container.innerHTML = '';
    }
};

// --- SYNC & OFFLINE ---
const requestSync = () => {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(sw => {
            (sw as any).sync.register('sync-bons')
                .then(() => console.log('Background sync registered'))
                .catch((err: any) => console.error('Could not register sync:', err));
        }).catch((err: any) => console.error('Service worker not ready:', err));
    } else {
        console.warn('Background Sync not supported. Data will sync when app is next online and open.');
    }
};

const updateOnlineStatus = () => {
    if (navigator.onLine) {
        offlineIndicator.classList.add('hidden');
        console.log('App is online. Attempting to sync...');
        requestSync();
    } else {
        offlineIndicator.classList.remove('hidden');
        console.log('App is offline.');
    }
};

const initializeAppContent = async () => {
    loadSettings();
    
    const { data: bonsData, error: bonsError } = await supabase.from('bons').select('*');
    if (bonsError) {
        handleSupabaseError(bonsError, "chargement des bons");
    } else {
        appState.bons = bonsData.map(supabaseToBon);
    }
    
    showApp();
    const initialPage = window.location.hash.replace('#', '') || 'dashboard';
    await navigateTo(initialPage);
};

const checkSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error("Error getting session:", error);
        showAuth();
        return;
    }

    if (session) {
        appState.isLoggedIn = true;
        appState.user = session.user;
        await initializeAppContent();
    } else {
        showAuth();
    }
};

// --- INITIALIZATION & EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', async () => {
  await localDb.init();
  await checkSession();
  
  loginForm.addEventListener('submit', handleLogin);
  registerForm.addEventListener('submit', handleSignup);
  settingsForm.addEventListener('submit', handleSettingsSubmit);
  document.getElementById('logout-button')!.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });

  document.getElementById('show-register')!.addEventListener('click', (e) => {
      e.preventDefault();
      clearAuthMessages();
      loginPage.classList.remove('active');
      registerPage.classList.add('active');
  });

  document.getElementById('show-login')!.addEventListener('click', (e) => {
      e.preventDefault();
      clearAuthMessages();
      registerPage.classList.remove('active');
      loginPage.classList.add('active');
  });

  const closeMobileMenu = () => {
    document.body.classList.remove('mobile-nav-open');
    mobileMenuButton.setAttribute('aria-expanded', 'false');
  };
  mobileMenuButton.addEventListener('click', () => {
    const isExpanded = document.body.classList.toggle('mobile-nav-open');
    mobileMenuButton.setAttribute('aria-expanded', isExpanded.toString());
  });
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      if (page) { navigateTo(page); closeMobileMenu(); }
    });
  });

  document.body.addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    
    if (target.closest('[data-page-link]')) navigateTo(target.closest('[data-page-link]')!.getAttribute('data-page-link')!);
    
    const exportButton = target.closest('.export-pdf');
    if (exportButton) {
        const bonId = (exportButton as HTMLElement).dataset.id;
        if (bonId) {
            exportButton.textContent = 'Génération...';
            await generatePDF(bonId).finally(() => { exportButton.textContent = 'Exporter PDF'; });
        }
    }
    const editButton = target.closest('.edit-bon');
    if (editButton) {
        const bonId = (editButton as HTMLElement).dataset.id;
        if (bonId) handleEditBon(bonId);
    }
    const shareButton = target.closest('.share-bon');
    if (shareButton) {
        const bonId = (shareButton as HTMLElement).dataset.id;
        if (bonId) handleShareBon(bonId);
    }
  });

  addLuggageItemButton.addEventListener('click', () => {
    appState.luggageItems.push({});
    renderLuggageItems();
  });

  luggageItemsContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const removeButton = target.closest('.remove-luggage-item');
    if (removeButton) {
      const index = parseInt((removeButton as HTMLElement).dataset.index!, 10);
      if (appState.luggageItems.length > 1) {
          appState.luggageItems.splice(index, 1);
          renderLuggageItems();
      }
    }
  });

  luggageItemsContainer.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    const index = parseInt(target.dataset.index!, 10);
    const field = target.dataset.field as keyof LuggageItem;
    const value = target.type === 'number' ? parseFloat(target.value) : target.value;
    (appState.luggageItems[index] as any)[field] = value;
  });

  bonForm.addEventListener('submit', handleFormSubmit);
  searchInput.addEventListener('input', handleSearch);

  const statsStartDate = document.getElementById('stats-start-date');
  const statsEndDate = document.getElementById('stats-end-date');
  if (statsStartDate && statsEndDate) {
    statsStartDate.addEventListener('change', renderStatsPage);
    statsEndDate.addEventListener('change', renderStatsPage);
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
});