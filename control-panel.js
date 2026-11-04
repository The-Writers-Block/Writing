// Control Panel for A Writer's Block.
// Login, chapter editing, and GitHub publishing follow the Cannon Art control panel.

// Panel sign-in uses this site's accounts. Publishing still needs a token from GitHub user The-Writers-Block.
const ADMIN_ACCOUNTS = [
    { username: 'liam1davis@icloud.com', passwordHash: 'ea8e86ed17727e5ee442fe665e79f4d29fb8bcfb0b6ed0230e03ecb0e16c3771' },
    { username: 'richiecity26@gmail.com', passwordHash: '5c01549bf7a1390c6254f64c8fe5b317f4aae2ae4fdf512e0bbd20a4a7d37a2d' }
];

const SESSION_KEY = 'writersBlockControlPanelSession';
const TOKEN_KEY = 'writersBlockGithubToken';
const TOKEN_LOGIN_KEY = 'writersBlockGithubLogin';
const PENDING_KEY = 'writersBlockUnsentWritings';
const TRACK_STEPS = ['browser', 'token', 'github', 'site'];

const GITHUB_CONFIG = {
    owner: 'The-Writers-Block',
    repo: 'Writing',
    branch: 'main',
    dataFile: 'writings-data.json',
    archiveFile: 'writings-archive.json'
};

let writings = { chapters: [], thoughts: [] };
let archive = { keptForMonths: 6, entries: [], report: [] };
let publishing = false;
let publishQueued = false;
let warnedLocalOnly = false;
let publishLabel = 'This writing';
let publishUnsent = false;
const saveTimers = {};

function normalizeAdminUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function isAllowedAdminLogin(username, passwordHash) {
    const user = normalizeAdminUsername(username);
    return ADMIN_ACCOUNTS.some((account) => account.username === user && account.passwordHash === passwordHash);
}

function isHardcodedAdminHash(passwordHash) {
    return ADMIN_ACCOUNTS.some((account) => account.passwordHash === passwordHash);
}

function persistSession(passwordHashHex) {
    try {
        localStorage.setItem(SESSION_KEY, passwordHashHex);
    } catch (e) {
        console.warn('Could not persist admin session:', e);
    }
}

function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
}

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ARCHIVE_ADMIN = 'liam1davis@icloud.com';

function currentAdminUsername() {
    let stored = null;
    try {
        stored = localStorage.getItem(SESSION_KEY);
    } catch (e) {
        return '';
    }
    const account = ADMIN_ACCOUNTS.find((item) => item.passwordHash === stored);
    return account ? account.username : '';
}

function canAdministerArchive() {
    return currentAdminUsername() === ARCHIVE_ADMIN;
}

function applyArchiveAccess() {
    const allowed = canAdministerArchive();
    document.querySelectorAll('[data-view="archive"]').forEach((el) => {
        el.classList.toggle('hidden', !allowed);
    });
}

function showPanel() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('controlPanel').classList.remove('hidden');
    applyArchiveAccess();
    loadWritings();
}

function tryRestoreSession() {
    let stored = null;
    try {
        stored = localStorage.getItem(SESSION_KEY);
    } catch (e) {
        return;
    }
    if (stored && isHardcodedAdminHash(stored)) showPanel();
    else if (stored) clearSession();
}

async function checkPassword() {
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginError = document.getElementById('loginError');
    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput.value.trim();
    loginError.classList.add('hidden');

    if (!username) {
        loginError.textContent = 'Please enter a username';
        loginError.classList.remove('hidden');
        usernameInput.focus();
        return;
    }
    if (!password) {
        loginError.textContent = 'Please enter a password';
        loginError.classList.remove('hidden');
        return;
    }

    let hash;
    try {
        hash = await sha256(password);
    } catch (error) {
        loginError.textContent = 'Password check failed. Open this page on http://localhost or https://.';
        loginError.classList.remove('hidden');
        return;
    }

    if (isAllowedAdminLogin(username, hash)) {
        persistSession(hash);
        showPanel();
    } else {
        loginError.textContent = 'Incorrect username or password. Access denied.';
        loginError.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
    }
}

function allowCredentialClipboard() {
    ['usernameInput', 'passwordInput'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        ['paste', 'copy', 'cut'].forEach((evt) => {
            el.addEventListener(evt, (e) => e.stopPropagation());
        });
    });
}

function getGitHubToken() {
    try {
        return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
        return '';
    }
}

function hasGitHubToken() {
    return getGitHubToken().length >= 20;
}

function githubLoginName() {
    try {
        return localStorage.getItem(TOKEN_LOGIN_KEY) || '';
    } catch (e) {
        return '';
    }
}

function loadGitHubTokenStatus() {
    const statusEl = document.getElementById('tokenAdminStatus');
    const token = hasGitHubToken();
    if (!statusEl) return;
    const login = githubLoginName();
    statusEl.textContent = token ? ('Configured' + (login ? ' · ' + login : '')) : 'Not configured';
    statusEl.className = token ? 'token-status configured' : 'token-status not-configured';
}

function githubHeaders(token, forJsonBody) {
    const headers = {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github.v3+json'
    };
    if (forJsonBody) headers['Content-Type'] = 'application/json';
    return headers;
}

function githubErrorMessage(error, fallback) {
    const message = String((error && error.message) || fallback || 'GitHub refused the request');
    const extra = error && error.documentation_url ? ' See GitHub token permissions.' : '';
    return message + extra;
}

async function confirmTokenCanPublish(token) {
    const headers = githubHeaders(token);
    const userResponse = await fetch('https://api.github.com/user', { headers });
    if (!userResponse.ok) {
        throw new Error('GitHub rejected that token.');
    }
    const user = await userResponse.json();
    const login = user.login || '';
    const scopes = String(userResponse.headers.get('X-OAuth-Scopes') || '')
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean);
    const repoResponse = await fetch(
        'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo,
        { headers }
    );
    if (!repoResponse.ok) {
        throw new Error('That token cannot see The-Writers-Block/Writing.');
    }
    const repo = await repoResponse.json();
    const canPush = !!(repo.permissions && repo.permissions.push);
    const needsRepoScope = scopes.length > 0;
    const hasRepoScope = scopes.includes('repo') || scopes.includes('public_repo');
    if (!canPush || (needsRepoScope && !hasRepoScope)) {
        throw new Error(
            'GitHub accepted the token for ' + (login || 'this user')
            + ', but it cannot publish to The-Writers-Block/Writing. The token must have write access to that repository.'
        );
    }
    return login;
}

async function saveGitHubToken() {
    const existing = getGitHubToken();
    const entered = prompt(existing ? 'Enter the one Github Classic Token issued to you by Admin (cancel to keep the current one):' : 'Enter the one Github Classic Token issued to you by Admin');
    if (entered === null) return;
    const token = entered.trim();
    if (!token) {
        showPanelToast(existing ? 'Token unchanged.' : 'Please enter a GitHub token.', !existing);
        return;
    }
    if (token.length < 20) {
        showPanelToast('Token appears invalid (too short).', true);
        return;
    }

    let login = '';
    try {
        login = await confirmTokenCanPublish(token);
    } catch (error) {
        showPanelToast(error.message || 'Could not reach GitHub to check the token.', true);
        return;
    }

    try {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(TOKEN_LOGIN_KEY, login);
    } catch (e) {
        showPanelToast('Failed to save token.', true);
        return;
    }
    warnedLocalOnly = false;
    showPanelToast('Token saved for GitHub user ' + login + '.', false);
    loadGitHubTokenStatus();
    if (publishUnsent) queuePublish();
}

function clearGitHubToken() {
    if (!getGitHubToken()) {
        showPanelToast('No token is saved in this browser.', false);
        return;
    }
    if (!confirm('Remove the saved GitHub token from this browser?')) return;
    try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_LOGIN_KEY);
    } catch (e) { /* ignore */ }
    showPanelToast('Token cleared.', false);
    loadGitHubTokenStatus();
}

function showPanelToast(message, isError) {
    const el = document.getElementById('panelToast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden', 'success', 'error');
    el.classList.add(isError ? 'error' : 'success');
    clearTimeout(showPanelToast._t);
    showPanelToast._t = setTimeout(() => el.classList.add('hidden'), isError ? 8000 : 4000);
}

function setPublishTracker(states, detail) {
    const root = document.getElementById('publishTracker');
    if (!root) return;
    TRACK_STEPS.forEach((step) => {
        const item = root.querySelector('[data-step="' + step + '"]');
        if (item) item.className = states[step] || 'waiting';
    });
    const note = document.getElementById('publishTrackerDetail');
    if (note) note.textContent = detail || '';
}

function rememberPending() {
    publishUnsent = true;
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify({
            chapters: writings.chapters,
            thoughts: writings.thoughts,
            retired: writings.retired || [],
            archive: archive,
            savedAt: new Date().toISOString()
        }));
    } catch (error) {
        // The open page still holds the writing until it is closed.
    }
}

function clearPending() {
    publishUnsent = false;
    try { localStorage.removeItem(PENDING_KEY); } catch (error) { /* ignore */ }
}

function restorePendingWritings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (error) { saved = null; }
    if (!saved) return false;
    const hadChapters = Array.isArray(saved.chapters);
    const hadThoughts = Array.isArray(saved.thoughts);
    const hadRetired = Array.isArray(saved.retired) && saved.retired.length;
    const hadArchive = saved.archive && Array.isArray(saved.archive.entries);
    if (!hadChapters && !hadThoughts && !hadRetired && !hadArchive) return false;
    if (hadChapters) writings.chapters = saved.chapters;
    if (hadThoughts) writings.thoughts = saved.thoughts;
    writings.retired = Array.from(new Set([].concat(writings.retired || [], saved.retired || [])));
    if (hadArchive) {
        archive = {
            keptForMonths: 6,
            entries: saved.archive.entries,
            report: Array.isArray(saved.archive.report) ? saved.archive.report : []
        };
    }
    publishUnsent = true;
    publishLabel = 'Unsent writing';
    return true;
}

function setFormStatus(kind) {
    const sent = kind === 'sent';
    const html = sent
        ? '<div class="success-message">Sent to GitHub. The website updates within a few minutes.</div>'
        : '<div class="error-message">Saved in this browser. Not sent to GitHub.</div>';
    ['addChapterMessage', 'addThoughtMessage'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.textContent) el.innerHTML = html;
    });
}

function markLocalChange(label) {
    publishLabel = label || 'This writing';
    rememberPending();
    setPublishTracker({
        browser: 'done',
        token: 'current',
        github: 'waiting',
        site: 'waiting'
    }, publishLabel + ' is in this browser. It has not been sent yet.');
    setFormStatus('held');
}

function showPanelView(view, clickedButton) {
    if (view === 'archive' && !canAdministerArchive()) {
        showPanelToast('Archive is administered by Admin.', true);
        return;
    }
    ['add', 'edit', 'delete', 'archive', 'analytics', 'token'].forEach((key) => {
        const el = document.getElementById('panelView' + key.charAt(0).toUpperCase() + key.slice(1));
        if (el) el.classList.toggle('hidden', key !== view);
    });
    document.querySelectorAll('.panel-nav-tab').forEach((tab) => tab.classList.remove('active'));
    if (clickedButton) clickedButton.classList.add('active');
    if (view === 'add') showAddKind(null);
    if (view === 'edit') showEditKind(null);
    if (view === 'delete') showDeleteKind(null);
    if (view === 'edit' || view === 'delete') refreshChapterLists();
    if (view === 'archive') renderArchive();
    if (view === 'token') loadGitHubTokenStatus();
    if (view === 'analytics' && typeof loadAnalyticsDashboard === 'function') loadAnalyticsDashboard();
}

function showKind(choiceId, panes, kind) {
    const choice = document.getElementById(choiceId);
    if (choice) choice.classList.toggle('hidden', !!kind);
    Object.keys(panes).forEach((name) => {
        const pane = document.getElementById(panes[name]);
        if (pane) pane.classList.toggle('hidden', name !== kind);
    });
}

function showAddKind(kind) {
    showKind('addChoice', { chapter: 'addChapterPane', thought: 'addThoughtPane' }, kind);
}

function showEditKind(kind) {
    showKind('editChoice', { chapter: 'editChapterPane', thought: 'editThoughtPane' }, kind);
}

function showDeleteKind(kind) {
    showKind('deleteChoice', { chapter: 'deleteChapterPane', thought: 'deleteThoughtPane' }, kind);
}

async function loadWritings() {
    try {
        const response = await fetch(GITHUB_CONFIG.dataFile + '?t=' + Date.now(), { cache: 'reload' });
        if (!response.ok) throw new Error('Could not read writings-data.json (' + response.status + ')');
        const parsed = await response.json();
        if (!parsed || !Array.isArray(parsed.chapters)) throw new Error('writings-data.json is missing a chapters list');
        if (!Array.isArray(parsed.thoughts)) parsed.thoughts = [];
        writings = parsed;
    } catch (error) {
        console.error(error);
        writings = { chapters: [], thoughts: [] };
        showPanelToast(error.message || 'Could not load chapters.', true);
    }
    try {
        const archiveResponse = await fetch(GITHUB_CONFIG.archiveFile + '?t=' + Date.now(), { cache: 'reload' });
        if (archiveResponse.ok) {
            const parsedArchive = await archiveResponse.json();
            archive = {
                keptForMonths: 6,
                entries: Array.isArray(parsedArchive.entries) ? parsedArchive.entries : [],
                report: []
            };
        }
    } catch (error) {
        console.error(error);
    }
    const restored = restorePendingWritings();
    refreshArchive();
    refreshChapterLists();
    loadGitHubTokenStatus();
    if (restored) {
        setPublishTracker({
            browser: 'done',
            token: hasGitHubToken() ? 'done' : 'failed',
            github: 'waiting',
            site: 'waiting'
        }, 'Unsent writing was kept in this browser. It has not been sent to GitHub.');
        if (hasGitHubToken()) queuePublish();
    } else {
        setPublishTracker({
            browser: 'waiting',
            token: 'waiting',
            github: 'waiting',
            site: 'waiting'
        }, 'Nothing is waiting to be sent.');
    }
    if (!hasGitHubToken()) {
        showPanelView('token', document.querySelector('.panel-nav-tab[data-view="token"]'));
    }
}

function nextChapterId() {
    const ids = new Set(writings.chapters.map((ch) => ch.id));
    let n = 1;
    let id;
    do {
        id = 'ch-' + String(n).padStart(3, '0');
        n += 1;
    } while (ids.has(id));
    return id;
}

function chapterById(id) {
    return writings.chapters.find((ch) => ch.id === id);
}

function fieldValue(root, name) {
    const el = root.querySelector('[data-field="' + name + '"]');
    return el ? el.value : '';
}

function readChapterFields(root) {
    return {
        number: Number(fieldValue(root, 'number')),
        title: fieldValue(root, 'title').trim(),
        written: fieldValue(root, 'written').trim(),
        text: fieldValue(root, 'body'),
        verse: root.querySelector('[data-field="verse"]') ? root.querySelector('[data-field="verse"]').checked : undefined
    };
}

function applyFields(chapter, fields) {
    const previousSlug = chapter.slug;
    chapter.number = fields.number;
    chapter.title = fields.title;
    chapter.written = fields.written;
    chapter.bodyHtml = ChapterSite.resolveBody(chapter.bodyHtml, fields.text, fields.verse);
    chapter.slug = ChapterSite.uniqueSlug(chapter.title, writings.chapters, chapter.id);
    chapter.savedAt = Date.now();
    if (previousSlug && previousSlug !== chapter.slug) {
        writings.retired = writings.retired || [];
        writings.retired.push(previousSlug);
    }
    return chapter;
}

function addChapter() {
    const form = document.getElementById('addChapterForm');
    const message = document.getElementById('addChapterMessage');
    const fields = readChapterFields(form);
    const draft = {
        id: nextChapterId(),
        number: fields.number,
        title: fields.title,
        written: fields.written,
        slug: '',
        bodyHtml: ''
    };
    const error = ChapterSite.validateChapter(draft, writings.chapters);
    if (error) {
        message.innerHTML = '<div class="error-message">' + ChapterSite.escapeHtml(error) + '</div>';
        return;
    }
    if (!fields.text.trim()) {
        message.innerHTML = '<div class="error-message">Please enter the writing.</div>';
        return;
    }
    draft.bodyHtml = ChapterSite.textToBodyHtml(fields.text, !!fields.verse);
    draft.slug = ChapterSite.uniqueSlug(draft.title, writings.chapters, draft.id);
    draft.savedAt = Date.now();
    writings.chapters.push(draft);
    depositArchive('chapter', null, snapshotChapter(draft), 'add');
    form.reset();
    message.innerHTML = '<div class="error-message">Saved in this browser. Not sent to GitHub.</div>';
    refreshChapterLists();
    markLocalChange('Chapter “' + draft.title + '”');
    queuePublish();
}

function scheduleChapterSave(id) {
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(() => saveChapterFromDom(id), 700);
}

function saveChapterFromDom(id) {
    const root = document.querySelector('#chaptersList [data-chapter-id="' + id + '"]');
    const chapter = chapterById(id);
    if (!root || !chapter) return;
    const fields = readChapterFields(root);
    const error = ChapterSite.validateChapter({ id: chapter.id, number: fields.number, title: fields.title, written: fields.written }, writings.chapters);
    if (error) {
        showPanelToast(error, true);
        return;
    }
    const before = snapshotChapter(chapter);
    applyFields(chapter, fields);
    const after = snapshotChapter(chapter);
    if (sameSnapshot(before, after, 'chapter')) return;
    depositArchive('chapter', before, after, 'edit');
    const heading = root.querySelector('h3');
    if (heading) heading.textContent = 'Chapter ' + chapter.number + ': ' + chapter.title;
    markLocalChange('Chapter “' + chapter.title + '”');
    queuePublish();
}

async function deleteChapter(id) {
    const chapter = chapterById(id);
    if (!chapter) return;
    if (!confirm('Delete “' + chapter.title + '”? This removes it from the website. The writing is deposited in Archive for 6 months.')) return;
    depositArchive('chapter', snapshotChapter(chapter), null, 'delete');
    writings.chapters = writings.chapters.filter((ch) => ch.id !== id);
    writings.retired = writings.retired || [];
    writings.retired.push(chapter.slug);
    refreshChapterLists();
    markLocalChange('Deleted chapter “' + chapter.title + '”');
    queuePublish();
}

function refreshChapterLists() {
    if (!Array.isArray(writings.thoughts)) writings.thoughts = [];
    renderChapterEditors();
    renderThoughtEditors();
    renderDeleteList();
    renderThoughtDeleteList();
}

function renderChapterEditors() {
    const list = document.getElementById('chaptersList');
    if (!list) return;
    list.replaceChildren();
    const chapters = ChapterSite.sortChapters(writings.chapters);
    if (!chapters.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'No chapters yet. Use Add to create the first one.';
        list.appendChild(empty);
        return;
    }
    chapters.forEach((chapter) => list.appendChild(editorCard(chapter)));
}

function editorCard(chapter) {
    const card = document.createElement('article');
    card.className = 'chapter-item';
    card.dataset.chapterId = chapter.id;

    const heading = document.createElement('h3');
    heading.textContent = 'Chapter ' + chapter.number + ': ' + chapter.title;
    card.appendChild(heading);

    card.appendChild(labelledField('Chapter number', 'number', 'number', String(chapter.number)));
    card.appendChild(labelledField('Title', 'title', 'text', chapter.title));
    card.appendChild(labelledField('Written (optional)', 'written', 'text', chapter.written || '', 'October 2026'));

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'editable-field';
    const bodyLabel = document.createElement('label');
    bodyLabel.textContent = 'Writing';
    const body = document.createElement('textarea');
    body.dataset.field = 'body';
    body.lang = 'en';
    body.spellcheck = true;
    body.value = ChapterSite.bodyHtmlToText(chapter.bodyHtml);
    body.addEventListener('input', () => scheduleChapterSave(chapter.id));
    bodyWrap.appendChild(bodyLabel);
    bodyWrap.appendChild(body);
    card.appendChild(bodyWrap);

    ['number', 'title', 'written'].forEach((name) => {
        card.querySelector('[data-field="' + name + '"]').addEventListener('input', () => scheduleChapterSave(chapter.id));
    });
    return card;
}

function labelledField(labelText, name, type, value, placeholder) {
    const wrap = document.createElement('div');
    wrap.className = 'editable-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.dataset.field = name;
    input.value = value || '';
    if (type === 'number') input.min = '1';
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
}

function renderDeleteList() {
    const list = document.getElementById('chaptersDeleteList');
    if (!list) return;
    list.replaceChildren();
    const chapters = ChapterSite.sortChapters(writings.chapters);
    if (!chapters.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'No chapters to delete.';
        list.appendChild(empty);
        return;
    }
    chapters.forEach((chapter) => {
        const row = document.createElement('div');
        row.className = 'delete-chapter-item';
        const info = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = chapter.title;
        const meta = document.createElement('p');
        meta.textContent = 'Chapter ' + chapter.number + (chapter.written ? ' · ' + chapter.written : '');
        info.appendChild(title);
        info.appendChild(meta);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-danger';
        button.textContent = 'Delete';
        button.addEventListener('click', () => deleteChapter(chapter.id));
        row.appendChild(info);
        row.appendChild(button);
        list.appendChild(row);
    });
}

function nextThoughtId() {
    const ids = new Set((writings.thoughts || []).map((item) => item.id));
    let n = 1;
    let id;
    do {
        id = 'th-' + String(n).padStart(3, '0');
        n += 1;
    } while (ids.has(id));
    return id;
}

function thoughtById(id) {
    return (writings.thoughts || []).find((item) => item.id === id);
}

function readThoughtFields(root) {
    return {
        title: fieldValue(root, 'title').trim(),
        written: fieldValue(root, 'written').trim(),
        text: fieldValue(root, 'body'),
        verse: root.querySelector('[data-field="verse"]') ? root.querySelector('[data-field="verse"]').checked : undefined
    };
}

function applyThoughtFields(thought, fields) {
    thought.title = fields.title;
    thought.written = fields.written;
    thought.bodyHtml = ChapterSite.resolveBody(thought.bodyHtml, fields.text, fields.verse);
    thought.anchor = ChapterSite.uniqueAnchor(thought.title, writings.thoughts, thought.id);
    thought.savedAt = Date.now();
    return thought;
}

function addThought() {
    if (!Array.isArray(writings.thoughts)) writings.thoughts = [];
    const form = document.getElementById('addThoughtForm');
    const message = document.getElementById('addThoughtMessage');
    const fields = readThoughtFields(form);
    const draft = {
        id: nextThoughtId(),
        title: fields.title,
        written: fields.written,
        anchor: '',
        bodyHtml: ''
    };
    const error = ChapterSite.validateThought(draft);
    if (error) {
        message.innerHTML = '<div class="error-message">' + ChapterSite.escapeHtml(error) + '</div>';
        return;
    }
    if (!fields.text.trim()) {
        message.innerHTML = '<div class="error-message">Please enter the writing.</div>';
        return;
    }
    draft.bodyHtml = ChapterSite.textToBodyHtml(fields.text, !!fields.verse);
    draft.anchor = ChapterSite.uniqueAnchor(draft.title, writings.thoughts, draft.id);
    draft.savedAt = Date.now();
    writings.thoughts.push(draft);
    depositArchive('thought', null, snapshotThought(draft), 'add');
    form.reset();
    message.innerHTML = '<div class="error-message">Saved in this browser. Not sent to GitHub.</div>';
    refreshChapterLists();
    markLocalChange('Thought “' + draft.title + '”');
    queuePublish();
}

function scheduleThoughtSave(id) {
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(() => saveThoughtFromDom(id), 700);
}

function saveThoughtFromDom(id) {
    const root = document.querySelector('#thoughtsList [data-thought-id="' + id + '"]');
    const thought = thoughtById(id);
    if (!root || !thought) return;
    const fields = readThoughtFields(root);
    const error = ChapterSite.validateThought({ id: thought.id, title: fields.title, written: fields.written });
    if (error) {
        showPanelToast(error, true);
        return;
    }
    const before = snapshotThought(thought);
    applyThoughtFields(thought, fields);
    const after = snapshotThought(thought);
    if (sameSnapshot(before, after, 'thought')) return;
    depositArchive('thought', before, after, 'edit');
    const heading = root.querySelector('h3');
    if (heading) heading.textContent = thought.title;
    markLocalChange('Thought “' + thought.title + '”');
    queuePublish();
}

async function deleteThought(id) {
    const thought = thoughtById(id);
    if (!thought) return;
    if (!confirm('Delete “' + thought.title + '”? This removes it from Other Musings. The writing is deposited in Archive for 6 months.')) return;
    depositArchive('thought', snapshotThought(thought), null, 'delete');
    writings.thoughts = writings.thoughts.filter((item) => item.id !== id);
    refreshChapterLists();
    markLocalChange('Deleted thought “' + thought.title + '”');
    queuePublish();
}

function renderThoughtEditors() {
    const list = document.getElementById('thoughtsList');
    if (!list) return;
    list.replaceChildren();
    const thoughts = ChapterSite.sortThoughts(writings.thoughts);
    if (!thoughts.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'No thoughts yet. Use Add to create the first one.';
        list.appendChild(empty);
        return;
    }
    thoughts.forEach((thought) => list.appendChild(thoughtEditorCard(thought)));
}

function thoughtEditorCard(thought) {
    const card = document.createElement('article');
    card.className = 'chapter-item';
    card.dataset.thoughtId = thought.id;

    const heading = document.createElement('h3');
    heading.textContent = thought.title;
    card.appendChild(heading);

    card.appendChild(labelledField('Title', 'title', 'text', thought.title));
    card.appendChild(labelledField('Written (optional)', 'written', 'text', thought.written || '', 'October 2026'));

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'editable-field';
    const bodyLabel = document.createElement('label');
    bodyLabel.textContent = 'Writing';
    const body = document.createElement('textarea');
    body.dataset.field = 'body';
    body.lang = 'en';
    body.spellcheck = true;
    body.value = ChapterSite.bodyHtmlToText(thought.bodyHtml);
    body.addEventListener('input', () => scheduleThoughtSave(thought.id));
    bodyWrap.appendChild(bodyLabel);
    bodyWrap.appendChild(body);
    card.appendChild(bodyWrap);

    ['title', 'written'].forEach((name) => {
        card.querySelector('[data-field="' + name + '"]').addEventListener('input', () => scheduleThoughtSave(thought.id));
    });
    return card;
}

function renderThoughtDeleteList() {
    const list = document.getElementById('thoughtsDeleteList');
    if (!list) return;
    list.replaceChildren();
    const thoughts = ChapterSite.sortThoughts(writings.thoughts);
    if (!thoughts.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'No thoughts to delete.';
        list.appendChild(empty);
        return;
    }
    thoughts.forEach((thought) => {
        const row = document.createElement('div');
        row.className = 'delete-chapter-item';
        const info = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = thought.title;
        const meta = document.createElement('p');
        meta.textContent = thought.written || 'Other Musings';
        info.appendChild(title);
        info.appendChild(meta);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-danger';
        button.textContent = 'Delete';
        button.addEventListener('click', () => deleteThought(thought.id));
        row.appendChild(info);
        row.appendChild(button);
        list.appendChild(row);
    });
}

function snapshotChapter(chapter) {
    return {
        id: chapter.id,
        number: Number(chapter.number),
        title: chapter.title,
        slug: chapter.slug,
        written: chapter.written || '',
        savedAt: chapter.savedAt || Date.now(),
        bodyHtml: chapter.bodyHtml || ''
    };
}

function snapshotThought(thought) {
    return {
        id: thought.id,
        title: thought.title,
        anchor: thought.anchor || '',
        written: thought.written || '',
        savedAt: thought.savedAt || Date.now(),
        bodyHtml: thought.bodyHtml || ''
    };
}

function sameSnapshot(before, after, kind) {
    if (!before || !after) return false;
    if (before.title !== after.title || (before.written || '') !== (after.written || '')) return false;
    if (ChapterSite.bodyHtmlToText(before.bodyHtml) !== ChapterSite.bodyHtmlToText(after.bodyHtml)) return false;
    if (kind === 'chapter' && Number(before.number) !== Number(after.number)) return false;
    return true;
}

function refreshArchive() {
    archive.keptForMonths = 6;
    archive.entries = ChapterSite.pruneAuditEntries(archive.entries, Date.now());
    archive.report = ChapterSite.buildAuditReport(archive.entries);
}

function depositArchive(kind, before, after, action) {
    const now = Date.now();
    const source = after || before;
    const beforeText = ChapterSite.bodyHtmlToText(before && before.bodyHtml);
    const afterText = ChapterSite.bodyHtmlToText(after && after.bodyHtml);
    const diff = ChapterSite.lineChange(beforeText, afterText);
    const entry = {
        id: 'ar-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        at: now,
        day: ChapterSite.auditDayKey(now),
        dayLabel: ChapterSite.auditDayLabel(now),
        action: action,
        kind: kind,
        itemId: source.id,
        title: source.title,
        number: kind === 'chapter' ? Number(source.number) : null,
        linesAdded: diff.linesAdded,
        linesRemoved: diff.linesRemoved,
        titleChanged: !!(before && after && before.title !== after.title),
        numberChanged: kind === 'chapter' && !!(before && after && Number(before.number) !== Number(after.number)),
        writtenChanged: !!(before && after && (before.written || '') !== (after.written || '')),
        before: before,
        after: after
    };
    entry.summary = ChapterSite.describeAudit(entry);
    archive.entries.unshift(entry);
    refreshArchive();
    renderArchive();
    return entry;
}

function renderArchive() {
    const list = document.getElementById('archiveList');
    if (!list) return;
    refreshArchive();
    list.replaceChildren();
    if (!archive.report.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'No changes deposited yet. Edits and deletions are kept here for 6 months.';
        list.appendChild(empty);
        return;
    }
    archive.report.forEach((day) => {
        const heading = document.createElement('h3');
        heading.textContent = day.dayLabel;
        list.appendChild(heading);
        day.changes.forEach((change) => {
            const entry = archive.entries.find((item) => item.id === change.id);
            const row = document.createElement('div');
            row.className = 'delete-chapter-item';
            const info = document.createElement('div');
            const title = document.createElement('h3');
            title.textContent = change.kind === 'chapter'
                ? 'Chapter ' + change.number + ', ' + change.title
                : 'Musing, ' + change.title;
            const meta = document.createElement('p');
            meta.textContent = change.summary.replace(day.dayLabel + ' — ', '');
            info.appendChild(title);
            info.appendChild(meta);
            row.appendChild(info);
            const actions = document.createElement('div');
            actions.className = 'button-row';
            if (entry && entry.before) {
                actions.appendChild(archiveButton('Restore previous', () => restoreArchive(entry.id, 'before')));
            }
            if (entry && entry.after) {
                actions.appendChild(archiveButton('Restore this change', () => restoreArchive(entry.id, 'after')));
            }
            row.appendChild(actions);
            list.appendChild(row);
        });
    });
}

function archiveButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function restoreArchive(entryId, which) {
    if (!canAdministerArchive()) {
        showPanelToast('Archive is administered by Admin.', true);
        return;
    }
    const entry = archive.entries.find((item) => item.id === entryId);
    const snap = entry && entry[which];
    if (!snap) {
        showPanelToast('That version has no saved writing.', true);
        return;
    }
    const label = which === 'before' ? 'previous version' : 'saved change';
    if (!confirm('Restore the ' + label + ' of “' + snap.title + '”?')) return;
    if (entry.kind === 'chapter') restoreChapterSnapshot(snap);
    else restoreThoughtSnapshot(snap);
}

function restoreChapterSnapshot(snap) {
    const error = ChapterSite.validateChapter({
        id: snap.id,
        number: snap.number,
        title: snap.title,
        written: snap.written
    }, writings.chapters);
    if (error) {
        showPanelToast(error, true);
        return;
    }
    const existing = chapterById(snap.id);
    const before = existing ? snapshotChapter(existing) : null;
    if (!existing) {
        const copy = snapshotChapter(snap);
        copy.slug = ChapterSite.uniqueSlug(copy.title, writings.chapters, copy.id);
        copy.savedAt = Date.now();
        writings.chapters.push(copy);
        depositArchive('chapter', null, snapshotChapter(copy), 'restore');
    } else if (!sameSnapshot(before, snap, 'chapter')) {
        const previousSlug = existing.slug;
        existing.number = Number(snap.number);
        existing.title = snap.title;
        existing.written = snap.written || '';
        existing.bodyHtml = snap.bodyHtml || '';
        const slugTaken = writings.chapters.some((chapter) => chapter.id !== existing.id && chapter.slug === snap.slug);
        existing.slug = snap.slug && !slugTaken ? snap.slug : ChapterSite.uniqueSlug(existing.title, writings.chapters, existing.id);
        existing.savedAt = Date.now();
        if (previousSlug && previousSlug !== existing.slug) {
            writings.retired = writings.retired || [];
            writings.retired.push(previousSlug);
        }
        depositArchive('chapter', before, snapshotChapter(existing), 'restore');
    }
    refreshChapterLists();
    markLocalChange('Restored chapter “' + snap.title + '”');
    queuePublish();
}

function restoreThoughtSnapshot(snap) {
    const error = ChapterSite.validateThought({ id: snap.id, title: snap.title, written: snap.written });
    if (error) {
        showPanelToast(error, true);
        return;
    }
    if (!Array.isArray(writings.thoughts)) writings.thoughts = [];
    const existing = thoughtById(snap.id);
    const before = existing ? snapshotThought(existing) : null;
    if (!existing) {
        const copy = snapshotThought(snap);
        copy.anchor = ChapterSite.uniqueAnchor(copy.title, writings.thoughts, copy.id);
        copy.savedAt = Date.now();
        writings.thoughts.push(copy);
        depositArchive('thought', null, snapshotThought(copy), 'restore');
    } else if (!sameSnapshot(before, snap, 'thought')) {
        existing.title = snap.title;
        existing.written = snap.written || '';
        existing.bodyHtml = snap.bodyHtml || '';
        existing.anchor = ChapterSite.uniqueAnchor(existing.title, writings.thoughts, existing.id);
        existing.savedAt = Date.now();
        depositArchive('thought', before, snapshotThought(existing), 'restore');
    }
    refreshChapterLists();
    markLocalChange('Restored thought “' + snap.title + '”');
    queuePublish();
}

function markPublishFailed(message) {
    rememberPending();
    setPublishTracker({
        browser: 'done',
        token: hasGitHubToken() ? 'done' : 'failed',
        github: 'failed',
        site: 'waiting'
    }, (message || 'GitHub did not accept the update.') + ' The writing is still only in this browser.');
    setFormStatus('held');
}

function queuePublish() {
    publishQueued = true;
    if (publishing) return;
    publishing = true;
    (async () => {
        try {
            while (publishQueued) {
                publishQueued = false;
                await publishWritings();
            }
        } catch (error) {
            console.error(error);
            markPublishFailed(error.message || 'Could not publish.');
            showPanelToast(error.message || 'Could not publish.', true);
        } finally {
            publishing = false;
        }
    })();
}

async function publishWritings() {
    if (!hasGitHubToken()) {
        rememberPending();
        setPublishTracker({
            browser: 'done',
            token: 'failed',
            github: 'waiting',
            site: 'waiting'
        }, publishLabel + ' is only in this browser. Save the GitHub token under Token Admin, and keep this page open.');
        setFormStatus('held');
        if (!warnedLocalOnly) {
            warnedLocalOnly = true;
            showPanelToast('Not sent. Save the GitHub token under Token Admin.', true);
        }
        return;
    }
    setPublishTracker({
        browser: 'done',
        token: 'done',
        github: 'current',
        site: 'waiting'
    }, 'Token is present. Sending ' + publishLabel + ' to GitHub.');
    showPanelToast('Sending to GitHub…', false);
    const pages = {};
    await Promise.all(ChapterSite.STATIC_PAGES.map(async (name) => {
        const response = await fetch(name + '?t=' + Date.now(), { cache: 'reload' });
        if (!response.ok) throw new Error('Could not read ' + name);
        pages[name] = await response.text();
    }));
    const files = ChapterSite.buildPublishFiles(writings.chapters, pages, writings.thoughts || []);
    const payload = {
        chapters: ChapterSite.sortChapters(writings.chapters).map((ch) => ({
            id: ch.id,
            number: ch.number,
            title: ch.title,
            slug: ch.slug,
            written: ch.written || '',
            savedAt: ch.savedAt || Date.now(),
            bodyHtml: ch.bodyHtml || ''
        })),
        thoughts: ChapterSite.sortThoughts(writings.thoughts).map((thought) => ({
            id: thought.id,
            title: thought.title,
            anchor: thought.anchor,
            written: thought.written || '',
            savedAt: thought.savedAt || Date.now(),
            bodyHtml: thought.bodyHtml || ''
        }))
    };
    await updateGitHubFile(GITHUB_CONFIG.dataFile, JSON.stringify(payload, null, 2) + '\n', 'Update writings from control panel');
    refreshArchive();
    await updateGitHubFile(GITHUB_CONFIG.archiveFile, JSON.stringify(archive, null, 2) + '\n', 'Update archive from control panel');
    const names = Object.keys(files);
    for (const name of names) {
        await updateGitHubFile(name, files[name], 'Update ' + name + ' from control panel');
    }
    const retired = new Set(writings.retired || []);
    const live = new Set(writings.chapters.map((ch) => ch.slug));
    for (const slug of retired) {
        if (!slug || live.has(slug) || slug === 'other-musings.html' || ChapterSite.STATIC_PAGES.includes(slug)) continue;
        await deleteGitHubFile(slug, 'Remove ' + slug + ' from control panel');
    }
    writings.retired = [];
    clearPending();
    setPublishTracker({
        browser: 'done',
        token: 'done',
        github: 'done',
        site: 'done'
    }, 'GitHub accepted the update. The website updates within a few minutes.');
    setFormStatus('sent');
    showPanelToast('GitHub accepted the update.', false);
}

async function readGitHubError(response, fallback) {
    const error = await response.json().catch(() => ({}));
    return githubErrorMessage(error, fallback) + ' (' + response.status + ')';
}

function unicodeToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function updateGitHubFile(filename, content, message) {
    const token = getGitHubToken();
    if (!token) throw new Error('GitHub token not configured.');
    const url = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + filename;
    let sha = null;
    const check = await fetch(url + '?ref=' + encodeURIComponent(GITHUB_CONFIG.branch), { headers: githubHeaders(token) });
    if (check.ok) sha = (await check.json()).sha;
    else if (check.status !== 404) {
        throw new Error(await readGitHubError(check, 'Could not read ' + filename + ' from GitHub'));
    }
    const response = await fetch(url, {
        method: 'PUT',
        headers: githubHeaders(token, true),
        body: JSON.stringify({
            message: message || ('Update ' + filename),
            content: unicodeToBase64(content),
            branch: GITHUB_CONFIG.branch,
            ...(sha ? { sha } : {})
        })
    });
    if (!response.ok) {
        throw new Error(await readGitHubError(response, 'Failed to update ' + filename));
    }
}

async function deleteGitHubFile(filename, message) {
    const token = getGitHubToken();
    if (!token) throw new Error('GitHub token not configured.');
    const url = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + filename;
    const check = await fetch(url + '?ref=' + encodeURIComponent(GITHUB_CONFIG.branch), { headers: githubHeaders(token) });
    if (check.status === 404) return;
    if (!check.ok) {
        throw new Error(await readGitHubError(check, 'Could not read ' + filename + ' for deletion'));
    }
    const sha = (await check.json()).sha;
    const response = await fetch(url, {
        method: 'DELETE',
        headers: githubHeaders(token, true),
        body: JSON.stringify({ message: message || ('Remove ' + filename), sha, branch: GITHUB_CONFIG.branch })
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(await readGitHubError(response, 'Failed to delete ' + filename));
    }
}

document.addEventListener('DOMContentLoaded', function () {
    allowCredentialClipboard();
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    function submitOnEnter(e) {
        if (e.key === 'Enter') checkPassword();
    }
    if (usernameInput) usernameInput.addEventListener('keypress', submitOnEnter);
    if (passwordInput) passwordInput.addEventListener('keypress', submitOnEnter);
    tryRestoreSession();
});
