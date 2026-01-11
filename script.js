// Navigation Mobile
const navSlide = () => {
    const burger = document.querySelector('.burger');
    const nav = document.querySelector('.nav-links');
    const navLinks = document.querySelectorAll('.nav-links li');

    burger.addEventListener('click', () => {
        // Toggle Nav
        nav.classList.toggle('nav-active');
        burger.classList.toggle('toggle');

        // Animate Links
        navLinks.forEach((link, index) => {
            if (link.style.animation) {
                link.style.animation = '';
            } else {
                link.style.animation = `navLinkFade 0.5s ease forwards ${index / 7 + 0.3}s`;
            }
        });
    });

    // Close menu when clicking a link
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            nav.classList.remove('nav-active');
            burger.classList.remove('toggle');
            navLinks.forEach(link => {
                link.style.animation = '';
            });
        });
    });
}

// Investment Buttons Handler
const handleInvestButtons = () => {
    const buttons = document.querySelectorAll('.pack-card .btn-primary');
    
    // Placeholder links - To be replaced by the owner
    // User provided only text for Starter, so we use placeholders
    const links = {
        'Starter': 'https://kkiapay.me/BIN-TEX-STARTER', // Example placeholder
        'Basic': '#',
        'Bronze': '#',
        'Silver': '#',
        'Gold': '#',
        'Platinum': '#',
        'Diamond': '#',
        'Elite': '#',
        'Master': '#',
        'Royal': '#'
    };

    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = btn.closest('.pack-card');
            const packName = card.querySelector('h3').innerText;
            
            if (packName === 'Starter' && links[packName] !== '#') {
                // Real link behavior
                // window.open(links[packName], '_blank'); 
                // For now, we alert because the link is likely invalid/placeholder
                console.log(`Open Kkiapay for ${packName}`);
            } else {
                e.preventDefault();
                alert(`Le lien de paiement pour le pack ${packName} sera bientôt disponible. Contactez le support.`);
            }
        });
    });
}

// Scroll Reveal Animation (Simple)
const scrollReveal = () => {
    const elementToReveal = document.querySelectorAll('.pack-card, .aff-card, .process-step');

    const revealElement = () => {
        for (let i = 0; i < elementToReveal.length; i++) {
            let windowHeight = window.innerHeight;
            let elementTop = elementToReveal[i].getBoundingClientRect().top;
            let elementVisible = 150;

            if (elementTop < windowHeight - elementVisible) {
                elementToReveal[i].style.opacity = '1';
                elementToReveal[i].style.transform = 'translateY(0)';
            }
        }
    }

    // Set initial state for animation
    elementToReveal.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(50px)';
        el.style.transition = 'all 0.6s ease';
    });

    window.addEventListener('scroll', revealElement);
    revealElement(); // Trigger once on load
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    navSlide();
    handleInvestButtons();
    scrollReveal();
});
