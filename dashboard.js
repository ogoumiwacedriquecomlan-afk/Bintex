/**
 * Dashboard.js - Core application logic for the user dashboard
 * Handles Balances, Deposits, Pack Purchases, and Withdrawals.
 */

// Load user data on startup
// let currentUser = Auth.getCurrentUser(); // Removed sync call
let currentUser = null;


const PACKS = [
    { name: 'Starter', price: 2000, daily: 400, img: 'images/pack-starter.png' },
    { name: 'Basic', price: 5000, daily: 1000, img: 'images/pack-basic.png' },
    { name: 'Bronze', price: 15000, daily: 3000, img: 'images/pack-bronze.png' },
    { name: 'Silver', price: 30000, daily: 6000, img: 'images/pack-silver.png' },
    { name: 'Gold', price: 45000, daily: 9000, img: 'images/pack-gold.png' },
    { name: 'Platinum', price: 100000, daily: 20000, img: 'images/pack-platinum.png' },
    { name: 'Diamond', price: 500000, daily: 100000, img: 'images/pack-diamond.png' },
    { name: 'Elite', price: 1000000, daily: 200000, img: 'images/pack-elite.png' },
    { name: 'Master', price: 1500000, daily: 300000, img: 'images/pack-master.png' },
    { name: 'Royal', price: 2000000, daily: 400000, img: 'images/pack-royal.png' }
];

const Dashboard = {
    init: async () => {
        // Show loading state if needed, or just wait
        try {
            currentUser = await Auth.getCurrentUser();
            if (!currentUser) {
                alert("Erreur: Impossible de charger le profil utilisateur.\nConsultez la console (F12) pour voir les détails.\n(Redirection vers login dans 5s)");
                setTimeout(() => { window.location.href = 'login.html'; }, 5000);
                return;
            }

            Dashboard.renderUI();
            Dashboard.renderHistory();
            Dashboard.renderPacks();
            Dashboard.renderDepositOptions();

            // Attach Events
            document.getElementById('logoutBtn').onclick = Auth.logout; // Cleaner attach
            document.getElementById('withdrawBtn').onclick = Dashboard.handleWithdraw;
            document.getElementById('copyRefBtn').onclick = Dashboard.copyReferral;
        } catch (error) {
            console.error("Dashboard init failed", error);
            // Optionally redirect to login or show error
        }
    },

    renderUI: () => {
        document.getElementById('uName').innerText = currentUser.name;
        document.getElementById('uId').innerText = 'ID: ' + currentUser.referralCode;

        // Formatter
        const fmt = (n) => n.toLocaleString('fr-FR') + ' FCFA';

        // Update Balances
        document.getElementById('balMain').innerText = fmt(currentUser.balanceMain);
        document.getElementById('balGains').innerText = fmt(currentUser.balanceGains);
        document.getElementById('balComm').innerText = fmt(currentUser.balanceCommissions);

        // Update Ref Link
        if (document.getElementById('refLinkInput')) {
            document.getElementById('refLinkInput').value = `https://bintex.app/ref/${currentUser.referralCode}`;
        }
    },

    // DEPOSIT LOGIC
    renderDepositOptions: () => {
        const DEPOSIT_OPTIONS = [
            { amount: 2000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-gg_aYd1h3' },
            { amount: 5000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-zz67n8my3' },
            { amount: 15000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-_FcYxkXde' },
            { amount: 30000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-rpfco8HL3' },
            { amount: 45000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-ONKWqYvdf' },
            { amount: 100000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-hrZtM73N_' },
            { amount: 500000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-SZHcn61K2' },
            { amount: 1000000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-fYQqlxLlO' },
            { amount: 1500000, link: 'https://direct.kkiapay.me/37398/BINTEX(Investment)-_O7zuRCKG' }
        ];

        const container = document.getElementById('depositGrid');
        if (!container) return; // Guard clause

        container.innerHTML = DEPOSIT_OPTIONS.map(opt => `
            <a href="${opt.link}" target="_blank" class="deposit-card">
                <div class="d-amount text-gold">${opt.amount.toLocaleString()} F</div>
                <div class="d-label">Recharger</div>
                <i class="ph ph-arrow-square-out d-icon"></i>
            </a>
        `).join('');
    },


    // BUY PACK LOGIC
    buyPack: async (packName) => {
        const pack = PACKS.find(p => p.name === packName);
        if (!pack) return;

        // Refresh state before check
        currentUser = await Auth.getCurrentUser();

        if (currentUser.balanceMain < pack.price) {
            alert(`Solde insuffisant ! Il vous manque ${(pack.price - currentUser.balanceMain).toLocaleString()} FCFA sur votre Compte Principal.`);
            document.querySelector('#depositSection').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        // Confirm
        if (!confirm(`Confirmer l'achat du pack ${pack.name} pour ${pack.price.toLocaleString()} FCFA ?`)) return;

        // Execute Transaction
        currentUser.balanceMain -= pack.price;

        // Add to Active Packs
        currentUser.activePacks.push({
            id: 'pk_' + Date.now(),
            name: pack.name,
            price: pack.price,
            dailyReturn: pack.daily,
            date: new Date().toLocaleDateString('fr-FR')
        });

        // Add to History
        currentUser.transactions.unshift({
            type: 'achat',
            amount: pack.price,
            detail: `Pack ${pack.name}`,
            date: new Date().toLocaleDateString('fr-FR') + ' ' + new Date().toLocaleTimeString('fr-FR'),
            status: 'Activé'
        });

        await Dashboard.saveAndRefresh();
        alert(`Félicitations ! Le pack ${pack.name} est activé. Vous recevrez ${pack.daily} FCFA chaque jour.`);
    },

    // SIMULATED EARNINGS (Click button to simulate 24h)
    claimDaily: async () => {
        const totalDaily = currentUser.activePacks.reduce((sum, p) => sum + p.dailyReturn, 0);

        if (totalDaily === 0) {
            alert("Vous n'avez aucun pack actif. Achetez un pack pour commencer à gagner.");
            return;
        }

        currentUser.balanceGains += totalDaily;

        currentUser.transactions.unshift({
            type: 'gain',
            amount: totalDaily,
            date: new Date().toLocaleDateString('fr-FR') + ' ' + new Date().toLocaleTimeString('fr-FR'),
            status: 'Reçu'
        });

        await Dashboard.saveAndRefresh();
        alert(`Gains du jour récupérés : ${totalDaily.toLocaleString()} FCFA !`);
    },

    handleWithdraw: () => {
        // Logic for withdrawal
        alert("Fonctionnalité de retrait bientôt disponible. Vos fonds sont en sécurité.");
    },

    copyReferral: () => {
        const link = `https://bintex.app/ref/${currentUser.referralCode}`;
        navigator.clipboard.writeText(link).then(() => {
            alert("Lien de parrainage copié !");
        }).catch(err => {
            console.error('Erreur copie:', err);
            // Fallback
            prompt("Copiez votre lien:", link);
        });
    },

    renderPacks: () => {
        const grid = document.getElementById('dashPacksGrid');
        grid.innerHTML = '';

        PACKS.forEach(pack => {
            // Check if user has enough
            const canBuy = currentUser.balanceMain >= pack.price;
            const btnClass = canBuy ? 'btn-primary' : 'btn-outline';
            const btnText = canBuy ? 'Acheter' : 'Solde insuffisant';

            const card = document.createElement('div');
            card.className = 'pack-card-mini';
            card.innerHTML = `
                <div class="p-head">
                    <img src="${pack.img}" onerror="this.src='images/pack-starter.png'" class="p-icon-mini">
                    <div>
                        <h4>${pack.name}</h4>
                        <span class="p-price text-gold">${pack.price.toLocaleString()} F</span>
                    </div>
                </div>
                <div class="p-body">
                    <p>Gain: ${pack.daily.toLocaleString()} F/j</p>
                    <button class="btn btn-sm ${btnClass}" onclick="Dashboard.buyPack('${pack.name}')">${btnText}</button>
                </div>
            `;
            grid.appendChild(card);
        });

        // Render Active Packs List
        const activeList = document.getElementById('activePacksList');
        activeList.innerHTML = currentUser.activePacks.map(p => `
            <div class="active-pack-item">
                <span>${p.name}</span>
                <span class="text-gold">+${p.dailyReturn} F/j</span>
            </div>
        `).join('') || '<div style="opacity:0.5; font-size:0.9rem;">Aucun pack actif</div>';
    },

    renderHistory: () => {
        const tbody = document.getElementById('historyBody');
        tbody.innerHTML = currentUser.transactions.map(t => {
            let color = 'text-white';
            if (t.type === 'dépôt' || t.type === 'gain') color = 'text-green';
            if (t.type === 'achat' || t.type === 'retrait') color = 'text-red';

            return `
                <tr>
                    <td>${t.type.toUpperCase()}</td>
                    <td>${t.detail || '-'}</td>
                    <td class="${color}">${t.amount > 0 ? '+' : ''}${t.amount.toLocaleString()}</td>
                    <td>${t.date}</td>
                    <td><span class="status-badge">${t.status}</span></td>
                </tr>
            `;
        }).join('');
    },

    saveAndRefresh: async () => {
        await Auth.updateUser(currentUser);
        await Dashboard.init(); // Re-render
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', Dashboard.init);

// Simulation Trigger global
window.simulateDay = Dashboard.claimDaily;
