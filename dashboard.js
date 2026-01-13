const Dashboard = {
    currentUser: null,
    rewardInterval: null,

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

            // RECOVERY: If profile is missing
            if (error && error.code === 'PGRST116') {
                console.warn("Profil manquant...");
                // Handle profile creation if needed (simplified for brevity)
            }

            if (error || !profile) {
                console.error("Profile load error", error);
                await supabaseClient.auth.signOut();
                window.location.href = 'login.html';
                return;
            }

            Dashboard.currentUser = profile;

            // 3. Render UI Components
            Dashboard.renderUI();
            Dashboard.renderPacks();
            Dashboard.renderDepositOptions();
            Dashboard.renderHistory();
            Dashboard.fetchTeamReferrals();
            Dashboard.processRewards();
            Dashboard.checkShareholderBonuses();
            Dashboard.promptWhatsApp(); // Initial prompt

            // Attach Global Events
            document.getElementById('logoutBtn').onclick = () => supabaseClient.auth.signOut().then(() => window.location.href = 'login.html');
            if (document.getElementById('copyRefBtn')) document.getElementById('copyRefBtn').onclick = Dashboard.copyReferral;

            const manualForm = document.getElementById('manualDepositForm');
            if (manualForm) manualForm.onsubmit = Dashboard.submitManualDeposit;

        } catch (error) {
            console.error("Init failure", error);
        }
    },

    renderUI: () => {
        const user = Dashboard.currentUser;
        document.getElementById('uName').innerText = user.name || 'Investisseur';
        document.getElementById('uId').innerText = 'ID: ' + (user.referral_code || '---');

        const adminLink = document.getElementById('adminLink');
        if (adminLink && user.role === 'admin') adminLink.style.display = 'inline-flex';

        const fmt = (n) => (n || 0).toLocaleString('fr-FR') + ' FCFA';
        document.getElementById('balMain').innerText = fmt(user.balance_main);
        document.getElementById('balGains').innerText = fmt(user.balance_gains);
        document.getElementById('balComm').innerText = fmt(user.balance_commissions);

        if (document.getElementById('refLinkInput')) {
            document.getElementById('refLinkInput').value = `${window.location.origin}/register.html?ref=${user.referral_code}`;
        }

        // Stats Mini
        const totalInvested = (user.active_packs || []).reduce((acc, p) => acc + (p.price || 0), 0);
        const totalEarned = (user.transactions || [])
            .filter(t => t.type === 'gain')
            .reduce((acc, t) => acc + (t.amount || 0), 0);

        document.getElementById('totalInvested').innerText = totalInvested.toLocaleString() + ' F';
        document.getElementById('totalEarned').innerText = totalEarned.toLocaleString() + ' F';
    },

    // --- NAVIGATION ---
    switchPage: (pageId) => {
        // Hide all pages
        document.querySelectorAll('.dash-page').forEach(p => p.classList.remove('active'));
        // Show target page
        const target = document.getElementById(pageId);
        if (target) target.classList.add('active');

        // Update Nav Menu UI (Bottom Nav)
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(pageId)) {
                btn.classList.add('active');
            }
        });

        // WhatsApp Prompt on page change
        Dashboard.promptWhatsApp();
        // Silent rewards check
        Dashboard.processRewards();
    },

    promptWhatsApp: () => {
        // The user asked for a prompt "à chaque changement de page ou d'actualisation"
        // We use confirm to be interactive as requested.
        const join = confirm("BINTEX INFO: Rejoignez notre canal WhatsApp Officiel pour recevoir vos paiements et infos en temps réel ! \n\nCliquez sur OK pour rejoindre maintenant.");
        if (join) {
            window.open("https://whatsapp.com/channel/0029VbC9xOoLo4hjAZYTlL3S", "_blank");
        }
    },

    // --- REWARDS SYSTEM ---
    processRewards: async () => {
        try {
            const { data, error } = await supabaseClient.rpc('process_daily_rewards');
            if (error) throw error;

            if (data.status === 'success') {
                Dashboard.showSeriousMessage(`Gains reçus : +${data.amount} FCFA (${data.days_processed} jour(s)) !`);
                // Reload profile data to get new balance
                const { data: updatedProf } = await supabaseClient.from('profiles').select('*').eq('id', Dashboard.currentUser.id).single();
                Dashboard.currentUser = updatedProf;
                Dashboard.renderUI();
                Dashboard.renderHistory();
            }
        } catch (e) {
            console.error("Rewards system error", e);
        }
    },

    // --- TEAM REFERRALS (LEVELS) ---
    fetchTeamReferrals: async () => {
        const containers = {
            1: document.getElementById('ref-lvl-1'),
            2: document.getElementById('ref-lvl-2'),
            3: document.getElementById('ref-lvl-3')
        };

        try {
            const { data, error } = await supabaseClient.rpc('get_team_referrals');
            if (error) throw error;

            // Group by level
            const grouped = { 1: [], 2: [], 3: [] };
            data.forEach(r => { if (grouped[r.level]) grouped[r.level].push(r); });

            [1, 2, 3].forEach(lvl => {
                const list = grouped[lvl];
                const container = containers[lvl];
                if (!container) return;

                if (!list || list.length === 0) {
                    container.innerHTML = '<div style="opacity:0.4; font-size:0.8rem; padding:10px;">Aucun membre.</div>';
                } else {
                    container.innerHTML = list.map(ref => `
                        <div class="ref-card">
                            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                <span style="font-weight:600;">${ref.name}</span>
                                <span style="font-size:0.75rem; color:#8892b0;">${ref.created_at}</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                <span>Packs: ${ref.active_pack_count}</span>
                                <span class="text-gold">${(ref.total_invested || 0).toLocaleString()} F</span>
                            </div>
                        </div>
                    `).join('');
                }
            });

        } catch (e) {
            console.error("Team fetch error", e);
        }
    },

    // --- DEPOSITS ---
    renderDepositOptions: () => {
        const opts = [2000, 5000, 15000, 30000, 45000, 100000, 500000, 1000000, 1500000];
        const grid = document.getElementById('depositGrid');
        if (!grid) return;
        grid.innerHTML = opts.map(amt => `
            <div class="deposit-card" onclick="Dashboard.prepareUSSD(${amt})">
                <div class="d-amount text-gold">${(amt / 1000)}k</div>
                <div class="d-label">Choisir</div>
            </div>
        `).join('');
    },

    prepareUSSD: (amount) => {
        const ussdAction = document.getElementById('ussdAction');
        const ussdBtn = document.getElementById('ussdBtn');
        const depAmount = document.getElementById('depAmount');

        depAmount.value = amount;
        ussdBtn.href = `tel:*855*1*1*0165848336*0165848336*${amount}#`;
        ussdAction.style.display = 'block';
    },

    submitManualDeposit: async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.innerHTML = 'Traitement...';

        const payload = {
            user_id: Dashboard.currentUser.id,
            amount: parseFloat(document.getElementById('depAmount').value),
            transaction_id: document.getElementById('depTxId').value,
            sender_phone: document.getElementById('senderNum').value,
            status: 'pending'
        };

        const { error } = await supabaseClient.from('deposits').insert([payload]);
        if (error) {
            alert("Erreur: " + error.message);
        } else {
            alert("Demande envoyée ! Attente de validation admin.");
            e.target.reset();
            document.getElementById('ussdAction').style.display = 'none';
        }
        btn.disabled = false;
        btn.innerHTML = 'Confirmer mon dépôt';
    },

    // --- PACKS ---
    renderPacks: () => {
        const PACKS = [
            { name: 'Starter', price: 2000, daily: 400, img: 'images/pack-starter.png' },
            { name: 'Basic', price: 5000, daily: 1000, img: 'images/pack-basic.png' },
            { name: 'Bronze', price: 15000, daily: 3000, img: 'images/pack-bronze.png' },
            { name: 'Silver', price: 30000, daily: 6000, img: 'images/pack-silver.png' },
            { name: 'Gold', price: 45000, daily: 9000, img: 'images/pack-gold.png' },
            { name: 'Platinum', price: 100000, daily: 20000, img: 'images/pack-platinum.png' }
        ];

        const grid = document.getElementById('dashPacksGrid');
        if (!grid) return;
        grid.innerHTML = PACKS.map(p => `
            <div class="pack-card-mini">
                <div class="p-head">
                    <img src="${p.img}" onerror="this.src='images/pack-starter.png'" class="p-icon-mini">
                    <div>
                        <h4>${p.name}</h4>
                        <span class="text-gold">${p.price.toLocaleString()} F</span>
                    </div>
                </div>
                <div class="p-body">
                    <p>Gain: ${p.daily.toLocaleString()} F/j</p>
                    <button class="btn btn-sm btn-primary" onclick="Dashboard.buyPack('${p.name}', ${p.price}, ${p.daily})">Activer</button>
                </div>
            </div>
        `).join('');

        const activeList = document.getElementById('activePacksList');
        const active = Dashboard.currentUser.active_packs || [];
        activeList.innerHTML = active.length ? active.map(p => `
            <div class="active-pack-item">
                <span>${p.name}</span>
                <span class="text-gold">+${(p.dailyReturn || 0).toLocaleString()} F/j</span>
            </div>
        `).join('') : '<div style="opacity:0.5;">Aucun pack actif</div>';
    },

    buyPack: async (name, price, daily) => {
        if (Dashboard.currentUser.balance_main < price) {
            alert("Solde insuffisant.");
            Dashboard.switchPage('page-recharge');
            return;
        }

        if (!confirm(`Activer le pack ${name} pour ${price} FCFA ?`)) return;

        const { error } = await supabaseClient.rpc('buy_pack', {
            pack_name: name,
            pack_price: price,
            pack_daily: daily
        });

        if (error) alert(error.message);
        else window.location.reload();
    },

    // --- WITHDRAWALS ---
    showWithdrawModal: () => {
        const modal = document.getElementById('withdrawModal');
        modal.style.display = 'flex';

        const amtInput = document.getElementById('wAmount');
        const netDisp = document.getElementById('wNet');
        const feeDisp = document.getElementById('wFee');

        amtInput.oninput = () => {
            const val = parseFloat(amtInput.value) || 0;
            const fee = val * 0.10;
            const net = val - fee;
            netDisp.innerText = net.toLocaleString() + ' F';
            feeDisp.innerText = fee.toLocaleString() + ' F';
        };

        document.getElementById('withdrawForm').onsubmit = Dashboard.submitWithdraw;
    },

    submitWithdraw: async (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('wAmount').value);
        const phone = document.getElementById('wPhone').value;

        if (amount < 2000) {
            alert("Le montant minimum est de 2000 FCFA.");
            return;
        }

        const btn = e.target.querySelector('button');
        btn.disabled = true;

        try {
            const { error } = await supabaseClient.rpc('request_withdrawal', {
                amount_requested: amount,
                phone_number: phone
            });

            if (error) throw error;
            alert("Demande envoyée !");
            window.location.reload();
        } catch (err) {
            alert(err.message);
            btn.disabled = false;
        }
    },

    renderHistory: () => {
        const tbody = document.getElementById('historyBody');
        if (!tbody) return;
        const txs = Dashboard.currentUser.transactions || [];
        tbody.innerHTML = [...txs].reverse().slice(0, 30).map(t => {
            let color = 'text-white';
            if (['dépôt', 'gain', 'commission'].includes(t.type)) color = 'text-green';
            if (['achat', 'retrait'].includes(t.type)) color = 'text-red';
            return `
                <tr>
                    <td>${t.type.toUpperCase()}</td>
                    <td>${t.detail || '-'}</td>
                    <td class="${color}">${(t.amount || 0).toLocaleString()}</td>
                    <td>${t.date}</td>
                    <td><span class="status-badge">${t.status}</span></td>
                </tr>
            `;
        }).join('');
    },

    copyReferral: () => {
        const link = document.getElementById('refLinkInput').value;
        navigator.clipboard.writeText(link).then(() => alert("Lien copié !"));
    },

    showSeriousMessage: (msg) => {
        // Implementation of toast (simplified)
        alert(msg);
    },

    // --- SHAREHOLDERS LOGIC ---
    checkShareholderBonuses: async () => {
        try {
            const { data, error } = await supabaseClient.rpc('check_and_award_shareholder_bonuses');
            if (error) throw error;

            if (data.status === 'success') {
                Dashboard.showSeriousMessage(`Bonus Actionnaire reçu : +${data.amount} FCFA !`);
                // Reload profile
                const { data: updatedProf } = await supabaseClient.from('profiles').select('*').eq('id', Dashboard.currentUser.id).single();
                Dashboard.currentUser = updatedProf;
                Dashboard.renderUI();
                Dashboard.renderHistory();
            }

            Dashboard.updateShareholderUI(data);
        } catch (e) {
            console.error("Shareholders check failed", e);
        }
    },

    updateShareholderUI: (data) => {
        if (!data) return;

        // Update stats
        if (document.getElementById('stat-l1-active')) {
            document.getElementById('stat-l1-active').innerText = data.l1 || 0;
            document.getElementById('stat-total-active').innerText = data.total || 0;
        }

        const claimed = Dashboard.currentUser.claimed_bonuses || [];

        // Mark reached tiers
        const tiers = [
            { id: 'tier_l1_15', key: 'l1_15' },
            { id: 'tier_l1_20', key: 'l1_20' },
            { id: 'tier_l1_30', key: 'l1_30' },
            { id: 'tier_tot_50', key: 'tot_50' },
            { id: 'tier_tot_75', key: 'tot_75' },
            { id: 'tier_tot_85', key: 'tot_85' },
            { id: 'tier_tot_100', key: 'tot_100' },
            { id: 'tier_tot_125', key: 'tot_125' }
        ];

        tiers.forEach(t => {
            const el = document.getElementById(t.id);
            if (el && claimed.includes(t.key)) {
                el.classList.add('reached');
                const statusEl = el.querySelector('.tier-status');
                if (statusEl) statusEl.innerHTML = '<i class="ph ph-check-circle"></i>';
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', Dashboard.init);
window.Dashboard = Dashboard;
