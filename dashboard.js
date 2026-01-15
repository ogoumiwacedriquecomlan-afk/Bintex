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
            Dashboard.fetchGlobalActivity(); // [NEW]
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

        if (document.getElementById('totalInvested')) {
            document.getElementById('totalInvested').innerText = totalInvested.toLocaleString() + ' F';
        }
        if (document.getElementById('totalEarned')) {
            document.getElementById('totalEarned').innerText = totalEarned.toLocaleString() + ' F';
        }

        if (document.getElementById('spinsCount')) {
            document.getElementById('spinsCount').innerText = user.spins_count || 0;
        }
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

        // WhatsApp Prompt removed from here (only in init)

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

    // --- GLOBAL ACTIVITY ---
    fetchGlobalActivity: async () => {
        try {
            const { data, error } = await supabaseClient
                .from('global_activity')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;

            const ticker = document.getElementById('globalTicker');
            if (ticker && data.length > 0) {
                ticker.innerHTML = data.map(act => {
                    let icon = 'ph-trend-up';
                    if (act.type === 'achat') icon = 'ph-package';
                    if (act.type === 'retrait') icon = 'ph-hand-coins';
                    if (act.type === 'gain_roue') icon = 'ph-star';

                    return `
                        <div class="ticker-item">
                            <i class="ph ${icon}"></i> 
                            ${act.user_name} a ${act.type === 'achat' ? 'activé un' : act.type === 'retrait' ? 'effectué un' : act.type === 'gain_roue' ? 'gagné un' : 'fait un'} 
                            ${act.detail.includes('Pack') ? act.detail : (act.amount + ' F')}
                        </div>
                    `;
                }).join('');
            }
        } catch (e) {
            console.error("Ticker error", e);
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
        grid.innerHTML = `
            <table class="minimal-table">
                <thead>
                    <tr>
                        <th>Montant</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${opts.map(amt => `
                        <tr>
                            <td class="text-gold" style="font-weight:700;">${amt.toLocaleString()} F</td>
                            <td>
                                <button class="btn btn-sm btn-outline" style="padding: 4px 12px;" onclick="Dashboard.prepareDeposit(${amt})">Choisir</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    prepareDeposit: (amount) => {
        const depAmount = document.getElementById('depAmount');
        depAmount.value = amount;
        Dashboard.updatePaymentInstructions();

        // Scroll to form or show action box
        document.getElementById('ussdAction').style.display = 'block';
    },

    updatePaymentInstructions: () => {
        const amount = document.getElementById('depAmount').value || 0;
        const method = document.querySelector('input[name="payMethod"]:checked').value;
        const ussdBtn = document.getElementById('ussdBtn');
        const instruction = document.getElementById('ussdInstruction');

        if (method === 'mtn') {
            const code = `*880*1*1*0142874520*0142874520*${amount}#`;
            instruction.innerHTML = `Action MTN: Payez vers le numéro <strong class="text-gold">01 42 87 45 20</strong> via le code ci-dessous :`;
            ussdBtn.href = `tel:${code.replace(/#/g, '%23')}`;
            ussdBtn.innerText = `Composer ${code}`;
        } else {
            const code = `*855*1*1*0165848336*0165848336*${amount}#`;
            instruction.innerHTML = `Action Moov: Payez vers le numéro <strong class="text-gold">01 65 84 83 36</strong> via le code ci-dessous :`;
            ussdBtn.href = `tel:${code.replace(/#/g, '%23')}`;
            ussdBtn.innerText = `Composer ${code}`;
        }
    },

    submitManualDeposit: async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.innerHTML = 'Traitement...';

        const method = document.querySelector('input[name="payMethod"]:checked').value;

        const payload = {
            user_id: Dashboard.currentUser.id,
            amount: parseFloat(document.getElementById('depAmount').value),
            transaction_id: document.getElementById('depTxId').value,
            sender_phone: document.getElementById('senderNum').value,
            sender_name: document.getElementById('senderName').value,
            payment_method: method,
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
            { name: 'Platinum', price: 100000, daily: 20000, img: 'images/pack-platinum.png' },
            { name: 'Diamond', price: 250000, daily: 50000, img: 'images/pack-platinum.png' },
            { name: 'Master', price: 500000, daily: 100000, img: 'images/pack-platinum.png' },
            { name: 'Elite', price: 1000000, daily: 200000, img: 'images/pack-platinum.png' },
            { name: 'Ultimate', price: 2000000, daily: 400000, img: 'images/pack-platinum.png' }
        ];

        const grid = document.getElementById('dashPacksGrid');
        if (!grid) return;
        grid.innerHTML = `
            <table class="minimal-table">
                <thead>
                    <tr>
                        <th>Pack</th>
                        <th>Prix</th>
                        <th>Gain/j</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${PACKS.map(p => `
                        <tr>
                            <td style="display:flex; align-items:center; gap:8px;">
                                <img src="${p.img}" onerror="this.src='images/pack-starter.png'" class="p-icon-mini-v2">
                                <span>${p.name}</span>
                            </td>
                            <td>${p.price.toLocaleString()} F</td>
                            <td class="text-gold">+${p.daily.toLocaleString()} F</td>
                            <td>
                                <button class="btn btn-sm btn-primary" onclick="Dashboard.buyPack('${p.name}', ${p.price}, ${p.daily})">Activer</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

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

    processRewards: async () => {
        try {
            const { data, error } = await supabaseClient.rpc('process_daily_rewards');
            if (error) throw error;
            if (data && data.status === 'success') {
                console.log("Gains distribués:", data);
                // Refresh profile to show new balance (silent update)
                const { data: updatedProf } = await supabaseClient.from('profiles').select('*').eq('id', Dashboard.currentUser.id).single();
                Dashboard.currentUser = updatedProf;
                Dashboard.renderUI();
            }
        } catch (e) {
            console.error("Erreur distribution gains", e);
        }
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
        const method = document.querySelector('input[name="wMethod"]:checked').value;

        if (amount < 2000) {
            alert("Le montant minimum est de 2000 FCFA.");
            return;
        }

        const btn = e.target.querySelector('button');
        btn.disabled = true;

        try {
            const { error } = await supabaseClient.rpc('request_withdrawal', {
                amount_requested: amount,
                phone_number: phone,
                payment_method: method
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
    },

    // --- LUCKY WHEEL ---
    spinWheel: async () => {
        if (Dashboard.isSpinning) return;
        if ((Dashboard.currentUser.spins_count || 0) <= 0) {
            alert("Vous n'avez plus de tours ! Parrainez des amis investissant 15 000 F ou plus pour en obtenir.");
            return;
        }

        Dashboard.isSpinning = true;
        const btn = document.getElementById('spinWheelBtn');
        btn.disabled = true;

        try {
            const { data, error } = await supabaseClient.rpc('spin_wheel');
            if (error) throw error;

            const wheel = document.getElementById('luckyWheel');
            const randVal = data.result_index;

            // Calculate segment index (8 segments of 45deg)
            let segmentIndex = 0;
            if (randVal <= 600) segmentIndex = 0;
            else if (randVal <= 900) segmentIndex = 1;
            else if (randVal <= 970) segmentIndex = 2;
            else if (randVal <= 990) segmentIndex = 3;
            else if (randVal <= 997) segmentIndex = 4;
            else if (randVal === 998) segmentIndex = 5;
            else if (randVal === 999) segmentIndex = 6;
            else segmentIndex = 7;

            // Rotation logic: segment center + full rotations
            const baseRotationPerSegment = 45;
            const extraRotations = 5 * 360; // 5 full turns
            const targetRotation = extraRotations + (segmentIndex * baseRotationPerSegment) + (baseRotationPerSegment / 2);

            // Note: Conic gradient starts at top (0deg). Pointer is at top.
            // If we want the pointer to point to segment 0, we need to rotate wheel by 0.
            // Since the wheel rotates clockwise, we subtract the angle.
            wheel.style.transform = `rotate(-${targetRotation}deg)`;

            setTimeout(async () => {
                let msg = "";
                if (data.prize_type === 'cash') {
                    msg = data.prize_amount > 0 ? `Bravo ! Vous avez gagné ${data.prize_amount} FCFA !` : "Dommage... Essayez encore !";
                } else {
                    msg = `INCROYABLE ! Vous avez gagné un ${data.prize_pack} d'une valeur de ${data.prize_amount} F !`;
                }

                Dashboard.showSeriousMessage(msg);

                // Refresh Profile
                const { data: updatedProf } = await supabaseClient.from('profiles').select('*').eq('id', Dashboard.currentUser.id).single();
                Dashboard.currentUser = updatedProf;
                Dashboard.renderUI();
                Dashboard.renderHistory();
                Dashboard.renderPacks();

                Dashboard.isSpinning = false;
                btn.disabled = false;
                // Reset wheel for next spin without transition
                setTimeout(() => {
                    wheel.style.transition = 'none';
                    wheel.style.transform = 'rotate(0deg)';
                    setTimeout(() => wheel.style.transition = 'transform 5s cubic-bezier(0.1, 0, 0, 1)', 50);
                }, 1000);
            }, 5500);

        } catch (e) {
            alert(e.message);
            Dashboard.isSpinning = false;
            btn.disabled = false;
        }
    }
};

document.addEventListener('DOMContentLoaded', Dashboard.init);
window.Dashboard = Dashboard;
