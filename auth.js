/**
 * Auth.js - Handles User Registration, Login and Session Management
 * Uses Supabase Authentication and Database.
 */

const Auth = {
    // Register a new user
    register: async (name, phone, email, password) => {
        // 1. Sign Up with Supabase Auth
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: name,
                    phone: phone
                }
            }
        });

        if (error) {
            return { success: false, message: error.message };
        }

        // Profile creation is now handled by a Supabase Trigger (server-side)

        return { success: true };
    },

    // Login user
    login: async (email, password) => {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            return { success: false, message: "Email ou mot de passe incorrect." };
        }

        return { success: true, user: data.user };
    },

    // Logout
    logout: async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    },

    // Check if user is logged in
    checkAuth: async () => {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            return null; // Let the caller decide to redirect
        }
        return session.user;
    },

    // Get current FULL user data from DB (Profile)
    getCurrentUser: async () => {
        const user = await Auth.checkAuth();
        if (!user) {
            console.warn("Auth.checkAuth() returned null - No active session.");
            return null;
        }

        let { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        // FALLBACK: If profile missing, try to create it now (Lazy Creation)
        if (error && error.code === 'PGRST116') {
            console.warn("Profile missing. Attempting lazy creation...");
            const created = await Auth.createProfile(user);
            if (created) {
                // Retry fetch
                const retry = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();
                data = retry.data;
                error = retry.error;
            }
        }

        if (error || !data) {
            console.error("Error fetching/creating profile:", error);
            return null;
        }

        // Map snake_case (DB) to camelCase (App)
        return {
            id: data.id,
            name: data.name,
            email: data.email,
            phone: data.phone,
            referralCode: data.referral_code,
            balanceMain: parseFloat(data.balance_main) || 0,
            balanceGains: parseFloat(data.balance_gains) || 0,
            balanceCommissions: parseFloat(data.balance_commissions) || 0,
            activePacks: data.active_packs || [], // JSONB
            transactions: data.transactions || [], // JSONB
            joinedDate: data.joined_date
        };
    },

    // Helper: Create Profile manually (if Trigger failed)
    createProfile: async (user) => {
        const newProfile = {
            id: user.id,
            email: user.email,
            name: user.user_metadata.full_name || 'Utilisateur',
            phone: user.user_metadata.phone || '',
            referral_code: 'BIN' + Math.floor(1000 + Math.random() * 9000),
            balance_main: 0,
            balance_gains: 0,
            balance_commissions: 0,
            active_packs: [],
            transactions: [],
            joined_date: new Date().toISOString()
        };

        const { error } = await supabaseClient
            .from('profiles')
            .insert([newProfile]);

        if (error) {
            console.error("Lazy profile creation failed:", error);
            return false;
        }
        return true;
    },

    // Update current user data in DB
    updateUser: async (updatedUser) => {
        // Map camelCase back to snake_case for DB
        const dbProfile = {
            balance_main: updatedUser.balanceMain,
            balance_gains: updatedUser.balanceGains,
            balance_commissions: updatedUser.balanceCommissions,
            active_packs: updatedUser.activePacks,
            transactions: updatedUser.transactions
        };

        const { error } = await supabaseClient
            .from('profiles')
            .update(dbProfile)
            .eq('id', updatedUser.id);

        if (error) {
            console.error("Error updating profile:", error);
            return false;
        }
        return true;
    }
};

// Expose to window
window.Auth = Auth;

