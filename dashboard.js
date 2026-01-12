/**
 * Dashboard.js - Core application logic for the user dashboard
 * Handles Balances, Deposits, Pack Purchases, and Withdrawals.
 */

const Dashboard = {
    currentUser: null,

    init: async () => {
        try {
            // 1. Check Session
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                window.location.href = 'login.html';
                return;
            }

            // 2. Fetch Profile from Supabase
            let { data: profile, error } = await supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();

            // RECOVERY: If profile is missing (e.g. after DB reset), create it.
            if (error && error.code === 'PGRST116') {
                console.warn("Profil manquant. Tentative de recréation...");

                const newProfile = {
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.user_metadata.full_name || 'Utilisateur',
                    phone: session.user.user_metadata.phone || '',
                    referral_code: 'BIN' + Math.floor(1000 + Math.random() * 9000),
                    balance_main: 0,
                    active_packs: [],
                    transactions: [],
                    created_at: new Date().toISOString()
                };

                const { error: createErr } = await supabaseClient
                    .from('profiles')
                    .insert([newProfile]);

                if (!createErr) {
                    profile = newProfile;
                    error = null; // Clear error
                } else {
                    console.error("Echec recréation profil", createErr);
                    // DEBUG: Update error message to show why creation failed
                    error = {
                        message: "Echec création profil: " + createErr.message,
                        code: createErr.code || error.code
                    };
                }
            }

            if (error || !profile) {
                console.error("Profile load error", error);
                // DEBUG: Show actual error to user
                alert("Erreur chargement profil: " + (error?.message || "Erreur inconnue") + "\nCode: " + (error?.code || "N/A"));
                await supabaseClient.auth.signOut();
                window.location.href = 'login.html';
                return;
            }

            Dashboard.currentUser = profile;

            Dashboard.renderUI();
            Dashboard.renderHistory();
            Dashboard.renderPacks();
            Dashboard.renderDepositOptions();
            Dashboard.fetchReferrals();

            // Attach Events
            document.getElementById('logoutBtn').onclick = async () => {
                await supabaseClient.auth.signOut();
                window.location.href = 'login.html';
            };
            document.getElementById('withdrawBtn').onclick = Dashboard.handleWithdraw;
            if (document.getElementById('copyRefBtn')) {
                document.getElementById('copyRefBtn').onclick = Dashboard.copyReferral;
            }

            // Manual Deposit Event
            const depositForm = document.getElementById('depositForm');
            if (depositForm) {
                depositForm.onsubmit = Dashboard.submitDeposit;
            }

        } catch (error) {
            console.error("Dashboard init critical failure", error);
        }
    },

    renderUI: () => {
        const user = Dashboard.currentUser;
        document.getElementById('uName').innerText = user.name || 'Investisseur';
        document.getElementById('uId').innerText = 'ID: ' + (user.referral_code || '---');

        const fmt = (n) => (n || 0).toLocaleString('fr-FR') + ' FCFA';

        document.getElementById('balMain').innerText = fmt(user.balance_main);
        document.getElementById('balGains').innerText = fmt(user.balance_gains);
        document.getElementById('balComm').innerText = fmt(user.balance_commissions);

        if (document.getElementById('refLinkInput')) {
            document.getElementById('refLinkInput').value = `${window.location.origin}/register.html?ref=${user.referral_code}`;
        }
    },

    // --- DEPOSIT SYSTEM (MANUAL) ---
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
        if (!container) return;

        container.innerHTML = DEPOSIT_OPTIONS.map(opt => `
            <a href="${opt.link}" target="_blank" class="deposit-card" onclick="Dashboard.handleLinkClick(${opt.amount})">
                <div class="d-amount text-gold">${opt.amount.toLocaleString()} F</div>
                <div class="d-label">Recharger</div>
                <i class="ph ph-arrow-square-out d-icon"></i>
            </a>
        `).join('');

        // Info message (only append if not already there)
        if (!container.nextElementSibling || container.nextElementSibling.className !== 'deposit-info') {
            const info = document.createElement('div');
            info.className = 'deposit-info';
            info.style.marginTop = '10px';
            info.innerHTML = `<p><i class="ph ph-info"></i> Important : Après le paiement, copiez l'ID de transaction reçu par SMS/Mail et validez ci-dessous.</p>`;
            container.parentNode.insertBefore(info, container.nextSibling);
        }
    },

    handleLinkClick: (amount) => {
        // Pre-fill amount if input exists
        const amountInput = document.getElementById('depAmount');
        if (amountInput) amountInput.value = amount;
    },

    submitDeposit: async (e) => {
        e.preventDefault();
        const amount = document.getElementById('depAmount').value;
        const txId = document.getElementById('depTxId').value;
        const btn = e.target.querySelector('button');

        if (!amount || !txId) {
            alert("Veuillez remplir le montant et l'ID de transaction.");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Envoi...';

        try {
            const { error } = await supabaseClient
                .from('deposits')
                .insert([{
                    user_id: Dashboard.currentUser.id,
                    amount: amount,
                    transaction_id: txId,
                    status: 'pending'
                }]);

            if (error) throw error;

            alert("Dépôt soumis ! Il sera validé sous 24h.");
            e.target.reset();
        } catch (err) {
            alert("Erreur lors de l'envoi : " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Confirmer le Dépôt';
        }
    },


    // --- PURCHASES (SECURE RPC) ---
    buyPack: async (packName) => {
        const PACKS = [
            { name: 'Starter', price: 2000, daily: 400 },
            { name: 'Basic', price: 5000, daily: 1000 },
            { name: 'Bronze', price: 15000, daily: 3000 },
            { name: 'Silver', price: 30000, daily: 6000 },
            { name: 'Gold', price: 45000, daily: 9000 },
            { name: 'Platinum', price: 100000, daily: 20000 },
            { name: 'Diamond', price: 500000, daily: 100000 },
            { name: 'Elite', price: 1000000, daily: 200000 },
            { name: 'Master', price: 1500000, daily: 300000 },
            { name: 'Royal', price: 2000000, daily: 400000 }
        ];

        const pack = PACKS.find(p => p.name === packName);
        if (!pack) return;

        if (Dashboard.currentUser.balance_main < pack.price) {
            alert(`Solde insuffisant. Il vous faut ${pack.price.toLocaleString()} FCFA.`);
            document.querySelector('#depositSection').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        if (!confirm(`Confirmer l'achat du pack ${pack.name} ?`)) return;

        // Call RPC logic
        // Calls the Function inside Supabase to handle ACID transaction (Balance - Price) AND (Affiliation Credits)
        const { error } = await supabaseClient.rpc('buy_pack', {
            pack_name: pack.name,
            pack_price: pack.price,
            pack_daily: pack.daily
        });

        if (error) {
            console.error(error);
            alert("Erreur: " + error.message);
        } else {
            alert("Pack activé avec succès !");
            window.location.reload(); // Refresh to show new balance/pack
        }
    },

    // --- PACK RENDERING ---
    renderPacks: () => {
        const PACKS_META = [
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

        const grid = document.getElementById('dashPacksGrid');
        if (!grid) return;
        grid.innerHTML = '';

        PACKS_META.forEach(pack => {
            const canBuy = Dashboard.currentUser.balance_main >= pack.price;
            const btnClass = canBuy ? 'btn-primary' : 'btn-outline';

            grid.innerHTML += `
                <div class="pack-card-mini">
                    <div class="p-head">
                        <img src="${pack.img}" onerror="this.src='images/pack-starter.png'" class="p-icon-mini">
                        <div>
                            <h4>${pack.name}</h4>
                            <span class="p-price text-gold">${pack.price.toLocaleString()} F</span>
                        </div>
                    </div>
                    <div class="p-body">
                        <p>Gain: ${pack.daily.toLocaleString()} F/j</p>
                        <button class="btn btn-sm ${btnClass}" onclick="Dashboard.buyPack('${pack.name}')">Ajouter</button>
                    </div>
                </div>
            `;
        });

        // Active packs
        const activeList = document.getElementById('activePacksList');
        if (!activeList) return;

        const active = Dashboard.currentUser.active_packs || [];

        activeList.innerHTML = active.length ? active.map(p => `
            <div class="active-pack-item">
                <span>${p.name}</span>
                <span class="text-gold">+${p.dailyReturn} F/j</span>
            </div>
        `).join('') : '<div style="opacity:0.5; font-size:0.9rem;">Aucun pack actif</div>';
    },

    renderHistory: () => {
        const tbody = document.getElementById('historyBody');
        if (!tbody) return;

        const txs = Dashboard.currentUser.transactions || [];

        // Reverse to show newest first
        const sortedTxs = [...txs].reverse().slice(0, 20);

        tbody.innerHTML = sortedTxs.map(t => {
            let color = 'text-white';
            if (t.type === 'dépôt' || t.type === 'gain' || t.type === 'commission') color = 'text-green';
            if (t.type === 'achat' || t.type === 'retrait') color = 'text-red';

            return `
                <tr>
                    <td>${(t.type || '').toUpperCase()}</td>
                    <td>${t.detail || '-'}</td>
                    <td class="${color}">${(t.amount || 0).toLocaleString()}</td>
                    <td>${t.date || ''}</td>
                    <td><span class="status-badge">${t.status || 'OK'}</span></td>
                </tr>
            `;
        }).join('');
    },

    handleWithdraw: () => {
        alert("Les retraits sont traités automatiquement tous les Lundis.");
    },

    copyReferral: () => {
        const link = document.getElementById('refLinkInput').value;
        navigator.clipboard.writeText(link).then(() => alert("Lien copié !"));
    },

    // --- REFERRALS SYSTEM ---
    fetchReferrals: async () => {
        const container = document.getElementById('referralsList');
        if (!container) return;

        try {
            const { data, error } = await supabaseClient.rpc('get_my_referrals');

            if (error) throw error;

            if (!data || data.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding: 10px; opacity: 0.6;">Aucun filleul pour le moment.</div>';
                return;
            }

            container.innerHTML = data.map(ref => `
                <div style="background: rgba(255,255,255,0.03); padding: 10px; margin-bottom: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-weight:600;">${ref.name || 'Utilisateur'}</span>
                        <span style="font-size:0.8rem; color:#8892b0;">${ref.created_at}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.9rem;">
                        <span>Packs: ${ref.active_pack_count}</span>
                        <span class="text-gold">Investi: ${ref.total_invested.toLocaleString()} F</span>
                    </div>
                </div>
            `).join('');

        } catch (err) {
            console.error("Referral fetch error", err);
            container.innerHTML = '<div style="color:#ff6b6b; font-size:0.8rem;">Erreur chargement équipe.</div>';
        }
    }
};

document.addEventListener('DOMContentLoaded', Dashboard.init);

// Export for inline handlers if needed
window.Dashboard = Dashboard;
