/* ── GitHub URL (set once, applied to all CTA links) ────────────── */
const GITHUB_URL = 'https://github.com/vlad-codes/switchr';
document.querySelectorAll('[data-store-link]').forEach(a => { a.href = GITHUB_URL; });

/* ── i18n ─────────────────────────────────────────────────────── */
const STRINGS = {
  en: {
    nav_features: 'Features',
    nav_pricing:  'Pricing',
    nav_faq:      'FAQ',
    nav_cta:      'Get on GitHub',
    hero_eyebrow:  'Chrome Extension · Free & Open Source',
    hero_h1_line1: 'Multiple Twitch accounts.',
    hero_h1_line2: 'One click.',
    hero_sub:      'Switchr lets you switch between your Twitch accounts instantly — right from the browser popup or the widget built into twitch.tv.',
    hero_cta_primary: 'Get on GitHub',
    hero_cta_ghost:   'How to install →',
    hero_proof:       'Free · Open source · No sign-up required',
    popup_add:   'Add account',
    popup_count: '2 accounts',
    tw_view:     'View Channel',
    tw_settings: 'Settings',
    tw_logout:   'Log Out',
    feat1_title: 'Instant switch',
    feat1_short: 'one click for saved sessions',
    feat2_title: 'Twitch widget',
    feat2_short: 'switch right from twitch.tv',
    feat3_title: 'Local & private',
    feat3_short: 'no servers, your browser only',
    feat4_title: 'Unlimited accounts',
    feat4_short: 'no limits, no sign-up',
    step1_title: 'Download from GitHub',
    step2_title: 'Add your accounts',
    step3_title: 'Switch instantly',
    faq_label: 'FAQ',
    faq_title: 'Common questions.',
    faq0_q: 'How do I install Switchr?',
    faq0_a: 'Download the ZIP from the GitHub releases page and unpack it. Then open Chrome and go to chrome://extensions, enable Developer mode (top right), click Load unpacked and select the unpacked folder. Done — the Switchr icon appears in your toolbar.',
    faq1_q: 'Is Switchr safe to use?',
    faq1_a: 'Switchr stores session cookies locally in your browser and restricts them to trusted extension contexts. Saved sessions are not uploaded or synced. Your browser still sends active cookies to Twitch as part of normal browsing.',
    faq2_q: 'Does it work on all Twitch pages?',
    faq2_a: 'The browser popup works anywhere. The in-page widget is injected directly into the Twitch user dropdown menu, so it appears whenever you open your profile menu on twitch.tv.',
    faq3_q: 'Will it log me out of my current session?',
    faq3_a: 'Switchr saves your current session before switching and reloads all Twitch tabs in the profile. A failed cookie restoration rolls back to your previous cookies. Twitch can expire or revoke sessions; use Manage → Sign in again if a saved session no longer works.',
    faq4_q: 'How many accounts can I add?',
    faq4_a: 'You can add as many accounts as you want — there is no limit.',
    faq5_q: 'Does this violate Twitch\'s Terms of Service?',
    faq5_a: 'Switchr uses only session cookies that are already set by Twitch in your browser. It does not automate any actions or bypass security measures. That said, use it at your own discretion.',
    faq6_q: 'What browsers are supported?',
    faq6_a: 'Switchr requires Chrome 130+ or a compatible Chromium-based browser such as Brave, Edge or Arc. Incognito is not supported.',
    footer_tagline: 'Twitch Account Switcher for Chrome',
    footer_ext:     'Extension',
    footer_store:   'GitHub',
    footer_legal:   'Legal',
    footer_privacy: 'Privacy',
    footer_copy:    '© 2025 Switchr. Not an official Twitch product.',
    footer_made:    'Made with ♥ for the Twitch community',
  },
  de: {
    nav_features: 'Features',
    nav_pricing:  'Preise',
    nav_faq:      'FAQ',
    nav_cta:      'Auf GitHub laden',
    hero_eyebrow:  'Chrome Extension · Kostenlos & Open Source',
    hero_h1_line1: 'Mehrere Twitch-Accounts.',
    hero_h1_line2: 'Ein Klick.',
    hero_sub:      'Switchr lässt dich blitzschnell zwischen deinen Twitch-Accounts wechseln — direkt aus dem Browser-Popup oder dem Widget auf twitch.tv.',
    hero_cta_primary: 'Auf GitHub laden',
    hero_cta_ghost:   'Installation →',
    hero_proof:       'Kostenlos · Open Source · Kein Login nötig',
    popup_add:   'Account hinzufügen',
    popup_count: '2 Accounts',
    tw_view:     'Kanal aufrufen',
    tw_settings: 'Einstellungen',
    tw_logout:   'Abmelden',
    feat1_title: 'Sofortiger Wechsel',
    feat1_short: 'ein Klick für gespeicherte Sitzungen',
    feat2_title: 'Twitch-Widget',
    feat2_short: 'direkt auf twitch.tv wechseln',
    feat3_title: 'Lokal & sicher',
    feat3_short: 'keine Server, nur dein Browser',
    feat4_title: 'Unbegrenzte Accounts',
    feat4_short: 'keine Limits, kein Login',
    step1_title: 'Von GitHub laden',
    step2_title: 'Accounts hinzufügen',
    step3_title: 'Sofort wechseln',
    faq_label: 'FAQ',
    faq_title: 'Häufige Fragen.',
    faq0_q: 'Wie installiere ich Switchr?',
    faq0_a: 'Lade das ZIP von der GitHub-Releases-Seite herunter und entpacke es. Öffne Chrome und gehe zu chrome://extensions, aktiviere den Entwicklermodus (oben rechts), klicke auf Entpackte Erweiterung laden und wähle den entpackten Ordner aus. Fertig — das Switchr-Icon erscheint in der Toolbar.',
    faq1_q: 'Ist Switchr sicher?',
    faq1_a: 'Switchr speichert Session-Cookies lokal im Browser und beschränkt den Zugriff auf vertrauenswürdige Erweiterungskontexte. Gespeicherte Sitzungen werden nicht hochgeladen oder synchronisiert. Aktive Cookies sendet dein Browser beim normalen Surfen weiterhin an Twitch.',
    faq2_q: 'Funktioniert es auf allen Twitch-Seiten?',
    faq2_a: 'Das Browser-Popup funktioniert überall. Das In-Page-Widget wird direkt in das Twitch-Benutzermenü injiziert und erscheint, wann immer du dein Profilmenü auf twitch.tv öffnest.',
    faq3_q: 'Werde ich aus meiner aktuellen Sitzung ausgeloggt?',
    faq3_a: 'Switchr speichert deine aktuelle Sitzung vor dem Wechsel und lädt alle Twitch-Tabs im Profil neu. Scheitert das Wiederherstellen der Cookies, werden die vorherigen Cookies zurückgespielt. Twitch kann Sitzungen ablaufen lassen oder widerrufen. Nutze dann Manage → Sign in again.',
    faq4_q: 'Wie viele Accounts kann ich hinzufügen?',
    faq4_a: 'Du kannst so viele Accounts hinzufügen wie du möchtest — es gibt kein Limit.',
    faq5_q: 'Verstößt das gegen Twitchs Nutzungsbedingungen?',
    faq5_a: 'Switchr verwendet nur Session-Cookies, die bereits von Twitch in deinem Browser gesetzt wurden. Es werden keine Aktionen automatisiert oder Sicherheitsmaßnahmen umgangen. Nutze es trotzdem nach eigenem Ermessen.',
    faq6_q: 'Welche Browser werden unterstützt?',
    faq6_a: 'Switchr benötigt Chrome 130+ oder einen kompatiblen Chromium-Browser wie Brave, Edge oder Arc. Der Inkognitomodus wird nicht unterstützt.',
    footer_tagline: 'Twitch Account Switcher für Chrome',
    footer_ext:     'Extension',
    footer_store:   'GitHub',
    footer_legal:   'Rechtliches',
    footer_privacy: 'Datenschutz',
    footer_copy:    '© 2025 Switchr. Kein offizielles Twitch-Produkt.',
    footer_made:    'Made with ♥ for the Twitch community',
  }
};

let currentLang = 'en';

function applyLang(lang) {
  currentLang = lang;
  const t = STRINGS[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key] !== undefined) el.textContent = t[key];
  });
  document.getElementById('langToggle').textContent = lang === 'en' ? 'DE' : 'EN';
  document.documentElement.lang = lang;
}

document.getElementById('langToggle').addEventListener('click', () => {
  applyLang(currentLang === 'en' ? 'de' : 'en');
});

/* ── Scroll reveal ──────────────────────────────────────────────── */
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* ── Active nav link ────────────────────────────────────────────── */
const sections = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.nav-links a');
const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(a => a.classList.remove('active'));
        const match = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
        if (match) match.classList.add('active');
      }
    });
  },
  { threshold: 0.45 }
);
sections.forEach(s => sectionObserver.observe(s));

/* ── Nav scroll state ───────────────────────────────────────────── */
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 80);
}, { passive: true });

/* ── Mouse parallax glow ────────────────────────────────────────── */
const heroGlow    = document.querySelector('.hero-glow');
const heroSection = document.querySelector('.hero');
if (heroGlow && heroSection) {
  heroSection.addEventListener('mousemove', (e) => {
    const rect = heroSection.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 48;
    const y = ((e.clientY - rect.top)  / rect.height - 0.5) * 24;
    heroGlow.style.transform = `translateX(calc(-50% + ${x}px)) translateY(${y}px)`;
  }, { passive: true });
}

/* ── Popup demo — cycle accounts ────────────────────────────────── */
const demoSlots = [
  { hero: 'streamer_main', heroMono: 'S', alt: 'alt_account', altMono: 'A', tw: 'streamer_main', twAlt: 'alt_account' },
  { hero: 'mod_account',   heroMono: 'M', alt: 'viewer_only',  altMono: 'V', tw: 'mod_account',   twAlt: 'viewer_only'  },
  { hero: 'clipper_pro',   heroMono: 'C', alt: 'streamer_main',altMono: 'S', tw: 'clipper_pro',   twAlt: 'streamer_main'},
];
let demoIdx = 0;

const heroName   = document.getElementById('heroName');
const heroMono   = document.getElementById('heroMonogram');
const altName    = document.getElementById('altName');
const altMono    = document.getElementById('altMonogram');
const twUsername = document.getElementById('twUsername');
const twAvatar   = document.querySelector('.tw-avatar');
const twActive   = document.getElementById('twActive');
const twAltEl    = document.getElementById('twAlt');

if (heroName) {
  setInterval(() => {
    demoIdx = (demoIdx + 1) % demoSlots.length;
    const s = demoSlots[demoIdx];

    [heroName, altName, twUsername, twActive, twAltEl].forEach(el => {
      if (el) el.style.opacity = '0';
    });
    if (twAvatar) twAvatar.style.opacity = '0';

    setTimeout(() => {
      if (heroName)   { heroName.textContent  = s.hero;    heroName.style.opacity  = '1'; }
      if (heroMono)   { heroMono.textContent  = s.heroMono; }
      if (altName)    { altName.textContent   = s.alt;     altName.style.opacity   = '1'; }
      if (altMono)    { altMono.textContent   = s.altMono; }
      if (twUsername) { twUsername.textContent = s.tw;     twUsername.style.opacity = '1'; }
      if (twAvatar)   { twAvatar.textContent  = s.heroMono; twAvatar.style.opacity  = '1'; }
      if (twActive)   { twActive.textContent  = s.tw;      twActive.style.opacity   = '1'; }
      if (twAltEl)    { twAltEl.textContent   = s.twAlt;   twAltEl.style.opacity    = '1'; }
    }, 220);
  }, 3200);
}
